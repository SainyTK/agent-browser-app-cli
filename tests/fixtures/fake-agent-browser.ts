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
  sources: string[];
  pendingSourceIndex?: number;
}

async function readState(): Promise<FakeState> {
  const defaults: FakeState = {
    url: "https://notebooklm.google.com/",
    responsePolls: 0,
    submitted: false,
    sources: ["Fixture Source A", "Fixture Source B"],
  };
  try {
    const parsed = JSON.parse(
      await readFile(statePath, "utf8"),
    ) as Partial<FakeState>;
    return {
      ...defaults,
      ...parsed,
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
    "close",
  ]);
  return args.findIndex((value) => commands.has(value));
}

const index = commandIndex();
const command = args[index];
const rest = args.slice(index + 1);
const state = await readState();

if (command === "open") {
  state.url = rest[0] || "https://notebooklm.google.com/";
  await saveState(state);
  output({ title: "Gemini Notebook", url: state.url });
} else if (command === "get" && rest[0] === "url") {
  output({ url: state.url });
} else if (command === "eval") {
  const encoded = rest[rest.indexOf("-b") + 1];
  const script = Buffer.from(encoded, "base64").toString("utf8");
  if (script.includes("aba:account-email")) {
    output({ result: "test@example.com" });
  } else if (script.includes("aba:notebook-list")) {
    output({
      result: {
        loginRequired: false,
        ready: true,
        notebooks: [
          {
            id: "abc-123",
            title: "Test Notebook",
            description: "Fixture notebook",
            url: "https://notebooklm.google.com/notebook/abc-123",
          },
        ],
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
  output({ path: destination });
} else if (command === "state" && rest[0] === "load") {
  output({ loaded: true, path: rest[1] });
} else if (command === "close") {
  console.log("Browser closed");
} else {
  console.error(`Unsupported fake command: ${command} ${rest.join(" ")}`);
  process.exit(1);
}
