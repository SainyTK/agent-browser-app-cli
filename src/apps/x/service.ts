import { access } from "node:fs/promises";
import { createBrowser, type BrowserSession } from "../../browser/index.ts";
import { CliError } from "../../errors.ts";
import type { Account } from "../../registry.ts";
import {
  readAuthStateScript,
  readFeedScript,
  readProfileScript,
  scrollFeedScript,
} from "./browser-scripts.ts";
import { startSystemBrowser } from "../system-browser.ts";

const X_HOME_URL = "https://x.com/home";
const X_LOGIN_URL = "https://x.com/i/flow/login";
function isXPage(url: string): boolean {
  try {
    return ["x.com", "www.x.com"].includes(new URL(url).hostname);
  } catch {
    return false;
  }
}
const RESERVED_PROFILE_PATHS = new Set([
  "compose",
  "explore",
  "home",
  "i",
  "login",
  "messages",
  "notifications",
  "search",
  "settings",
]);

const delay = (milliseconds: number) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

interface AuthState {
  authenticated: boolean;
  loginRequired: boolean;
  googleRejected: boolean;
  username: string | null;
  url: string;
}

export interface Tweet {
  id: string;
  url: string;
  author: {
    id: string | null;
    name: string;
    username: string;
  };
  text: string;
  createdAt: string | null;
  metrics: {
    replies: number | null;
    reposts: number | null;
    quotes: number | null;
    likes: number | null;
    views: number | null;
  };
}

interface FeedState {
  loginRequired: boolean;
  ready: boolean;
  tweets: Tweet[];
}

export interface XProfile {
  id: string | null;
  username: string;
  name: string;
  bio: string | null;
  location: string | null;
  website: string | null;
  joinedAt: string | null;
  verified: boolean;
  protected: boolean;
  posts: number | null;
  following: number | null;
  followers: number | null;
  url: string;
}

interface ProfileState {
  loginRequired: boolean;
  unavailableMessage: string | null;
  ready: boolean;
  profile: XProfile | null;
}

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

async function requireState(account: Account): Promise<void> {
  try {
    await access(account.stateFile);
  } catch {
    const identity = account.identity
      ? ` --account @${account.identity}`
      : "";
    throw new CliError(
      `X account "${account.identity ? `@${account.identity}` : account.id}" has no state.json. Run: agent-browser-app x auth login${identity}`,
    );
  }
}

async function runAuthenticated<T>(
  account: Account,
  operation: (browser: BrowserSession) => Promise<T>,
): Promise<T> {
  await requireState(account);
  const browser = createBrowser(account, "x");
  try {
    return await operation(browser);
  } finally {
    await browser.close();
  }
}

function expiredAuthenticationError(): CliError {
  return new CliError(
    "X authentication has expired. Run: agent-browser-app x auth login",
  );
}

export async function login(
  account: Account,
  timeoutSeconds: number,
  onWaiting: () => void,
  options: {
    headed?: boolean;
    startUrl?: string;
  } = {},
): Promise<string | undefined> {
  const browser = createBrowser(account, "x");
  try {
    await browser.open(
      options.startUrl || X_LOGIN_URL,
      options.headed ?? true,
    );
    onWaiting();
    const state = await waitUntil(
      () => browser.eval<AuthState>(readAuthStateScript),
      (value) => value.authenticated || value.googleRejected,
      timeoutSeconds * 1000,
      1000,
    );
    if (state.googleRejected) {
      throw new CliError(
        "Google blocked sign-in from the automated browser. Retry the same command with --system-browser.",
      );
    }
    if (!state.authenticated) {
      throw new CliError(
        `X authentication did not finish within ${timeoutSeconds} seconds.`,
      );
    }
    await delay(1000);
    await browser.saveState();
    return state.username || undefined;
  } finally {
    await browser.close();
  }
}

export async function loginWithSystemBrowser(
  account: Account,
  timeoutSeconds: number,
  onWaiting: () => void,
): Promise<string | undefined> {
  const deadline = Date.now() + timeoutSeconds * 1000;
  const systemBrowser = await startSystemBrowser(
    account,
    X_LOGIN_URL,
    process.env,
    onWaiting,
  );
  const browser = createBrowser(account, "x");
  try {
    await browser.attach(systemBrowser.cdpPort);
    while (Date.now() < deadline) {
      try {
        const tabs = await browser.listTabs();
        for (const tab of tabs) {
          if (tab.type !== "page" || !isXPage(tab.url)) continue;
          await browser.switchTab(tab.tabId);
          const state = await browser.eval<AuthState>(readAuthStateScript);
          // A logged-in page can retain a sign-in dialog or remain on a profile route.
          // Check the app's authenticated UI instead of waiting for an exact URL.
          if (!isXPage(state.url) || !state.authenticated) continue;
          await browser.saveState();
          return state.username || undefined;
        }
      } catch (error) {
        // Redirects and closing sign-in popups can invalidate a tab during inspection.
        const transient = error instanceof CliError && [
          "The selected browser tab is not open.",
          "The requested browser tab no longer exists.",
          "Playwright failed while evaluating application state.",
          "Playwright failed while listing browser tabs.",
        ].includes(error.message);
        if (!transient) throw error;
      }
      await delay(500);
    }
    throw new CliError(
      `X authentication did not finish within ${timeoutSeconds} seconds.`,
    );
  } finally {
    await browser.close();
    await systemBrowser.close();
  }
}

