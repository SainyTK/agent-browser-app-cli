#!/usr/bin/env bun

import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

const args = process.argv.slice(2);
const logPath = process.env.FAKE_AGENT_BROWSER_LOG;
if (logPath) {
  await mkdir(dirname(logPath), { recursive: true });
  await appendFile(logPath, `${JSON.stringify(args)}\n`);
}
const statePath = (() => {
  const value = process.env.FAKE_AGENT_BROWSER_STATE;
  if (!value) {
    throw new Error("FAKE_AGENT_BROWSER_STATE is required");
  }
  return value;
})();

interface FakeState {
  url: string;
  responsePolls: number;
  submitted: boolean;
  notebooks: Array<{
    id: string;
    title: string;
    description: string;
    url: string;
  }>;
  pendingNotebookId?: string;
  sources: string[];
  pendingSourceIndex?: number;
}

async function readState(): Promise<FakeState> {
  const notebooks = [
    {
      id: "abc-123",
      title: "Test Notebook",
      description: "Fixture notebook",
      url: "https://notebooklm.google.com/notebook/abc-123",
    },
    {
      id: "untitled-1",
      title: "Untitled notebook",
      description: "Fixture removable notebook",
      url: "https://notebooklm.google.com/notebook/untitled-1",
    },
    {
      id: "untitled-2",
      title: "Untitled notebook",
      description: "Fixture removable notebook",
      url: "https://notebooklm.google.com/notebook/untitled-2",
    },
    {
      id: "untitled-3",
      title: "Untitled notebook",
      description: "Fixture removable notebook",
      url: "https://notebooklm.google.com/notebook/untitled-3",
    },
  ];
  const defaults: FakeState = {
    url: "https://notebooklm.google.com/",
    responsePolls: 0,
    submitted: false,
    notebooks,
    sources: ["Fixture Source A", "Fixture Source B"],
  };
  try {
    const parsed = JSON.parse(
      await readFile(statePath, "utf8"),
    ) as Partial<FakeState>;
    return {
      ...defaults,
      ...parsed,
      notebooks: Array.isArray(parsed.notebooks)
        ? parsed.notebooks
        : defaults.notebooks,
      sources: Array.isArray(parsed.sources)
        ? parsed.sources
        : defaults.sources,
    };
  } catch {
    return defaults;
  }
}

async function saveState(state: FakeState): Promise<void> {
  await mkdir(dirname(statePath), { recursive: true });
  await writeFile(statePath, JSON.stringify(state));
}

function output(data: unknown): void {
  console.log(JSON.stringify({ success: true, data, error: null }));
}

function commandIndex(): number {
  const commands = new Set([
    "open",
    "get",
    "eval",
    "click",
    "fill",
    "press",
    "state",
    "tab",
    "close",
  ]);
  return args.findIndex((value) => commands.has(value));
}

const index = commandIndex();
const command = args[index];
const rest = args.slice(index + 1);
const state = await readState();

