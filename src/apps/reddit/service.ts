import { access } from "node:fs/promises";
import { AgentBrowser } from "../../agent-browser.ts";
import { CliError } from "../../errors.ts";
import type { Account } from "../../registry.ts";
import {
  startSystemBrowser,
  waitForSystemBrowserLogin,
  type SystemBrowserApp,
} from "../system-browser.ts";
import {
  readAuthStateScript,
  readFeedScript,
  readProfileScript,
  scrollFeedScript,
} from "./browser-scripts.ts";

const REDDIT_HOME_URL = "https://www.reddit.com/";
const REDDIT_LOGIN_URL = "https://www.reddit.com/login/";
const REDDIT_HOSTS = new Set([
  "m.reddit.com",
  "new.reddit.com",
  "np.reddit.com",
  "old.reddit.com",
  "reddit.com",
  "www.reddit.com",
]);
const REDDIT_SYSTEM_BROWSER_APP: SystemBrowserApp = {
  name: "Reddit",
  loginUrl: REDDIT_LOGIN_URL,
  isAuthenticatedUrl: (url) =>
    REDDIT_HOSTS.has(url.hostname.toLowerCase()) &&
    !/^\/login(?:\/|$)/.test(url.pathname),
  authenticatedDestination: "an authenticated Reddit page",
};

const delay = (milliseconds: number) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

interface AuthState {
  authenticated: boolean;
  loginRequired: boolean;
  blocked: boolean;
  username: string | null;
  url: string;
}

export interface RedditPost {
  id: string;
  url: string;
  subreddit: string;
  author: {
    username: string;
  };
  title: string;
  text: string;
  createdAt: string | null;
  contentUrl: string | null;
  metrics: {
    score: number | null;
    comments: number | null;
  };
  nsfw: boolean;
  spoiler: boolean;
  promoted: boolean;
}

interface FeedState {
  loginRequired: boolean;
  blocked: boolean;
  ready: boolean;
  posts: RedditPost[];
}

export interface RedditProfile {
  id: string | null;
  username: string;
  name: string;
  bio: string | null;
  createdAt: string | null;
  karma: number | null;
  postKarma: number | null;
  commentKarma: number | null;
  followers: number | null;
  admin: boolean;
  moderator: boolean;
  url: string;
}

interface ProfileState {
  loginRequired: boolean;
  blocked: boolean;
  unavailableMessage: string | null;
  ready: boolean;
  profile: RedditProfile | null;
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
      ? ` --account u/${account.identity}`
      : "";
    throw new CliError(
      `Reddit account "${account.identity ? `u/${account.identity}` : account.id}" has no state.json. Run: agent-browser-app reddit auth login${identity}`,
    );
  }
}

async function runAuthenticated<T>(
  account: Account,
  operation: (browser: AgentBrowser) => Promise<T>,
): Promise<T> {
  await requireState(account);
  const browser = new AgentBrowser(account, "reddit");
  try {
    return await operation(browser);
  } finally {
    await browser.close();
  }
}

function expiredAuthenticationError(): CliError {
  return new CliError(
    "Reddit authentication has expired. Run: agent-browser-app reddit auth login",
  );
}

function blockedError(): CliError {
  return new CliError(
    "Reddit requested browser verification. Retry with --headed, or refresh authentication with: agent-browser-app reddit auth login --system-browser",
  );
}

export async function login(
  account: Account,
  timeoutSeconds: number,
  onWaiting: () => void,
): Promise<string> {
  const browser = new AgentBrowser(account, "reddit");
  try {
    await browser.open(REDDIT_LOGIN_URL, true);
    onWaiting();
    const state = await waitUntil(
      () => browser.eval<AuthState>(readAuthStateScript),
      (value) =>
        (value.authenticated && Boolean(value.username)) ||
        value.blocked,
      timeoutSeconds * 1000,
      250,
    );
    if (state.blocked) {
      throw new CliError(
        "Reddit blocked the automated login browser with a verification page. Retry the same command with --system-browser.",
      );
    }
    if (!state.authenticated) {
      throw new CliError(
        `Reddit authentication did not finish within ${timeoutSeconds} seconds.`,
      );
    }
    if (!state.username) {
      throw new CliError(
        `Reddit signed in, but the account username was not detected within ${timeoutSeconds} seconds. Keep the authenticated page open and retry.`,
      );
    }
    await delay(1000);
    await browser.saveState();
    return state.username;
  } finally {
    await browser.close();
  }
}

