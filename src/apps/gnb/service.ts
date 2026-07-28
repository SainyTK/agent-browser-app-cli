import { access, realpath, stat } from "node:fs/promises";
import { basename } from "node:path";
import { AgentBrowser } from "../../agent-browser.ts";
import {
  NOTEBOOK_HOME_URL,
  NOTEBOOK_URL_PATTERN,
} from "../../config.ts";
import { CliError } from "../../errors.ts";
import type { Account } from "../../registry.ts";
import {
  detectAccountEmailScript,
  insertDrivePickerSelectionScript,
  listNotebooksScript,
  markCopiedTextInputScript,
  markConfirmNotebookRemovalScript,
  markCreateButtonScript,
  markConfirmSourceRemovalScript,
  markNotebookMenuButtonScript,
  markOnboardingButtonScript,
  markQueryInputScript,
  markRemoveNotebookMenuItemScript,
  markRemoveSourceMenuItemScript,
  markSourceDialogOptionScript,
  markSourceInsertButtonScript,
  markSourceMenuButtonScript,
  markUrlsInputScript,
  notebookRemovalSettledScript,
  markUploadButtonScript,
  readChatStateScript,
  readDrivePickerSelectionScript,
  readDrivePickerStateScript,
  readNotebookScript,
  readSourcesScript,
  readUploadStatusScript,
  selectDrivePickerItemScript,
} from "./browser-scripts.ts";

export interface NotebookSummary {
  id: string;
  title: string;
  description: string;
  url: string;
}

export interface SourceSummary {
  id: string;
  title: string;
  status: "ready" | "processing" | "error";
  removable: boolean;
}

interface SourceListState {
  loaded: boolean;
  expectedSourceCount: number | null;
  sources: SourceSummary[];
}

interface ListResult {
  loginRequired: boolean;
  ready: boolean;
  notebooks: NotebookSummary[];
}

interface ChatPair {
  question: string | null;
  answer: string | null;
  complete: boolean;
}

interface ChatState {
  pairs: ChatPair[];
}

const delay = (milliseconds: number) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

async function waitUntil<T>(
  operation: () => Promise<T>,
  predicate: (value: T) => boolean,
  timeoutMs: number,
  intervalMs = 750,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  let latest = await operation();
  while (!predicate(latest) && Date.now() < deadline) {
    await delay(intervalMs);
    latest = await operation();
  }
  return latest;
}

function isNotebookHome(url: string): boolean {
  try {
    const parsed = new URL(url);
    return (
      (
        parsed.hostname === "notebooklm.google.com" ||
        parsed.hostname === "notebook.google.com"
      ) &&
      !parsed.pathname.startsWith("/login")
    );
  } catch {
    return false;
  }
}

function normalizeChatText(value: string | null): string {
  return (value || "").replace(/\s+/g, " ").trim();
}

async function readStableChatState(
  browser: AgentBrowser,
  timeoutMs = 10_000,
): Promise<ChatState> {
  const deadline = Date.now() + timeoutMs;
  let latest = await browser.eval<ChatState>(readChatStateScript);
  let previousSignature = JSON.stringify(latest);
  let stablePolls = 1;
  while (Date.now() < deadline) {
    await delay(500);
    latest = await browser.eval<ChatState>(readChatStateScript);
    const signature = JSON.stringify(latest);
    if (signature === previousSignature) {
      stablePolls += 1;
      if (stablePolls >= 3) {
        return latest;
      }
    } else {
      previousSignature = signature;
      stablePolls = 1;
    }
  }
  return latest;
}

async function requireState(account: Account): Promise<void> {
  try {
    await access(account.stateFile);
  } catch {
    throw new CliError(
      `Account "${account.email || account.id}" has no state.json. Run: agent-browser-app gnb auth login${account.email ? ` --account ${account.email}` : ""}`,
    );
  }
}

async function runAuthenticated<T>(
  account: Account,
  operation: (browser: AgentBrowser) => Promise<T>,
): Promise<T> {
  await requireState(account);
  const browser = new AgentBrowser(account);
  try {
    return await operation(browser);
  } finally {
    await browser.close();
  }
}

function assertAuthenticated(url: string): void {
  if (new URL(url).hostname === "accounts.google.com") {
    throw new CliError(
      "Google authentication has expired. Run: agent-browser-app gnb auth login",
    );
  }
}