if (command === "tab" && (!rest[0] || rest[0] === "list")) {
  const reddit = args.includes("agent-browser-app-reddit-default") ||
    args.includes("agent-browser-app-reddit-worktree-test");
  output({
    tabs: [
      {
        active: true,
        label: null,
        tabId: "t1",
        title: reddit ? "Reddit" : "Home / X",
        type: "page",
        url: reddit ? "https://www.reddit.com/" : "https://x.com/home",
      },
    ],
  });
} else if (command === "tab") {
  output({ active: rest[0] });
} else if (command === "open") {
  state.url = rest[0] || "https://notebooklm.google.com/";
  await saveState(state);
  output({ title: "Gemini Notebook", url: state.url });
} else if (command === "get" && rest[0] === "url") {
  output({ url: state.url });
} else if (command === "eval") {
  const encoded = rest[rest.indexOf("-b") + 1];
  const script = Buffer.from(encoded, "base64").toString("utf8");
  if (script.includes("aba:x-auth-state")) {
    output({
      result: {
        authenticated: true,
        loginRequired: false,
        googleRejected: false,
        username: "fixture_user",
        url: "https://x.com/home",
      },
    });
  } else if (script.includes("aba:reddit-auth-state")) {
    output({
      result: {
        authenticated: true,
        loginRequired: false,
        blocked: false,
        username: "fixture_redditor",
        url: "https://www.reddit.com/",
      },
    });
  } else if (script.includes("aba:reddit-feed-scroll")) {
    output({ result: { before: 0, after: 600 } });
  } else if (script.includes("aba:reddit-feed")) {
    output({
      result: {
        loginRequired: false,
        blocked: false,
        ready: true,
        posts: [
          {
            id: "1abcde",
            url: "https://www.reddit.com/r/agentbrowser/comments/1abcde/first_fixture_post/",
            subreddit: "agentbrowser",
            author: {
              username: "first_redditor",
            },
            title: "First fixture post",
            text: "Fixture body",
            createdAt: "2026-07-28T01:00:00.000Z",
            contentUrl: null,
            metrics: {
              score: 42,
              comments: 7,
            },
            nsfw: false,
            spoiler: false,
            promoted: false,
          },
          {
            id: "1fghij",
            url: "https://www.reddit.com/r/typescript/comments/1fghij/second_fixture_post/",
            subreddit: "typescript",
            author: {
              username: "second_redditor",
            },
            title: "Second fixture post",
            text: "",
            createdAt: null,
            contentUrl: "https://example.com/article",
            metrics: {
              score: 13,
              comments: 2,
            },
            nsfw: false,
            spoiler: true,
            promoted: false,
          },
          {
            id: "1klmno",
            url: "https://www.reddit.com/r/bun/comments/1klmno/third_fixture_post/",
            subreddit: "bun",
            author: {
              username: "third_redditor",
            },
            title: "Third fixture post",
            text: "",
            createdAt: null,
            contentUrl: null,
            metrics: {
              score: null,
              comments: null,
            },
            nsfw: false,
            spoiler: false,
            promoted: false,
          },
        ],
      },
    });
  } else if (script.includes("aba:reddit-profile")) {
    output({
      result: {
        loginRequired: false,
        blocked: false,
        unavailableMessage: null,
        ready: true,
        profile: {
          id: "t2_fixture",
          username: "spez",
          name: "spez",
          bio: "Fixture Reddit profile",
          createdAt: "2005-06-23T00:00:00.000Z",
          karma: 123456,
          postKarma: 100000,
          commentKarma: 23456,
          followers: 99,
          admin: true,
          moderator: false,
          url: "https://www.reddit.com/user/spez/",
        },
      },
    });
  } else if (script.includes("aba:x-feed-scroll")) {
    output({ result: { before: 0, after: 600 } });
  } else if (script.includes("aba:x-feed")) {
    output({
      result: {
        loginRequired: false,
        ready: true,
        tweets: [
          {
            id: "2081000000000000001",
            url: "https://x.com/first_user/status/2081000000000000001",
            author: {
              id: "101",
              name: "First User",
              username: "first_user",
            },
            text: "First fixture post",
            createdAt: "2026-07-28T01:00:00.000Z",
            metrics: {
              replies: 1,
              reposts: 2,
              quotes: 3,
              likes: 4,
              views: 5,
            },
          },
          {
            id: "2081000000000000002",
            url: "https://x.com/second_user/status/2081000000000000002",
            author: {
              id: "102",
              name: "Second User",
              username: "second_user",
            },
            text: "Second fixture post",
            createdAt: "2026-07-28T02:00:00.000Z",
            metrics: {
              replies: null,
              reposts: null,
              quotes: null,
              likes: 8,
              views: 13,
            },
          },
          {
            id: "2081000000000000003",
            url: "https://x.com/third_user/status/2081000000000000003",
            author: {
              id: "103",
              name: "Third User",
              username: "third_user",
            },
            text: "Third fixture post",
            createdAt: null,
            metrics: {
              replies: null,
              reposts: null,
              quotes: null,
              likes: null,
              views: null,
            },
          },
        ],
      },
    });
  } else if (script.includes("aba:x-profile")) {
    output({
      result: {
        loginRequired: false,
        unavailableMessage: null,
        ready: true,
        profile: {
          id: "4398626122",
          username: "OpenAI",
          name: "OpenAI",
          bio: "Fixture profile",
          location: "San Francisco",
          website: "https://openai.com",
          joinedAt: "2015-12-06T22:51:08.930Z",
          verified: true,
          protected: false,
          posts: 2016,
          following: 4,
          followers: 5062117,
          url: "https://x.com/OpenAI",
        },
      },
    });
  } else if (script.includes("aba:account-email")) {
    output({ result: "test@example.com" });
  } else if (script.includes("aba:notebook-list")) {
    output({
      result: {
        loginRequired: false,
        ready: true,
        notebooks: state.notebooks,
      },
    });
  } else if (script.includes("aba:onboarding")) {
    output({ result: false });
  } else if (script.includes("aba:create-button")) {
    output({ result: true });
  } else if (script.includes("aba:notebook-read")) {
    output({
      result: {
        url: state.url,
        title: "Test Notebook",
        sources: ["Fixture Source"],
        summary: "Fixture summary",
      },
    });
  } else if (script.includes("aba:query-input")) {
    output({ result: true });
  } else if (script.includes("aba:chat-state")) {
    state.responsePolls += 1;
    await saveState(state);
    const pairs = [
      {
        question: "previous question",
        answer: "Previous answer",
        complete: true,
      },
    ];
    if (state.submitted && state.responsePolls >= 2) {
      pairs.push({
        question: "question",
        answer: "Fixture answer",
        complete: true,
      });
    }
    output({
      result: {
        pairs,
      },
    });
  } else if (script.includes("aba:source-list")) {
    output({
      result: {
        loaded: true,
        expectedSourceCount: state.sources.length,
        sources: state.sources.map((title, sourceIndex) => ({
          id: `source-${sourceIndex + 1}`,
          title,
          status: "ready",
          removable: true,
        })),
      },
    });
  } else if (script.includes("aba:notebook-menu")) {
    const notebookId = JSON.parse(
      script.match(/const notebookId = (".*");/)?.[1] || '""',
    ) as string;
    const found = state.notebooks.some(
      (notebook) => notebook.id === notebookId,
    );
    if (found) {
      state.pendingNotebookId = notebookId;
      await saveState(state);
    }
    output({ result: found });
  } else if (script.includes("aba:notebook-remove-menu-item")) {
    output({ result: true });
  } else if (script.includes("aba:notebook-remove-confirm")) {
    output({ result: true });
  } else if (script.includes("aba:notebook-removal-settled")) {
    output({ result: true });
  } else if (script.includes("aba:source-menu")) {
    const sourceIndex = Number(
      script.match(/const sourceIndex = (\d+);/)?.[1],
    );
    const found =
      Number.isInteger(sourceIndex) &&
      sourceIndex >= 0 &&
      sourceIndex < state.sources.length;
    if (found) {
      state.pendingSourceIndex = sourceIndex;
      await saveState(state);
    }
    output({ result: found });
  } else if (script.includes("aba:source-remove-menu-item")) {
    output({ result: true });
  } else if (script.includes("aba:source-remove-confirm")) {
    output({ result: true });
  } else {
    output({ result: null });
  }
} else if (command === "click") {
  const selector = rest[0] || "";
  if (selector.includes("create-notebook")) {
    state.url = "https://notebooklm.google.com/notebook/new-456";
    await saveState(state);
  } else if (
    selector.includes("confirm-notebook-removal") &&
    state.pendingNotebookId
  ) {
    state.notebooks = state.notebooks.filter(
      (notebook) => notebook.id !== state.pendingNotebookId,
    );
    state.pendingNotebookId = undefined;
    await saveState(state);
  } else if (
    selector.includes("confirm-source-removal") &&
    state.pendingSourceIndex !== undefined
  ) {
    state.sources.splice(state.pendingSourceIndex, 1);
    state.pendingSourceIndex = undefined;
    await saveState(state);
  }
  output({ clicked: true });
} else if (command === "fill") {
  output({ ok: true });
} else if (command === "press") {
  state.submitted = true;
  state.responsePolls = 0;
  await saveState(state);
  output({ ok: true });
} else if (command === "state" && rest[0] === "save") {
  const destination = rest[1];
  await mkdir(dirname(destination), { recursive: true });
  await writeFile(
    destination,
    JSON.stringify({ cookies: [], origins: [] }),
    { mode: 0o600 },
  );
  const systemBrowserDone = process.env.FAKE_SYSTEM_BROWSER_DONE;
  if (systemBrowserDone) {
    await mkdir(dirname(systemBrowserDone), { recursive: true });
    await writeFile(systemBrowserDone, "done");
  }
  output({ path: destination });
} else if (command === "state" && rest[0] === "load") {
  output({ loaded: true, path: rest[1] });
} else if (command === "close") {
  console.log("Browser closed");
} else {
  console.error(`Unsupported fake command: ${command} ${rest.join(" ")}`);
  process.exit(1);
}