export async function loginWithSystemBrowser(
  account: Account,
  timeoutSeconds: number,
  onWaiting: () => void,
): Promise<string> {
  const deadline = Date.now() + timeoutSeconds * 1000;
  await new AgentBrowser(account, "reddit").close();
  const systemBrowser = await startSystemBrowser(
    account,
    REDDIT_SYSTEM_BROWSER_APP.loginUrl,
    process.env,
    onWaiting,
  );
  const browser = new AgentBrowser(account, "reddit");
  try {
    await waitForSystemBrowserLogin(
      systemBrowser,
      timeoutSeconds,
      REDDIT_SYSTEM_BROWSER_APP,
    );
    await browser.attach(systemBrowser.cdpPort);
    const redditTab = (await browser.listTabs()).find((tab) => {
      try {
        const url = new URL(tab.url);
        return tab.type === "page" &&
          REDDIT_SYSTEM_BROWSER_APP.isAuthenticatedUrl(url, tab.title);
      } catch {
        return false;
      }
    });
    if (!redditTab) {
      throw new CliError(
        "Reddit reached an authenticated page, but its browser tab could not be found.",
      );
    }
    await browser.switchTab(redditTab.tabId);
    const state = await waitUntil(
      () => browser.eval<AuthState>(readAuthStateScript),
      (value) =>
        (value.authenticated && Boolean(value.username)) ||
        value.blocked,
      Math.max(deadline - Date.now(), 1_000),
      200,
    );
    if (state.blocked) {
      throw blockedError();
    }
    if (!state.authenticated) {
      throw new CliError(
        `Reddit left the login page, but the authenticated profile was not detected within ${timeoutSeconds} seconds.`,
      );
    }
    if (!state.username) {
      throw new CliError(
        `Reddit signed in, but the account username was not detected within ${timeoutSeconds} seconds. Keep the authenticated page open and retry.`,
      );
    }
    await browser.saveState();
    return state.username;
  } finally {
    await browser.close();
    await systemBrowser.close();
  }
}

export async function readFeed(
  account: Account,
  limit: number,
  headed: boolean,
): Promise<RedditPost[]> {
  return runAuthenticated(account, async (browser) => {
    await browser.open(REDDIT_HOME_URL, headed);
    let state = await waitUntil(
      () => browser.eval<FeedState>(readFeedScript),
      (value) =>
        value.loginRequired ||
        value.blocked ||
        value.ready ||
        value.posts.length > 0,
      25_000,
    );
    if (state.blocked) {
      throw blockedError();
    }
    if (state.loginRequired) {
      throw expiredAuthenticationError();
    }
    if (!state.ready && state.posts.length === 0) {
      throw new CliError(
        "Reddit did not finish loading the home feed. Retry with --headed to inspect the current interface.",
      );
    }

    const posts = new Map<string, RedditPost>();
    let unchangedPolls = 0;
    const deadline = Date.now() + 120_000;
    while (
      posts.size < limit &&
      unchangedPolls < 6 &&
      Date.now() < deadline
    ) {
      const before = posts.size;
      for (const post of state.posts) {
        if (!posts.has(post.id)) {
          posts.set(post.id, post);
        }
      }
      if (posts.size >= limit) {
        break;
      }
      unchangedPolls = posts.size === before ? unchangedPolls + 1 : 0;
      await browser.eval(scrollFeedScript);
      await delay(900);
      state = await browser.eval<FeedState>(readFeedScript);
      if (state.blocked) {
        throw blockedError();
      }
      if (state.loginRequired) {
        throw expiredAuthenticationError();
      }
    }
    return Array.from(posts.values()).slice(0, limit);
  });
}

export function resolveProfileUrl(target: string): string {
  const value = target.trim();
  if (!value) {
    throw new CliError(
      "reddit profile requires a profile URL or username.",
      2,
    );
  }

  const username = value
    .replace(/^@/, "")
    .replace(/^\/?(?:u|user)\//i, "")
    .replace(/\/$/, "");
  if (/^[A-Za-z0-9_-]{3,20}$/.test(username)) {
    return `https://www.reddit.com/user/${username}/`;
  }

  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new CliError(
      `Invalid Reddit profile URL or username: ${target}.`,
      2,
    );
  }
  if (!REDDIT_HOSTS.has(parsed.hostname.toLowerCase())) {
    throw new CliError(
      `Invalid Reddit profile URL or username: ${target}.`,
      2,
    );
  }
  const match = parsed.pathname.match(
    /^\/(?:u|user)\/([A-Za-z0-9_-]{3,20})\/?$/,
  );
  if (!match) {
    throw new CliError(
      `Invalid Reddit profile URL or username: ${target}.`,
      2,
    );
  }
  return `https://www.reddit.com/user/${match[1]}/`;
}

export async function readProfile(
  account: Account,
  target: string,
  headed: boolean,
): Promise<RedditProfile> {
  const url = resolveProfileUrl(target);
  return runAuthenticated(account, async (browser) => {
    await browser.open(url, headed);
    const state = await waitUntil(
      () => browser.eval<ProfileState>(readProfileScript),
      (value) =>
        value.loginRequired ||
        value.blocked ||
        Boolean(value.unavailableMessage) ||
        value.ready,
      25_000,
    );
    if (state.blocked) {
      throw blockedError();
    }
    if (state.loginRequired) {
      throw expiredAuthenticationError();
    }
    if (state.unavailableMessage) {
      throw new CliError(
        `Reddit profile is unavailable: ${state.unavailableMessage}.`,
      );
    }
    if (!state.ready || !state.profile) {
      throw new CliError(
        `Reddit did not finish loading profile "${target}". Retry with --headed to inspect the current interface.`,
      );
    }
    return state.profile;
  });
}
