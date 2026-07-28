import { afterEach, describe, expect, test } from "bun:test";
import {
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const cli = resolve(import.meta.dir, "../src/cli.ts");
const fakeBrowser = resolve(
  import.meta.dir,
  "fixtures/fake-agent-browser.ts",
);
const fakeSystemBrowser = resolve(
  import.meta.dir,
  "fixtures/fake-system-browser.ts",
);
const temporaryDirectories: string[] = [];

async function runCli(
  args: string[],
  home: string,
  environment: NodeJS.ProcessEnv = {},
  command = ["bun", cli],
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  const processHandle = Bun.spawn([...command, ...args], {
    stdout: "pipe",
    stderr: "pipe",
    env: {
      ...process.env,
      AGENT_BROWSER_BIN: fakeBrowser,
      AGENT_BROWSER_HOME: home,
      FAKE_AGENT_BROWSER_STATE: join(home, "fake-runtime.json"),
      FAKE_AGENT_BROWSER_LOG: join(home, "fake-invocations.jsonl"),
      ...environment,
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
    const shortExecutable = join(home, "aba");
    await symlink(cli, shortExecutable);
    const shortHelp = await runCli(
      ["--help"],
      home,
      {},
      [shortExecutable],
    );
    const shortVersion = await runCli(
      ["--version"],
      home,
      {},
      [shortExecutable],
    );
    const packageJson = JSON.parse(
      await readFile(resolve(import.meta.dir, "../package.json"), "utf8"),
    ) as { bin: Record<string, string>; version: string };

    expect(help.exitCode).toBe(0);
    expect(help.stdout).toContain("agent-browser-app gnb auth login");
    expect(help.stdout).toContain("agent-browser-app gnb notebook remove");
    expect(help.stdout).toContain(
      "agent-browser-app gnb notebook source list",
    );
    expect(help.stdout).toContain(
      "agent-browser-app gnb notebook source upload-files",
    );
    expect(help.stdout).toContain(
      "agent-browser-app gnb notebook source add-text",
    );
    expect(help.stdout).toContain(
      "agent-browser-app gnb notebook source add-urls",
    );
    expect(help.stdout).toContain(
      "agent-browser-app gnb notebook source add-drive",
    );
    expect(help.stdout).not.toContain(
      "agent-browser-app gnb notebook upload",
    );
    expect(help.stdout).toContain(
      "agent-browser-app gnb notebook source remove",
    );
    expect(help.stdout).toContain("agent-browser-app x auth login");
    expect(help.stdout).toContain("agent-browser-app x feed");
    expect(help.stdout).toContain("agent-browser-app x profile");
    expect(version.stdout.trim()).toBe(packageJson.version);
    expect(shortHelp.exitCode).toBe(0);
    expect(shortHelp.stdout).toContain("Executable aliases:");
    expect(shortHelp.stdout).toContain("agent-browser-app, aba");
    expect(shortVersion.exitCode).toBe(0);
    expect(shortVersion.stdout.trim()).toBe(packageJson.version);
    expect(packageJson.bin).toEqual({
      "agent-browser-app": "./src/cli.ts",
      aba: "./src/cli.ts",
    });
  });

  test("runs the authenticated X command flow", async () => {
    const home = await createHome();

    const beforeLogin = await runCli(["x", "feed", "--limit", "2"], home);
    expect(beforeLogin.exitCode).toBe(1);
    expect(beforeLogin.stderr).toContain("agent-browser-app x auth login");

    const loginResult = await runCli(
      ["x", "auth", "login", "--timeout", "2"],
      home,
    );
    expect(loginResult.exitCode).toBe(0);
    expect(loginResult.stdout).toContain(
      "Authentication saved for @fixture_user.",
    );

    const accountsResult = await runCli(
      ["twitter", "auth", "list", "--json"],
      home,
    );
    expect(accountsResult.exitCode).toBe(0);
    const accounts = JSON.parse(accountsResult.stdout);
    expect(accounts.accounts).toHaveLength(1);
    expect(accounts.accounts[0].identity).toBe("fixture_user");
    expect(accounts.accounts[0].profileDir).toContain(
      "/apps/agent-browser-app/x/",
    );
    const accountsText = await runCli(["x", "auth", "list"], home);
    expect(accountsText.exitCode).toBe(0);
    expect(accountsText.stdout).toContain("* @fixture_user [default]");

    const feedResult = await runCli(
      ["x", "feed", "--limit", "2", "--json"],
      home,
    );
    expect(feedResult.exitCode).toBe(0);
    const feed = JSON.parse(feedResult.stdout);
    expect(feed.account).toBe("@fixture_user");
    expect(feed.tweets).toHaveLength(2);
    expect(feed.tweets[0].text).toBe("First fixture post");
    expect(feed.tweets[1].author.username).toBe("second_user");
    const feedTextResult = await runCli(
      ["x", "feed", "--limit", "1"],
      home,
    );
    expect(feedTextResult.exitCode).toBe(0);
    expect(feedTextResult.stdout).toContain("First User (@first_user)");
    expect(feedTextResult.stdout).toContain("likes=4");

    const profileResult = await runCli(
      ["x", "profile", "https://twitter.com/OpenAI", "--json"],
      home,
    );
    expect(profileResult.exitCode).toBe(0);
    const profile = JSON.parse(profileResult.stdout);
    expect(profile.id).toBe("4398626122");
    expect(profile.username).toBe("OpenAI");
    expect(profile.followers).toBe(5062117);
    const profileTextResult = await runCli(
      ["x", "profile", "@OpenAI"],
      home,
    );
    expect(profileTextResult.exitCode).toBe(0);
    expect(profileTextResult.stdout).toContain("OpenAI (@OpenAI)");
    expect(profileTextResult.stdout).toContain("Followers: 5062117");

    const numericProfileResult = await runCli(
      ["x", "profile", "4398626122", "--json"],
      home,
    );
    expect(numericProfileResult.exitCode).toBe(0);

    const gnbAccounts = await runCli(
      ["gnb", "auth", "list", "--json"],
      home,
    );
    expect(gnbAccounts.exitCode).toBe(0);
    expect(JSON.parse(gnbAccounts.stdout).accounts).toEqual([]);

    const invocations = (await readFile(
      join(home, "fake-invocations.jsonl"),
      "utf8",
    ))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as string[]);
    expect(
      invocations.some((invocation) =>
        invocation.includes("agent-browser-app-x-default"),
      ),
    ).toBe(true);
    expect(
      invocations.some((invocation) => {
        const stateIndex = invocation.indexOf("state");
        return (
          stateIndex >= 0 &&
          invocation[stateIndex + 1] === "load" &&
          invocation[stateIndex + 2]?.includes(
            "/apps/agent-browser-app/x/",
          )
        );
      }),
    ).toBe(true);
    expect(
      invocations.some((invocation) => {
        const openIndex = invocation.indexOf("open");
        return (
          openIndex >= 0 &&
          invocation[openIndex + 1] ===
            "https://x.com/i/user/4398626122"
        );
      }),
    ).toBe(true);
  }, 20_000);

  test("validates X command arguments and options", async () => {
    const home = await createHome();

    const fractionalLimit = await runCli(
      ["x", "feed", "--limit", "1.5"],
      home,
    );
    expect(fractionalLimit.exitCode).toBe(2);
    expect(fractionalLimit.stderr).toContain("positive integer");

    const missingProfile = await runCli(["x", "profile"], home);
    expect(missingProfile.exitCode).toBe(2);
    expect(missingProfile.stderr).toContain("profile URL, username");

    const reservedProfile = await runCli(
      ["x", "profile", "https://x.com/home"],
      home,
    );
    expect(reservedProfile.exitCode).toBe(2);
    expect(reservedProfile.stderr).toContain("Invalid X profile");

    const unknownOption = await runCli(
      ["x", "auth", "list", "--secret", "value"],
      home,
    );
    expect(unknownOption.exitCode).toBe(2);
    expect(unknownOption.stderr).toContain("Unknown option");
  });

  test("bootstraps X Google login in an isolated system browser", async () => {
    const home = await createHome();
    const systemBrowserLog = join(home, "fake-system-browser.jsonl");
    const systemBrowserDone = join(home, "fake-system-browser.done");

    const result = await runCli(
      [
        "x",
        "auth",
        "login",
        "--account",
        "worktree-test",
        "--system-browser",
        "--timeout",
        "2",
      ],
      home,
      {
        AGENT_BROWSER_APP_SYSTEM_BROWSER_BIN: fakeSystemBrowser,
        FAKE_SYSTEM_BROWSER_LOG: systemBrowserLog,
        FAKE_SYSTEM_BROWSER_DONE: systemBrowserDone,
      },
    );

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Opening system Google Chrome");
    expect(result.stdout).toContain("Authentication saved for @fixture_user.");
    const browserArguments = JSON.parse(
      (await readFile(systemBrowserLog, "utf8")).trim(),
    ) as string[];
    expect(
      browserArguments.some((argument) =>
        argument.startsWith("--user-data-dir="),
      ),
    ).toBe(true);
    expect(
      browserArguments.find((argument) =>
        argument.startsWith("--user-data-dir="),
      ),
    ).toContain(
      "/apps/agent-browser-app/x/accounts/worktree-test/browser-profile",
    );
    expect(browserArguments).toContain("https://x.com/i/flow/login");
    expect(
      browserArguments.some((argument) =>
        argument.startsWith("--remote-debugging-port="),
      ),
    ).toBe(true);

    const invocations = (await readFile(
      join(home, "fake-invocations.jsonl"),
      "utf8",
    ))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as string[]);
    expect(
      invocations.some((invocation) => {
        const cdpIndex = invocation.indexOf("--cdp");
        return (
          cdpIndex >= 0 &&
          Number(invocation[cdpIndex + 1]) > 0
        );
      }),
    ).toBe(true);
    const cdpInvocation = invocations.find((invocation) =>
      invocation.includes("--cdp"),
    );
    expect(cdpInvocation).toBeDefined();
    expect(cdpInvocation).not.toContain("--profile");
    expect(cdpInvocation).not.toContain("--headed");
    expect(
      invocations.some((invocation) => {
        const tabIndex = invocation.indexOf("tab");
        return (
          tabIndex >= 0 &&
          invocation[tabIndex + 1] === "t1"
        );
      }),
    ).toBe(true);
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

  test("validates and removes multiple notebooks by ID", async () => {
    const home = await createHome();
    const loginResult = await runCli(
      ["gnb", "auth", "login", "--timeout", "2"],
      home,
    );
    expect(loginResult.exitCode).toBe(0);

    const missingIds = await runCli(
      [
        "gnb",
        "notebook",
        "remove",
        "untitled-1",
        "missing-notebook",
        "--json",
      ],
      home,
    );
    expect(missingIds.exitCode).toBe(1);
    expect(missingIds.stderr).toContain(
      'Unknown notebook ID "missing-notebook"',
    );

    const unchanged = await runCli(
      ["gnb", "notebook", "list", "--json"],
      home,
    );
    expect(
      JSON.parse(unchanged.stdout).notebooks.map(
        (notebook: { id: string }) => notebook.id,
      ),
    ).toContain("untitled-1");

    const removed = await runCli(
      [
        "gnb",
        "notebook",
        "remove",
        "untitled-1",
        "untitled-2",
        "untitled-1",
        "--json",
      ],
      home,
    );
    expect(removed.exitCode).toBe(0);
    expect(
      JSON.parse(removed.stdout).removed.map(
        (notebook: { id: string }) => notebook.id,
      ),
    ).toEqual(["untitled-1", "untitled-2"]);

    const humanRemoved = await runCli(
      ["gnb", "notebook", "delete", "untitled-3"],
      home,
    );
    expect(humanRemoved.exitCode).toBe(0);
    expect(humanRemoved.stdout).toContain(
      "Removed untitled-3\tUntitled notebook",
    );

    const after = await runCli(
      ["gnb", "notebook", "list", "--json"],
      home,
    );
    expect(
      JSON.parse(after.stdout).notebooks.map(
        (notebook: { id: string }) => notebook.id,
      ),
    ).toEqual(["abc-123"]);

    const missingArgument = await runCli(
      ["gnb", "notebook", "remove"],
      home,
    );
    expect(missingArgument.exitCode).toBe(2);
    expect(missingArgument.stderr).toContain(
      "notebook remove requires at least one notebook ID",
    );
  }, 40_000);

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

  test("adds copied text and multiple URL sources", async () => {
    const home = await createHome();
    const loginResult = await runCli(
      ["gnb", "auth", "login", "--timeout", "2"],
      home,
    );
    expect(loginResult.exitCode).toBe(0);

    const textResult = await runCli(
      [
        "gnb",
        "notebook",
        "source",
        "add-text",
        "Fixture copied text",
        "--id",
        "abc-123",
        "--json",
      ],
      home,
    );
    expect(textResult.exitCode).toBe(0);
    const textPayload = JSON.parse(textResult.stdout);
    expect(textPayload.notebookId).toBe("abc-123");
    expect(textPayload.sources).toEqual([
      {
        id: "source-3",
        title: "Pasted text",
        status: "ready",
        removable: true,
      },
    ]);

    const urlsResult = await runCli(
      [
        "gnb",
        "notebook",
        "source",
        "add-urls",
        "https://example.com/one",
        "https://example.com/two",
        "--id",
        "abc-123",
        "--json",
      ],
      home,
    );
    expect(urlsResult.exitCode).toBe(0);
    const urlsPayload = JSON.parse(urlsResult.stdout);
    expect(urlsPayload.inputUrls).toEqual([
      "https://example.com/one",
      "https://example.com/two",
    ]);
    expect(
      urlsPayload.sources.map((source: { title: string }) => source.title),
    ).toEqual([
      "https://example.com/one",
      "https://example.com/two",
    ]);

    const duplicateUrls = await runCli(
      [
        "gnb",
        "notebook",
        "source",
        "add-urls",
        "https://example.com/same",
        "https://example.com/same",
        "--id",
        "abc-123",
      ],
      home,
    );
    expect(duplicateUrls.exitCode).toBe(2);
    expect(duplicateUrls.stderr).toContain("Source URLs must be unique");

    const invalidUrl = await runCli(
      [
        "gnb",
        "notebook",
        "source",
        "add-urls",
        "not-a-url",
        "--id",
        "abc-123",
      ],
      home,
    );
    expect(invalidUrl.exitCode).toBe(2);
    expect(invalidUrl.stderr).toContain("Invalid source URL");
  }, 35_000);

  test("keeps a Drive URL result selected before inserting it", async () => {
    const home = await createHome();
    const driveUrl =
      "https://drive.google.com/file/d/fixture-drive-id/view?usp=sharing";
    let selectScriptCalls = 0;
    let sourceInserted = false;
    const server = Bun.serve({
      port: 0,
      fetch(request, serverInstance) {
        if (serverInstance.upgrade(request)) {
          return;
        }
        return new Response("Upgrade required", { status: 426 });
      },
      websocket: {
        async message(socket, rawMessage) {
          const message = JSON.parse(String(rawMessage)) as {
            id: number;
            method: string;
            params: Record<string, unknown>;
            sessionId?: string;
          };
          let result: unknown = {};
          if (message.method === "Target.getTargets") {
            result = {
              targetInfos: [
                {
                  targetId: "target-1",
                  type: "page",
                  url: "https://notebooklm.google.com/notebook/abc-123?addSource=true",
                },
              ],
            };
          } else if (message.method === "Target.attachToTarget") {
            result = { sessionId: "session-1" };
          } else if (message.method === "Page.getFrameTree") {
            result = {
              frameTree: {
                frame: {
                  id: "main-frame",
                  url: "https://notebooklm.google.com/notebook/abc-123",
                },
                childFrames: [
                  {
                    frame: {
                      id: "picker-frame",
                      url: "https://docs.google.com/picker/v2/home",
                    },
                  },
                ],
              },
            };
          } else if (message.method === "Page.createIsolatedWorld") {
            result = { executionContextId: 42 };
          } else if (message.method === "Runtime.evaluate") {
            const expression = message.params.expression as string;
            let value: unknown = true;
            if (expression.includes("aba:drive-picker-state")) {
              value = {
                ready: true,
                searchValue: driveUrl,
                searching: false,
                optionCount: 1,
                exactMatchCount: 0,
              };
            } else if (
              expression.includes("aba:drive-picker-selection")
            ) {
              value = { selectedCount: 1, canInsert: true };
            } else if (expression.includes("aba:drive-picker-select")) {
              selectScriptCalls += 1;
            } else if (expression.includes("aba:drive-picker-insert")) {
              if (!sourceInserted) {
                const statePath = join(home, "fake-runtime.json");
                const state = JSON.parse(
                  await readFile(statePath, "utf8"),
                ) as { sources: string[] };
                state.sources.push("Fixture Drive Source");
                await writeFile(statePath, JSON.stringify(state));
                sourceInserted = true;
              }
            }
            result = { result: { value } };
          }
          socket.send(
            JSON.stringify({
              id: message.id,
              result,
              sessionId: message.sessionId,
            }),
          );
        },
      },
    });

    try {
      const loginResult = await runCli(
        ["gnb", "auth", "login", "--timeout", "2"],
        home,
      );
      expect(loginResult.exitCode).toBe(0);
      const result = await runCli(
        [
          "gnb",
          "notebook",
          "source",
          "add-drive",
          driveUrl,
          "--id",
          "abc-123",
          "--json",
        ],
        home,
        { FAKE_CDP_URL: `ws://127.0.0.1:${server.port}` },
      );
      expect(result.exitCode).toBe(0);
      expect(selectScriptCalls).toBe(0);
      expect(sourceInserted).toBe(true);
      expect(
        JSON.parse(result.stdout).sources.map(
          (source: { title: string }) => source.title,
        ),
      ).toEqual(["Fixture Drive Source"]);
    } finally {
      server.stop(true);
    }
  }, 25_000);
});
