import type { Account } from "../registry.ts";
import { PlaywrightBrowser } from "./playwright.ts";
import type { BrowserSession } from "./types.ts";

export type { BrowserSession, BrowserTab } from "./types.ts";

export function createBrowser(
  account: Account,
  appId = "gnb",
  environment: NodeJS.ProcessEnv = process.env,
): BrowserSession {
  return new PlaywrightBrowser(account, appId, environment);
}