export async function readFeed(
  account: Account,
  limit: number,
  headed: boolean,
): Promise<Tweet[]> {
  return runAuthenticated(account, async (browser) => {
    await browser.open(X_HOME_URL, headed);
    let state = await waitUntil(
      () => browser.eval<FeedState>(readFeedScript),
      (value) =>
        value.loginRequired || value.ready || value.tweets.length > 0,
      25_000,
    );
    if (state.loginRequired) {
      throw expiredAuthenticationError();
    }
    if (!state.ready && state.tweets.length === 0) {
      throw new CliError(
        "X did not finish loading the home feed. Retry with --headed to inspect the current interface.",
      );
    }

    const tweets = new Map<string, Tweet>();
    let unchangedPolls = 0;
    const deadline = Date.now() + 120_000;
    while (
      tweets.size < limit &&
      unchangedPolls < 6 &&
      Date.now() < deadline
    ) {
      const before = tweets.size;
      for (const tweet of state.tweets) {
        if (!tweets.has(tweet.id)) {
          tweets.set(tweet.id, tweet);
        }
      }
      if (tweets.size >= limit) {
        break;
      }
      unchangedPolls = tweets.size === before ? unchangedPolls + 1 : 0;
      await browser.eval(scrollFeedScript);
      await delay(900);
      state = await browser.eval<FeedState>(readFeedScript);
      if (state.loginRequired) {
        throw expiredAuthenticationError();
      }
    }
    return Array.from(tweets.values()).slice(0, limit);
  });
}

export function resolveProfileUrl(target: string): string {
  const value = target.trim();
  if (!value) {
    throw new CliError(
      "x profile requires a profile URL, username, or numeric user ID.",
      2,
    );
  }

  const username = value.replace(/^@/, "");
  if (/^\d+$/.test(username)) {
    return `https://x.com/i/user/${username}`;
  }
  if (
    /^[A-Za-z0-9_]{1,15}$/.test(username) &&
    !RESERVED_PROFILE_PATHS.has(username.toLowerCase())
  ) {
    return `https://x.com/${username}`;
  }

  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new CliError(`Invalid X profile URL or username: ${target}.`, 2);
  }
  const allowedHosts = new Set([
    "mobile.twitter.com",
    "twitter.com",
    "www.twitter.com",
    "www.x.com",
    "x.com",
  ]);
  if (!allowedHosts.has(parsed.hostname.toLowerCase())) {
    throw new CliError(`Invalid X profile URL or username: ${target}.`, 2);
  }
  const numericIdMatch = parsed.pathname.match(/^\/i\/user\/(\d+)\/?$/);
  if (numericIdMatch) {
    return `https://x.com/i/user/${numericIdMatch[1]}`;
  }
  const match = parsed.pathname.match(/^\/([A-Za-z0-9_]{1,15})\/?$/);
  if (
    !match ||
    RESERVED_PROFILE_PATHS.has(match[1].toLowerCase())
  ) {
    throw new CliError(`Invalid X profile URL or username: ${target}.`, 2);
  }
  return `https://x.com/${match[1]}`;
}

export async function readProfile(
  account: Account,
  target: string,
  headed: boolean,
): Promise<XProfile> {
  const url = resolveProfileUrl(target);
  return runAuthenticated(account, async (browser) => {
    await browser.open(url, headed);
    const state = await waitUntil(
      () => browser.eval<ProfileState>(readProfileScript),
      (value) =>
        value.loginRequired ||
        Boolean(value.unavailableMessage) ||
        value.ready,
      25_000,
    );
    if (state.loginRequired) {
      throw expiredAuthenticationError();
    }
    if (state.unavailableMessage) {
      throw new CliError(`X profile is unavailable: ${state.unavailableMessage}.`);
    }
    if (!state.ready || !state.profile) {
      throw new CliError(
        `X did not finish loading profile "${target}". Retry with --headed to inspect the current interface.`,
      );
    }
    return state.profile;
  });
}
