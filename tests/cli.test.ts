import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const cli = resolve(import.meta.dir, "../src/cli.ts");
const fakeBrowser = resolve(
  import.meta.dir,
  "fixtures/fake-agent-browser.ts",
);
const temporaryDirectories: string[] = [];

async function runCli(
  args: string[],
  home: string,
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  const processHandle = Bun.spawn(["bun", cli, ...args], {
    stdout: "pipe",
    stderr: "pipe",
    env: {
      ...process.env,
      AGENT_BROWSER_BIN: fakeBrowser,
      AGENT_BROWSER_HOME: home,
      FAKE_AGENT_BROWSER_STATE: join(home, "fake-runtime.json"),
      FAKE_AGENT_BROWSER_LOG: join(home, "fake-invocations.jsonl"),
    },
  });
  const [exitCode, stdout, stderr] = await Promise.all([
    processHandle.exited,
    new Response(processHandle.stdout).text(),
    new Response(processHandle.stderr).text(),
  ]);
  return { exitCode, stdout, stderr };
}

async function createHome(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "agent-browser-app-test-"));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(async () => {
  const directories = temporaryDirectories.splice(0);
  await Promise.all(
    directories.map((directory) => rm(directory, { recursive: true })),
  );
});

describe("agent-browser-app CLI", () => {
  test("prints help and version", async () => {
    const home = await createHome();
    const help = await runCli(["--help"], home);
    const version = await runCli(["--version"], home);

    expect(help.exitCode).toBe(0);
    expect(help.stdout).toContain("agent-browser-app gnb auth login");
    expect(help.stdout).toContain(
      "agent-browser-app gnb notebook source list",
    );
    expect(help.stdout).toContain(
      "agent-browser-app gnb notebook source upload-files",
    );
    expect(help.stdout).not.toContain(
      "agent-browser-app gnb notebook upload",
    );
    expect(help.stdout).toContain(
      "agent-browser-app gnb notebook source remove",
    );
    expect(version.stdout.trim()).toBe("0.1.0");
  });

  test("runs the authenticated Gemini Notebook command flow", async () => {
    const home = await createHome();

    const loginResult = await runCli(
      ["gnb", "auth", "login", "--account", "test@example.com", "--timeout", "2"],
      home,
    );
    expect(loginResult.exitCode).toBe(0);
    expect(loginResult.stdout).toContain(
      "Authentication saved for test@example.com.",
    );
    const loginInvocations = (await readFile(
      join(home, "fake-invocations.jsonl"),
      "utf8",
    ))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as string[]);
    for (const invocation of loginInvocations) {
      const headedIndex = invocation.indexOf("--headed");
      expect(headedIndex).toBeGreaterThanOrEqual(0);
      expect(invocation[headedIndex + 1]).toBe("true");
    }

    const accountsResult = await runCli(
      ["gnb", "auth", "list", "--json"],
      home,
    );
    expect(accountsResult.exitCode).toBe(0);
    expect(JSON.parse(accountsResult.stdout).accounts).toHaveLength(1);

    const listResult = await runCli(
      ["gnb", "notebook", "list", "--json"],
      home,
    );
    expect(listResult.exitCode).toBe(0);
    expect(JSON.parse(listResult.stdout).notebooks[0].title).toBe(
      "Test Notebook",
    );
    const allInvocations = (await readFile(
      join(home, "fake-invocations.jsonl"),
      "utf8",
    ))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as string[]);
    expect(
      allInvocations.some((invocation) => invocation.includes("--state")),
    ).toBe(false);
    const stateLoadIndex = allInvocations.findIndex((invocation) => {
      const stateIndex = invocation.indexOf("state");
      return stateIndex >= 0 && invocation[stateIndex + 1] === "load";
    });
    expect(stateLoadIndex).toBeGreaterThanOrEqual(0);
    const stagedOpen = allInvocations[stateLoadIndex - 1];
    const stagedOpenIndex = stagedOpen.indexOf("open");
    expect(stagedOpen.slice(stagedOpenIndex + 1)).toEqual([]);
    const navigationOpen = allInvocations[stateLoadIndex + 1];
    const navigationOpenIndex = navigationOpen.indexOf("open");
    expect(navigationOpen[navigationOpenIndex + 1]).toBe(
      "https://notebooklm.google.com/",
    );

    const createResult = await runCli(
      ["gnb", "notebook", "create", "--json"],
      home,
    );
    expect(createResult.exitCode).toBe(0);
    expect(JSON.parse(createResult.stdout).id).toBe("new-456");

    const readResult = await runCli(
      ["gnb", "notebook", "read", "abc-123", "--json"],
      home,
    );
    expect(readResult.exitCode).toBe(0);
    expect(JSON.parse(readResult.stdout).sources).toEqual(["Fixture Source"]);

    const askResult = await runCli(
      [
        "gnb",
        "notebook",
        "ask",
        "question",
        "--id",
        "abc-123",
        "--timeout",
        "8",
      ],
      home,
    );
    expect(askResult.exitCode).toBe(0);
    expect(askResult.stdout.trim()).toBe("Fixture answer");

    const missingUpload = await runCli(
      [
        "gnb",
        "notebook",
        "source",
        "upload-files",
        "/does/not/exist-a.m4a",
        "/does/not/exist-b.pdf",
        "--id",
        "abc-123",
      ],
      home,
    );
    expect(missingUpload.exitCode).toBe(1);
    expect(missingUpload.stderr).toContain("Could not read upload file");

    const removedUploadCommand = await runCli(
      [
        "gnb",
        "notebook",
        "upload",
        "/does/not/exist.m4a",
        "--id",
        "abc-123",
      ],
      home,
    );
    expect(removedUploadCommand.exitCode).toBe(2);
    expect(removedUploadCommand.stderr).toContain(
      "Unknown notebook command: upload",
    );

    const completedInvocations = (await readFile(
      join(home, "fake-invocations.jsonl"),
      "utf8",
    ))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as string[]);
    const stateSaves = completedInvocations.filter((invocation) => {
      const stateIndex = invocation.indexOf("state");
      return stateIndex >= 0 && invocation[stateIndex + 1] === "save";
    });
    expect(stateSaves).toHaveLength(1);
  }, 20_000);

  test("reports a useful error before login", async () => {
    const home = await createHome();
    const result = await runCli(["gnb", "notebook", "list"], home);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("auth login");
  });

  test("lists and removes multiple notebook sources", async () => {
    const home = await createHome();
    const loginResult = await runCli(
      ["gnb", "auth", "login", "--timeout", "2"],
      home,
    );
    expect(loginResult.exitCode).toBe(0);

    const before = await runCli(
      [
        "gnb",
        "notebook",
        "source",
        "list",
        "--id",
        "abc-123",
        "--json",
      ],
      home,
    );
    expect(before.exitCode).toBe(0);
    expect(
      JSON.parse(before.stdout).sources.map(
        (source: { id: string }) => source.id,
      ),
    ).toEqual(["source-1", "source-2"]);

    const invalidRemoval = await runCli(
      [
        "gnb",
        "notebook",
        "source",
        "remove",
        "source-1",
        "source-99",
        "--id",
        "abc-123",
      ],
      home,
    );
    expect(invalidRemoval.exitCode).toBe(1);
    expect(invalidRemoval.stderr).toContain(
      'Unknown source ID "source-99"',
    );

    const unchanged = await runCli(
      [
        "gnb",
        "notebook",
        "source",
        "list",
        "--id",
        "abc-123",
        "--json",
      ],
      home,
    );
    expect(unchanged.exitCode).toBe(0);
    expect(JSON.parse(unchanged.stdout).sources).toHaveLength(2);

    const removed = await runCli(
      [
        "gnb",
        "notebook",
        "source",
        "remove",
        "source-1",
        "source-2",
        "--id",
        "abc-123",
        "--json",
      ],
      home,
    );
    expect(removed.exitCode).toBe(0);
    expect(
      JSON.parse(removed.stdout).removed.map(
        (source: { id: string }) => source.id,
      ),
    ).toEqual(["source-1", "source-2"]);

    const after = await runCli(
      [
        "gnb",
        "notebook",
        "source",
        "list",
        "--id",
        "abc-123",
        "--json",
      ],
      home,
    );
    expect(after.exitCode).toBe(0);
    expect(JSON.parse(after.stdout).sources).toEqual([]);
  }, 45_000);
});
