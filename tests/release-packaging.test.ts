import { expect, test } from "bun:test";
import { cp, mkdtemp, mkdir, realpath, rename, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dir, "..");

async function run(command: string[], cwd: string, home: string) {
  const child = Bun.spawn(command, { cwd, env: { ...process.env, AGENT_BROWSER_HOME: home, NODE_PATH: "" }, stdout: "pipe", stderr: "pipe" });
  const [code, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
  return { code, stdout, stderr };
}

test("compiled release installs its exact runtime and browses outside the repository through symlinks", async () => {
  const temporary = await mkdtemp(join(tmpdir(), "aba-release-packaging-"));
  const output = join(temporary, "build");
  const outside = join(temporary, "outside");
  const home = join(temporary, "home");
  await mkdir(outside);
  await mkdir(home);
  // An ambient module must never replace the packaged version.
  await mkdir(join(outside, "node_modules", "playwright"), { recursive: true });
  await writeFile(join(outside, "node_modules", "playwright", "index.js"), "throw new Error('ambient module loaded');");
  const target = `bun-${process.platform}-${process.arch}` as Bun.Build.CompileTarget;
  const archiveName = `agent-browser-app-v9.8.7-${process.platform}-${process.arch}.tar.gz`;
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch(request) {
    const path = new URL(request.url).pathname;
    if (path.endsWith("/latest")) return new Response('{\n  "tag_name": "v9.8.7"\n}');
    if (path.endsWith(".sha256")) return new Response(Bun.file(join(output, `${archiveName}.sha256`)));
    if (path.endsWith(".tar.gz")) return new Response(Bun.file(join(output, archiveName)));
    return new Response('<title>Release fixture</title><input id="value"><button id="store" onclick="document.body.dataset.result=document.querySelector(\'#value\').value">Store</button>', { headers: { "content-type": "text/html" } });
  } });
  try {
    const build = await run(["sh", "scripts/build-release.sh", "9.8.7", target, output], root, home);
    expect(build.code, build.stderr).toBe(0);
    const installDirectory = join(temporary, "installed bin");
    async function installRelease() {
      const child = Bun.spawn(["sh", join(root, "install.sh"), "--install-dir", installDirectory], { cwd: outside, env: { ...process.env, AGENT_BROWSER_APP_API_URL: server.url.origin, AGENT_BROWSER_APP_DOWNLOAD_URL: server.url.origin }, stdout: "pipe", stderr: "pipe" });
      const [code, , stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
      expect(code, stderr).toBe(0);
    }
    await installRelease();
    const alias = join(installDirectory, "aba");
    const previousExecutable = await realpath(alias);
    await installRelease();
    expect(await realpath(alias)).not.toBe(previousExecutable);
    expect((await run([previousExecutable, "--version"], outside, home)).code).toBe(0);
    expect(await run([alias, "--version"], outside, home)).toEqual({ code: 0, stdout: "9.8.7\n", stderr: "" });
    const help = await run([alias, "--help"], outside, home);
    expect(help.code).toBe(0);
    expect(help.stdout).toContain("agent-browser-app");
    const list = await run([alias, "gnb", "auth", "list", "--json"], outside, home);
    expect(list.code, list.stderr).toBe(0);
    expect(JSON.parse(list.stdout)).toEqual({ accounts: [] });
    const invalid = await run([alias, "not-a-command"], outside, home);
    expect(invalid.code).toBe(2);
    expect(invalid.stderr).toContain("Error:");

    // Compile the production BrowserSession using exactly the release build
    // plugin and copied runtime, without adding a diagnostic command to the CLI.
    const smoke = join(output, "release-browser-smoke");
    const compileSmoke = await run([process.execPath, "-e", `import { compileRelease } from ${JSON.stringify(join(root, "scripts/compile-release.ts"))}; await compileRelease(${JSON.stringify(join(root, "tests/fixtures/release-browser-smoke.ts"))}, ${JSON.stringify(smoke)}, ${JSON.stringify(target)}, "9.8.7");`], outside, home);
    expect(compileSmoke.code, compileSmoke.stderr).toBe(0);
    if (process.platform === "darwin") {
      await run(["codesign", "--remove-signature", smoke], outside, home);
      const sign = await run(["codesign", "--force", "--sign", "-", "--entitlements", join(root, "release/entitlements.plist"), smoke], outside, home);
      expect(sign.code, sign.stderr).toBe(0);
    }
    const installedDirectory = resolve(await realpath(alias), "..");
    const installedSmoke = join(installedDirectory, "release-browser-smoke");
    await cp(smoke, installedSmoke);
    const smokeAlias = join(outside, "smoke-alias");
    await symlink(installedSmoke, smokeAlias);
    const browse = await run([smokeAlias, server.url.origin, home], outside, home);
    expect(browse.code, browse.stderr).toBe(0);
    expect(JSON.parse(browse.stdout)).toEqual({ launch: "ok", interaction: "ok", tabs: "ok", storage: "ok", connectOverCDP: "ok", disconnect: "ok" });
    console.log(`Compiled Chrome smoke: ${browse.stdout.trim()}`);

    await writeFile(join(installedDirectory, "agent-browser-app.runtime", "node_modules", "playwright", "package.json"), JSON.stringify({ version: "1.62.0" }));
    const mismatch = await run([smokeAlias, server.url.origin, home], outside, home);
    expect(mismatch.code).not.toBe(0);
    expect(mismatch.stderr).toContain("Release runtime requires playwright@1.63.0");

    await rename(join(installedDirectory, "agent-browser-app.runtime"), join(installedDirectory, "runtime-hidden"));
    const missing = await run([smokeAlias, server.url.origin, home], outside, home);
    expect(missing.code).not.toBe(0);
    expect(missing.stderr).toContain("agent-browser-app.runtime");
    expect(missing.stderr).not.toContain("ambient module loaded");
  } finally {
    server.stop(true);
    await rm(temporary, { recursive: true, force: true });
  }
}, 120_000);