export async function login(
  account: Account,
  timeoutSeconds: number,
  onWaiting: () => void,
): Promise<string | undefined> {
  const browser = new AgentBrowser(account);
  try {
    await browser.open(NOTEBOOK_HOME_URL, true);
    onWaiting();
    const url = await waitUntil(
      () => browser.currentUrl(),
      isNotebookHome,
      timeoutSeconds * 1000,
      1000,
    );
    if (!isNotebookHome(url)) {
      throw new CliError(
        `Authentication did not finish within ${timeoutSeconds} seconds.`,
      );
    }
    await delay(1500);
    const email =
      (await browser.eval<string | null>(detectAccountEmailScript)) || undefined;
    await browser.saveState();
    return email;
  } finally {
    await browser.close();
  }
}

export async function listNotebooks(
  account: Account,
  headed: boolean,
): Promise<NotebookSummary[]> {
  return runAuthenticated(account, async (browser) => {
    await browser.open(NOTEBOOK_HOME_URL, headed);
    assertAuthenticated(await browser.currentUrl());
    const onboarding = await browser.eval<boolean>(markOnboardingButtonScript);
    if (onboarding) {
      await browser.click('[data-agent-browser-app-target="onboarding"]');
      await delay(1500);
    }
    const result = await waitUntil<ListResult>(
      () => browser.eval<ListResult>(listNotebooksScript),
      (value) => value.loginRequired || value.ready || value.notebooks.length > 0,
      20_000,
    );
    if (result.loginRequired) {
      throw new CliError(
        "Google authentication has expired. Run: agent-browser-app gnb auth login",
      );
    }
    return result.notebooks;
  });
}

export async function createNotebook(
  account: Account,
  headed: boolean,
): Promise<{ id: string; url: string }> {
  return runAuthenticated(account, async (browser) => {
    await browser.open(NOTEBOOK_HOME_URL, headed);
    assertAuthenticated(await browser.currentUrl());
    const marked = await waitUntil(
      () => browser.eval<boolean>(markCreateButtonScript),
      Boolean,
      20_000,
    );
    if (!marked) {
      throw new CliError(
        "Could not find the Gemini Notebook create button. Retry with --headed to inspect the current interface.",
      );
    }
    await browser.click('[data-agent-browser-app-target="create-notebook"]');
    const url = await waitUntil(
      () => browser.currentUrl(),
      (value) => {
        const match = value.match(NOTEBOOK_URL_PATTERN);
        return Boolean(match && match[1] !== "creating");
      },
      30_000,
    );
    const match = url.match(NOTEBOOK_URL_PATTERN);
    if (!match || match[1] === "creating") {
      throw new CliError(
        "Gemini Notebook did not navigate to a new notebook after the create action.",
      );
    }
    return { id: match[1], url: `https://notebooklm.google.com/notebook/${match[1]}` };
  });
}

function notebookId(target: string): string | undefined {
  return directNotebookUrl(target)?.match(NOTEBOOK_URL_PATTERN)?.[1];
}

