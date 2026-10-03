import { Console } from "node:console";
import { createBrowser } from "./browser/index.ts";
import type { PlaywrightOperation } from "./browser/types.ts";
import type { AppId } from "./config.ts";
import { CliError } from "./errors.ts";
import type { Account } from "./registry.ts";

const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;

export function compileRaw(source: string): PlaywrightOperation {
  if (!source.trim()) throw new CliError("raw requires non-empty JavaScript code.", 2);
  try {
    const script = new AsyncFunction("page", "context", "console", `"use strict";\n${source}`);
    const stderrConsole = new Console({ stdout: process.stderr, stderr: process.stderr });
    return (page, context) => script(page, context, stderrConsole);
  } catch {
    throw new CliError("Invalid raw JavaScript. Supply an async function body, not a module or TypeScript.", 2);
  }
}

export async function runRaw(
  account: Account,
  appId: AppId,
  startUrl: string,
  operation: PlaywrightOperation,
  headed: boolean,
  timeoutMs: number,
): Promise<unknown> {
  const browser = createBrowser(account, appId);
  try {
    await browser.open(startUrl, headed);
    const result = await browser.runPlaywright(operation, timeoutMs);
    await browser.saveState();
    return result;
  } finally {
    await browser.close();
  }
}
