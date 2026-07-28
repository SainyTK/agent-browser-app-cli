import { afterEach, describe, expect, test } from "bun:test";
import {
  chmod,
  lstat,
  mkdtemp,
  mkdir,
  readlink,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const installer = resolve(import.meta.dir, "../install.sh");
const temporaryDirectories: string[] = [];

async function createInstallerFixture(): Promise<{
  binDirectory: string;
  fixtureDirectory: string;
  root: string;
}> {
  const root = await mkdtemp(join(tmpdir(), "agent-browser-app-install-test-"));
  temporaryDirectories.push(root);
  const binDirectory = join(root, "bin");
  const fixtureDirectory = join(root, "fixture");
  await mkdir(binDirectory);
  await mkdir(fixtureDirectory);

  const fixtureBinary = join(fixtureDirectory, "agent-browser-app");
  await writeFile(
    fixtureBinary,
    "#!/bin/sh\nprintf 'fixture agent-browser-app\\n'\n",
  );
  await chmod(fixtureBinary, 0o755);

  const archive = join(fixtureDirectory, "release.tar.gz");
  const tar = Bun.spawn(
    ["tar", "-czf", archive, "-C", fixtureDirectory, "agent-browser-app"],
    { stdout: "pipe", stderr: "pipe" },
  );
  expect(await tar.exited).toBe(0);

  const fakeCurl = join(binDirectory, "curl");
  await writeFile(
    fakeCurl,
    `#!/bin/sh
set -eu

output=""
url=""
while [ "$#" -gt 0 ]; do
  case "$1" in
    -o)
      output="$2"
      shift 2
      ;;
    -H)
      shift 2
      ;;
    -*)
      shift
      ;;
    *)
      url="$1"
      shift
      ;;
  esac
done

case "$url" in
  */releases/latest)
    printf '%s\\n' '{' '  "tag_name": "v1.3.0",' '  "prerelease": false' '}'
    ;;
  */releases?per_page=100)
    printf '%s\\n' \
      '[' \
      '  {' \
      '    "tag_name": "v1.3.0",' \
      '    "prerelease": false' \
      '  },' \
      '  {' \
      '    "tag_name": "v1.4.0-preview.8",' \
      '    "prerelease": true' \
      '  }' \
      ']'
    ;;
  *.sha256)
    archive_name="\${url##*/}"
    archive_name="\${archive_name%.sha256}"
    checksum="$(shasum -a 256 "$FIXTURE_DIRECTORY/release.tar.gz" | awk '{print $1}')"
    printf '%s  %s\\n' "$checksum" "$archive_name" > "$output"
    ;;
  */releases/download/*)
    cp "$FIXTURE_DIRECTORY/release.tar.gz" "$output"
    ;;
  *)
    echo "Unexpected URL: $url" >&2
    exit 1
    ;;
esac
`,
  );
  await chmod(fakeCurl, 0o755);

  return { binDirectory, fixtureDirectory, root };
}

afterEach(async () => {
  const directories = temporaryDirectories.splice(0);
  await Promise.all(
    directories.map((directory) => rm(directory, { recursive: true })),
  );
});

describe("release installer", () => {
  test.each([
    ["lts", [] as string[], "v1.3.0"],
    ["preview", ["--channel", "preview"], "v1.4.0-preview.8"],
  ])("installs the latest %s release with its alias", async (
    channel,
    channelArguments,
    tag,
  ) => {
    const fixture = await createInstallerFixture();
    const installDirectory = join(fixture.root, "install");
    const processHandle = Bun.spawn(
      [
        "sh",
        installer,
        ...channelArguments,
        "--install-dir",
        installDirectory,
      ],
      {
        stdout: "pipe",
        stderr: "pipe",
        env: {
          ...process.env,
          PATH: `${fixture.binDirectory}:${process.env.PATH}`,
          FIXTURE_DIRECTORY: fixture.fixtureDirectory,
          AGENT_BROWSER_APP_API_URL: "https://api.example.test",
          AGENT_BROWSER_APP_DOWNLOAD_URL: "https://download.example.test",
        },
      },
    );
    const [exitCode, stdout, stderr] = await Promise.all([
      processHandle.exited,
      new Response(processHandle.stdout).text(),
      new Response(processHandle.stderr).text(),
    ]);

    expect(exitCode).toBe(0);
    expect(stderr).toBe("");
    expect(stdout).toContain(`Installed agent-browser-app ${tag.slice(1)}`);
    expect((await lstat(join(installDirectory, "agent-browser-app"))).mode & 0o111)
      .not.toBe(0);
    expect(await readlink(join(installDirectory, "aba"))).toBe(
      "agent-browser-app",
    );

    const installed = Bun.spawn([join(installDirectory, "aba")], {
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(await installed.exited).toBe(0);
    expect(await new Response(installed.stdout).text()).toBe(
      "fixture agent-browser-app\n",
    );
  });

  test("rejects unknown channels before downloading", async () => {
    const processHandle = Bun.spawn(
      ["sh", installer, "--channel", "nightly"],
      { stdout: "pipe", stderr: "pipe" },
    );
    const [exitCode, stderr] = await Promise.all([
      processHandle.exited,
      new Response(processHandle.stderr).text(),
    ]);

    expect(exitCode).toBe(2);
    expect(stderr).toContain("unsupported channel");
  });
});