export async function removeNotebooks(
  account: Account,
  notebookIds: string[],
  headed: boolean,
): Promise<{
  removed: NotebookSummary[];
}> {
  const requestedIds = Array.from(
    new Set(
      notebookIds.map((target) => {
        const id = notebookId(target);
        if (!id) {
          throw new CliError(`Invalid Gemini Notebook ID or URL: ${target}.`);
        }
        return id;
      }),
    ),
  );
  if (requestedIds.length === 0) {
    throw new CliError(
      "notebook remove requires at least one notebook ID.",
      2,
    );
  }

  return runAuthenticated(account, async (browser) => {
    await browser.open(NOTEBOOK_HOME_URL, headed);
    assertAuthenticated(await browser.currentUrl());
    const initial = await waitUntil<ListResult>(
      () => browser.eval<ListResult>(listNotebooksScript),
      (value) =>
        value.loginRequired || value.ready || value.notebooks.length > 0,
      20_000,
    );
    if (initial.loginRequired) {
      throw new CliError(
        "Google authentication has expired. Run: agent-browser-app gnb auth login",
      );
    }
    const targets = requestedIds.map((id) => {
      const notebook = initial.notebooks.find((candidate) => candidate.id === id);
      if (!notebook) {
        throw new CliError(
          `Unknown notebook ID "${id}". Run notebook list again and use an ID from the current output.`,
        );
      }
      return notebook;
    });

    for (const target of targets) {
      await browser.open(NOTEBOOK_HOME_URL, headed);
      assertAuthenticated(await browser.currentUrl());
      const current = await waitUntil<ListResult>(
        () => browser.eval<ListResult>(listNotebooksScript),
        (value) =>
          value.loginRequired ||
          value.notebooks.some((notebook) => notebook.id === target.id),
        20_000,
      );
      if (current.loginRequired) {
        throw new CliError(
          "Google authentication has expired. Run: agent-browser-app gnb auth login",
        );
      }
      if (!current.notebooks.some((notebook) => notebook.id === target.id)) {
        throw new CliError(
          `Gemini Notebook did not reload notebook "${target.id}" before removal.`,
        );
      }
      const menuMarked = await browser.eval<boolean>(
        markNotebookMenuButtonScript(target.id),
      );
      if (!menuMarked) {
        throw new CliError(
          `Could not open the menu for notebook "${target.id}".`,
        );
      }
      await browser.click(
        '[data-agent-browser-app-target="notebook-menu"]',
      );
      const removeMarked = await waitUntil(
        () => browser.eval<boolean>(markRemoveNotebookMenuItemScript),
        Boolean,
        10_000,
        250,
      );
      if (!removeMarked) {
        throw new CliError(
          `Could not find the remove action for notebook "${target.id}".`,
        );
      }
      await browser.click(
        '[data-agent-browser-app-target="remove-notebook"]',
      );
      const confirmMarked = await waitUntil(
        () => browser.eval<boolean>(markConfirmNotebookRemovalScript),
        Boolean,
        10_000,
        250,
      );
      if (!confirmMarked) {
        throw new CliError(
          `Gemini Notebook did not show a removal confirmation for notebook "${target.id}".`,
        );
      }
      await browser.click(
        '[data-agent-browser-app-target="confirm-notebook-removal"]',
      );
      const settled = await waitUntil(
        () => browser.eval<boolean>(notebookRemovalSettledScript),
        Boolean,
        10_000,
        250,
      );
      if (!settled) {
        throw new CliError(
          `Gemini Notebook did not finish closing the removal dialog for notebook "${target.id}".`,
        );
      }
      const remaining = await waitUntil<ListResult>(
        () => browser.eval<ListResult>(listNotebooksScript),
        (value) =>
          value.ready &&
          !value.notebooks.some((notebook) => notebook.id === target.id),
        20_000,
        500,
      );
      if (
        !remaining.ready ||
        remaining.notebooks.some((notebook) => notebook.id === target.id)
      ) {
        throw new CliError(
          `Gemini Notebook did not remove notebook "${target.id}".`,
        );
      }
    }

    return { removed: targets };
  });
}

async function resolveNotebookUrl(
  account: Account,
  target: string,
  headed: boolean,
): Promise<string> {
  if (NOTEBOOK_URL_PATTERN.test(target)) {
    return target;
  }
  if (/^[a-zA-Z0-9_-]+$/.test(target)) {
    return `https://notebooklm.google.com/notebook/${target}`;
  }
  const notebooks = await listNotebooks(account, headed);
  const normalized = target.trim().toLowerCase();
  const match = notebooks.find(
    (notebook) => notebook.title.trim().toLowerCase() === normalized,
  );
  if (!match) {
    throw new CliError(`Could not resolve notebook "${target}".`);
  }
  return match.url;
}

function directNotebookUrl(target: string): string | undefined {
  const trimmed = target.trim();
  const match = trimmed.match(NOTEBOOK_URL_PATTERN);
  if (match) {
    return `https://notebooklm.google.com/notebook/${match[1]}`;
  }
  if (/^[a-zA-Z0-9_-]+$/.test(trimmed)) {
    return `https://notebooklm.google.com/notebook/${trimmed}`;
  }
  return undefined;
}

export async function readNotebook(
  account: Account,
  target: string,
  headed: boolean,
): Promise<{
  id: string;
  url: string;
  title: string;
  sources: string[];
  summary: string | null;
}> {
  const url = await resolveNotebookUrl(account, target, headed);
  return runAuthenticated(account, async (browser) => {
    await browser.open(url, headed);
    assertAuthenticated(await browser.currentUrl());
    const currentUrl = await waitUntil(
      () => browser.currentUrl(),
      (value) => NOTEBOOK_URL_PATTERN.test(value),
      15_000,
    );
    const match = currentUrl.match(NOTEBOOK_URL_PATTERN);
    if (!match) {
      throw new CliError(`Gemini Notebook did not open "${target}".`);
    }
    await delay(2000);
    const result = await browser.eval<{
      url: string;
      title: string;
      sources: string[];
      summary: string | null;
    }>(readNotebookScript);
    return { id: match[1], ...result };
  });
}

export async function askNotebook(
  account: Account,
  question: string,
  target: string,
  headed: boolean,
  timeoutSeconds: number,
): Promise<{ question: string; answer: string; url: string }> {
  const url = directNotebookUrl(target);
  if (!url) {
    throw new CliError(
      `Invalid Gemini Notebook ID or URL: ${target}.`,
    );
  }
  return runAuthenticated(account, async (browser) => {
    await browser.open(url, headed);
    assertAuthenticated(await browser.currentUrl());
    const marked = await waitUntil(
      () => browser.eval<boolean>(markQueryInputScript),
      Boolean,
      30_000,
    );
    if (!marked) {
      throw new CliError(
        "Could not find the Gemini Notebook query input. Retry with --headed to inspect the current interface.",
      );
    }
    const before = await readStableChatState(browser);
    const normalizedQuestion = normalizeChatText(question);
    await browser.fill('[data-agent-browser-app-target="query"]', question);
    await browser.press("Enter");

    const deadline = Date.now() + timeoutSeconds * 1000;
    let candidate = "";
    let stablePolls = 0;
    while (Date.now() < deadline) {
      await delay(1000);
      const current = await browser.eval<ChatState>(readChatStateScript);
      const newPairs = current.pairs.slice(before.pairs.length);
      const responsePair =
        newPairs.find(
          (pair) =>
            normalizeChatText(pair.question) === normalizedQuestion,
        ) ??
        (newPairs.length === 1 ? newPairs[0] : undefined);
      const answer = responsePair?.answer?.trim() || "";
      if (responsePair?.complete && answer) {
        if (answer === candidate) {
          stablePolls += 1;
          if (stablePolls >= 2) {
            return { question, answer, url };
          }
        } else {
          candidate = answer;
          stablePolls = 1;
        }
      } else {
        candidate = answer;
        stablePolls = 0;
      }
    }
    throw new CliError(
      `Gemini Notebook did not return a stable answer within ${timeoutSeconds} seconds.`,
    );
  });
}

export async function uploadNotebookFiles(
  account: Account,
  target: string,
  inputPaths: string[],
  headed: boolean,
  timeoutSeconds: number,
): Promise<{
  files: Array<{ file: string; status: "ready" }>;
  url: string;
}> {
  const url = directNotebookUrl(target);
  if (!url) {
    throw new CliError(`Invalid Gemini Notebook ID or URL: ${target}.`);
  }
  if (inputPaths.length === 0) {
    throw new CliError(
      "notebook source upload-files requires at least one file path.",
      2,
    );
  }
  const files = await Promise.all(
    inputPaths.map(async (inputPath) => {
      try {
        const filePath = await realpath(inputPath);
        const fileStat = await stat(filePath);
        if (!fileStat.isFile()) {
          throw new Error("path is not a file");
        }
        return { file: filePath, title: basename(filePath) };
      } catch (error) {
        throw new CliError(
          `Could not read upload file "${inputPath}": ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }),
  );
  const duplicateTitles = files
    .map((file) => file.title.toLowerCase())
    .filter((title, index, titles) => titles.indexOf(title) !== index);
  if (duplicateTitles.length > 0) {
    throw new CliError(
      `Upload paths must have unique filenames. Duplicate: ${duplicateTitles[0]}`,
      2,
    );
  }

  return runAuthenticated(account, async (browser) => {
    const uploadUrl = `${url}?addSource=true`;
    await browser.open(uploadUrl, headed);
    assertAuthenticated(await browser.currentUrl());
    const marked = await waitUntil(
      () => browser.eval<boolean>(markUploadButtonScript),
      Boolean,
      30_000,
    );
    if (!marked) {
      throw new CliError(
        "Could not find the Gemini Notebook upload-files control. Retry with --headed to inspect the current interface.",
      );
    }
    const initial = await loadSources(browser);
    const baselineCounts = new Map<string, number>();
    for (const source of initial.sources) {
      const normalizedTitle = source.title.toLowerCase();
      baselineCounts.set(
        normalizedTitle,
        (baselineCounts.get(normalizedTitle) || 0) + 1,
      );
    }
    await browser.uploadFilesThroughFileChooser(
      '[data-agent-browser-app-target="upload"]',
      files.map((file) => file.file),
    );

    interface UploadStatus {
      newItemPresent: boolean;
      ready: boolean;
      dialogOpen: boolean;
      processing: boolean;
      error: string | null;
      matchingCount: number;
    }
    const deadline = Date.now() + timeoutSeconds * 1000;
    let statuses: UploadStatus[] = [];
    while (Date.now() < deadline) {
      statuses = [];
      for (const file of files) {
        statuses.push(
          await browser.eval<UploadStatus>(
            readUploadStatusScript(
              file.title,
              baselineCounts.get(file.title.toLowerCase()) || 0,
            ),
          ),
        );
      }
      const failedIndex = statuses.findIndex((status) => status.error);
      if (failedIndex >= 0) {
        throw new CliError(
          `Gemini Notebook upload failed for "${files[failedIndex].title}": ${statuses[failedIndex].error}`,
        );
      }
      if (statuses.every((status) => status.ready)) {
        return {
          files: files.map((file) => ({
            file: file.file,
            status: "ready" as const,
          })),
          url,
        };
      }
      await delay(1000);
    }
    const missing = files.filter(
      (_file, index) => !statuses[index]?.newItemPresent,
    );
    if (missing.length > 0) {
      throw new CliError(
        `Gemini Notebook did not accept ${missing.map((file) => `"${file.title}"`).join(", ")} within ${timeoutSeconds} seconds.`,
      );
    }
    const processing = files.filter(
      (_file, index) => !statuses[index]?.ready,
    );
    throw new CliError(
      `Gemini Notebook did not finish processing ${processing.map((file) => `"${file.title}"`).join(", ")} within ${timeoutSeconds} seconds.`,
    );
  });
}

async function loadSources(
  browser: AgentBrowser,
  timeoutMs = 30_000,
): Promise<SourceListState> {
  await delay(2000);
  let state = await waitUntil<SourceListState>(
    () => browser.eval(readSourcesScript),
    (value) => value.loaded,
    timeoutMs,
    500,
  );
  if (!state.loaded) {
    throw new CliError(
      "Gemini Notebook did not finish loading its source list.",
    );
  }
  const deadline = Date.now() + timeoutMs;
  let signature = JSON.stringify(state);
  let stablePolls = 1;
  while (Date.now() < deadline) {
    await delay(500);
    state = await browser.eval<SourceListState>(readSourcesScript);
    const nextSignature = JSON.stringify(state);
    if (state.loaded && nextSignature === signature) {
      stablePolls += 1;
      if (stablePolls >= 4) {
        return state;
      }
    } else {
      signature = nextSignature;
      stablePolls = 1;
    }
  }
  throw new CliError(
    "Gemini Notebook source list did not become stable.",
  );
}

interface AddedSourcesResult {
  notebookId: string;
  url: string;
  sources: SourceSummary[];
}

function addedSourcesSince(
  baseline: SourceSummary[],
  current: SourceSummary[],
): SourceSummary[] {
  const baselineCounts = new Map<string, number>();
  for (const source of baseline) {
    const title = source.title.trim().toLowerCase();
    baselineCounts.set(title, (baselineCounts.get(title) || 0) + 1);
  }
  return current.filter((source) => {
    const title = source.title.trim().toLowerCase();
    const remaining = baselineCounts.get(title) || 0;
    if (remaining > 0) {
      baselineCounts.set(title, remaining - 1);
      return false;
    }
    return true;
  });
}

async function waitForAddedSources(
  browser: AgentBrowser,
  baseline: SourceSummary[],
  expectedCount: number,
  timeoutSeconds: number,
  description: string,
): Promise<SourceSummary[]> {
  const deadline = Date.now() + timeoutSeconds * 1000;
  let latest: SourceSummary[] = [];
  while (Date.now() < deadline) {
    const state = await browser.eval<SourceListState>(readSourcesScript);
    latest = addedSourcesSince(baseline, state.sources);
    const failed = latest.find((source) => source.status === "error");
    if (failed) {
      throw new CliError(
        `Gemini Notebook marked the new ${description} source "${failed.title}" as failed.`,
      );
    }
    if (
      state.loaded &&
      latest.length >= expectedCount &&
      latest.every((source) => source.status === "ready")
    ) {
      return latest;
    }
    await delay(1000);
  }
  if (latest.length < expectedCount) {
    throw new CliError(
      `Gemini Notebook did not accept ${description} within ${timeoutSeconds} seconds.`,
    );
  }
  throw new CliError(
    `Gemini Notebook did not finish processing ${description} within ${timeoutSeconds} seconds.`,
  );
}

async function markAndClickSourceOption(
  browser: AgentBrowser,
  option: "copied-text" | "websites" | "drive",
): Promise<void> {
  const marked = await waitUntil(
    () => browser.eval<boolean>(markSourceDialogOptionScript(option)),
    Boolean,
    30_000,
    500,
  );
  if (!marked) {
    throw new CliError(
      `Could not find the Gemini Notebook ${option} source control. Retry with --headed to inspect the current interface.`,
    );
  }
  await browser.click(
    `[data-agent-browser-app-target="source-option-${option}"]`,
  );
}

async function addSourcesFromDialog(
  account: Account,
  target: string,
  headed: boolean,
  timeoutSeconds: number,
  expectedCount: number,
  description: string,
  submit: (browser: AgentBrowser) => Promise<void>,
): Promise<AddedSourcesResult> {
  const url = directNotebookUrl(target);
  const match = url?.match(NOTEBOOK_URL_PATTERN);
  if (!url || !match) {
    throw new CliError(`Invalid Gemini Notebook ID or URL: ${target}.`);
  }
  return runAuthenticated(account, async (browser) => {
    await browser.open(`${url}?addSource=true`, headed);
    assertAuthenticated(await browser.currentUrl());
    const baseline = await loadSources(browser);
    await submit(browser);
    const sources = await waitForAddedSources(
      browser,
      baseline.sources,
      expectedCount,
      timeoutSeconds,
      description,
    );
    return {
      notebookId: match[1],
      url,
      sources,
    };
  });
}

export async function addTextSource(
  account: Account,
  target: string,
  text: string,
  headed: boolean,
  timeoutSeconds: number,
): Promise<AddedSourcesResult> {
  if (!text.trim()) {
    throw new CliError(
      "notebook source add-text requires non-empty text content.",
      2,
    );
  }
  return addSourcesFromDialog(
    account,
    target,
    headed,
    timeoutSeconds,
    1,
    "copied text",
    async (browser) => {
      await markAndClickSourceOption(browser, "copied-text");
      const inputMarked = await waitUntil(
        () => browser.eval<boolean>(markCopiedTextInputScript),
        Boolean,
        15_000,
        250,
      );
      if (!inputMarked) {
        throw new CliError(
          "Could not find the Gemini Notebook copied-text input. Retry with --headed to inspect the current interface.",
        );
      }
      await browser.fill(
        '[data-agent-browser-app-target="copied-text-input"]',
        text,
      );
      const insertMarked = await waitUntil(
        () => browser.eval<boolean>(markSourceInsertButtonScript),
        Boolean,
        10_000,
        250,
      );
      if (!insertMarked) {
        throw new CliError(
          "Gemini Notebook did not enable the copied-text Insert action.",
        );
      }
      await browser.click(
        '[data-agent-browser-app-target="source-insert"]',
      );
    },
  );
}

function normalizeSourceUrls(inputUrls: string[]): string[] {
  if (inputUrls.length === 0) {
    throw new CliError(
      "notebook source add-urls requires at least one URL.",
      2,
    );
  }
  const urls = inputUrls.map((input) => {
    let parsed: URL;
    try {
      parsed = new URL(input);
    } catch {
      throw new CliError(`Invalid source URL: ${input}.`, 2);
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      throw new CliError(
        `Source URL must use http or https: ${input}.`,
        2,
      );
    }
    return parsed.toString();
  });
  const duplicate = urls.find(
    (url, index) => urls.indexOf(url) !== index,
  );
  if (duplicate) {
    throw new CliError(`Source URLs must be unique. Duplicate: ${duplicate}`, 2);
  }
  return urls;
}

export async function addUrlSources(
  account: Account,
  target: string,
  inputUrls: string[],
  headed: boolean,
  timeoutSeconds: number,
): Promise<AddedSourcesResult & { inputUrls: string[] }> {
  const urls = normalizeSourceUrls(inputUrls);
  const result = await addSourcesFromDialog(
    account,
    target,
    headed,
    timeoutSeconds,
    urls.length,
    `${urls.length} URL source(s)`,
    async (browser) => {
      await markAndClickSourceOption(browser, "websites");
      const inputMarked = await waitUntil(
        () => browser.eval<boolean>(markUrlsInputScript),
        Boolean,
        15_000,
        250,
      );
      if (!inputMarked) {
        throw new CliError(
          "Could not find the Gemini Notebook URL input. Retry with --headed to inspect the current interface.",
        );
      }
      await browser.fill(
        '[data-agent-browser-app-target="urls-input"]',
        urls.join("\n"),
      );
      const insertMarked = await waitUntil(
        () => browser.eval<boolean>(markSourceInsertButtonScript),
        Boolean,
        10_000,
        250,
      );
      if (!insertMarked) {
        throw new CliError(
          "Gemini Notebook did not enable the URL Insert action.",
        );
      }
      await browser.click(
        '[data-agent-browser-app-target="source-insert"]',
      );
    },
  );
  return { ...result, inputUrls: urls };
}

interface DrivePickerState {
  ready: boolean;
  searchValue: string;
  searching: boolean;
  optionCount: number;
  exactMatchCount: number;
}

async function waitForDrivePickerResults(
  browser: AgentBrowser,
  target: string,
): Promise<DrivePickerState> {
  await delay(1000);
  const targetIsUrl = /^https?:\/\//i.test(target);
  const deadline = Date.now() + 20_000;
  let latest: DrivePickerState = {
    ready: false,
    searchValue: "",
    searching: true,
    optionCount: 0,
    exactMatchCount: 0,
  };
  let signature = "";
  let stablePolls = 0;
  while (Date.now() < deadline) {
    latest = await browser.evalInFrame<DrivePickerState>(
      "docs.google.com/picker/",
      readDrivePickerStateScript(target),
    );
    if (latest.exactMatchCount === 1) {
      return latest;
    }
    if (
      targetIsUrl &&
      latest.ready &&
      latest.searchValue === target &&
      !latest.searching &&
      latest.optionCount === 1
    ) {
      return latest;
    }
    const nextSignature = JSON.stringify(latest);
    if (
      latest.ready &&
      latest.searchValue === target &&
      !latest.searching &&
      nextSignature === signature
    ) {
      stablePolls += 1;
      if (stablePolls >= 3) {
        return latest;
      }
    } else {
      stablePolls = 0;
    }
    signature = nextSignature;
    await delay(500);
  }
  throw new CliError(
    `Google Drive search did not settle for "${target}".`,
  );
}

export async function addDriveSource(
  account: Account,
  target: string,
  driveTarget: string,
  headed: boolean,
  timeoutSeconds: number,
): Promise<AddedSourcesResult & { driveTarget: string }> {
  const normalizedTarget = driveTarget.trim();
  if (!normalizedTarget) {
    throw new CliError(
      "notebook source add-drive requires a Drive item name or URL.",
      2,
    );
  }
  const result = await addSourcesFromDialog(
    account,
    target,
    headed,
    timeoutSeconds,
    1,
    `Drive item "${normalizedTarget}"`,
    async (browser) => {
      await markAndClickSourceOption(browser, "drive");
      let picker = await browser.evalInFrame<DrivePickerState>(
        "docs.google.com/picker/",
        readDrivePickerStateScript(normalizedTarget),
      );
      if (picker.exactMatchCount === 0) {
        const searchReady = await waitUntil(
          () =>
            browser.fillInFrame(
              "docs.google.com/picker/",
              'input[role="combobox"][aria-label*="Search in Drive" i], input[placeholder*="Search in Drive" i]',
              normalizedTarget,
              true,
            ),
          Boolean,
          20_000,
          500,
        );
        if (!searchReady) {
          throw new CliError(
            "Could not find the Google Drive picker search input. Retry with --headed to inspect the current interface.",
          );
        }
        picker = await waitForDrivePickerResults(
          browser,
          normalizedTarget,
        );
      }
      const targetIsUrl = /^https?:\/\//i.test(normalizedTarget);
      const matchCount = targetIsUrl
        ? picker.exactMatchCount || picker.optionCount
        : picker.exactMatchCount;
      if (matchCount === 0) {
        throw new CliError(
          `Could not find a Google Drive item matching "${normalizedTarget}".`,
        );
      }
      if (matchCount > 1) {
        throw new CliError(
          `Multiple Google Drive items match "${normalizedTarget}". Use the item's Drive URL to select it exactly.`,
        );
      }
      let selection = await browser.evalInFrame<{
        selectedCount: number;
        canInsert: boolean;
      }>(
        "docs.google.com/picker/",
        readDrivePickerSelectionScript,
      );
      if (selection.selectedCount !== 1 || !selection.canInsert) {
        const selected = await browser.evalInFrame<boolean>(
          "docs.google.com/picker/",
          selectDrivePickerItemScript(normalizedTarget),
        );
        if (!selected) {
          throw new CliError(
            `Could not select Google Drive item "${normalizedTarget}".`,
          );
        }
        selection = await waitUntil(
          () =>
            browser.evalInFrame<{
              selectedCount: number;
              canInsert: boolean;
            }>(
              "docs.google.com/picker/",
              readDrivePickerSelectionScript,
            ),
          (value) => value.selectedCount === 1 && value.canInsert,
          10_000,
          250,
        );
      }
      if (selection.selectedCount !== 1 || !selection.canInsert) {
        throw new CliError(
          `Google Drive did not finish selecting "${normalizedTarget}".`,
        );
      }
      const inserted = await browser.evalInFrame<boolean>(
        "docs.google.com/picker/",
        insertDrivePickerSelectionScript,
      );
      if (!inserted) {
        throw new CliError(
          `Google Drive did not enable Insert for "${normalizedTarget}".`,
        );
      }
    },
  );
  return { ...result, driveTarget: normalizedTarget };
}

export async function listSources(
  account: Account,
  target: string,
  headed: boolean,
): Promise<{
  notebookId: string;
  url: string;
  sources: SourceSummary[];
}> {
  const url = directNotebookUrl(target);
  const match = url?.match(NOTEBOOK_URL_PATTERN);
  if (!url || !match) {
    throw new CliError(`Invalid Gemini Notebook ID or URL: ${target}.`);
  }
  return runAuthenticated(account, async (browser) => {
    await browser.open(url, headed);
    assertAuthenticated(await browser.currentUrl());
    const state = await loadSources(browser);
    return {
      notebookId: match[1],
      url,
      sources: state.sources,
    };
  });
}

function sourceIndex(sourceId: string): number | undefined {
  const match = sourceId.match(/^source-([1-9]\d*)$/);
  if (!match) {
    return undefined;
  }
  return Number(match[1]) - 1;
}

export async function removeSources(
  account: Account,
  target: string,
  sourceIds: string[],
  headed: boolean,
): Promise<{
  notebookId: string;
  url: string;
  removed: SourceSummary[];
}> {
  const url = directNotebookUrl(target);
  const notebookMatch = url?.match(NOTEBOOK_URL_PATTERN);
  if (!url || !notebookMatch) {
    throw new CliError(`Invalid Gemini Notebook ID or URL: ${target}.`);
  }
  const requestedIds = Array.from(new Set(sourceIds));
  if (requestedIds.length === 0) {
    throw new CliError(
      "notebook source remove requires at least one source ID.",
      2,
    );
  }

  return runAuthenticated(account, async (browser) => {
    await browser.open(url, headed);
    assertAuthenticated(await browser.currentUrl());
    const initial = await loadSources(browser);
    const targets = requestedIds.map((id) => {
      const index = sourceIndex(id);
      const source = index === undefined ? undefined : initial.sources[index];
      if (index === undefined || !source) {
        throw new CliError(
          `Unknown source ID "${id}". Run notebook source list again and use an ID from the current output.`,
        );
      }
      if (!source.removable) {
        throw new CliError(
          `Source "${id}" cannot be removed while its current status is ${source.status}.`,
        );
      }
      return { index, source };
    });

    for (const targetSource of [...targets].sort(
      (left, right) => right.index - left.index,
    )) {
      const current = await loadSources(browser);
      const currentSource = current.sources[targetSource.index];
      if (!currentSource || currentSource.title !== targetSource.source.title) {
        throw new CliError(
          `Source order changed before removing "${targetSource.source.id}". Run notebook source list again.`,
        );
      }
      const menuMarked = await browser.eval<boolean>(
        markSourceMenuButtonScript(targetSource.index),
      );
      if (!menuMarked) {
        throw new CliError(
          `Could not open the menu for source "${targetSource.source.id}".`,
        );
      }
      await browser.click(
        '[data-agent-browser-app-target="source-menu"]',
      );
      const removeMarked = await waitUntil(
        () => browser.eval<boolean>(markRemoveSourceMenuItemScript),
        Boolean,
        10_000,
        250,
      );
      if (!removeMarked) {
        throw new CliError(
          `Could not find the remove action for source "${targetSource.source.id}".`,
        );
      }
      await browser.click(
        '[data-agent-browser-app-target="remove-source"]',
      );
      const confirmMarked = await waitUntil(
        () => browser.eval<boolean>(markConfirmSourceRemovalScript),
        Boolean,
        10_000,
        250,
      );
      if (!confirmMarked) {
        throw new CliError(
          `Gemini Notebook did not show a removal confirmation for source "${targetSource.source.id}".`,
        );
      }
      await browser.click(
        '[data-agent-browser-app-target="confirm-source-removal"]',
      );
      const remaining = await waitUntil<SourceListState>(
        () => browser.eval(readSourcesScript),
        (value) =>
          value.loaded &&
          value.sources.length === current.sources.length - 1,
        20_000,
        500,
      );
      if (
        !remaining.loaded ||
        remaining.sources.length !== current.sources.length - 1
      ) {
        throw new CliError(
          `Gemini Notebook did not remove source "${targetSource.source.id}".`,
        );
      }
    }

    return {
      notebookId: notebookMatch[1],
      url,
      removed: targets.map((targetSource) => targetSource.source),
    };
  });
}
