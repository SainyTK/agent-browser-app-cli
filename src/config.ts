import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { CliError } from "./errors.ts";
import { join } from "node:path";

export interface AppPaths {
  agentBrowserHome: string;
  root: string;
  accountsRoot: string;
  registryFile: string;
}

export function getAppPaths(
  environment: NodeJS.ProcessEnv = process.env,
  appId = "gnb",
): AppPaths {
  const agentBrowserHome =
    environment.AGENT_BROWSER_HOME?.trim() || join(homedir(), ".agent-browser");
  const root = join(agentBrowserHome, "apps", "agent-browser-app", appId);

  return {
    agentBrowserHome,
    root,
    accountsRoot: join(root, "accounts"),
    registryFile: join(root, "accounts.json"),
  };
}

export type AppId = "gnb" | "x" | "reddit";

export async function resolveAppHeaded(
  appId: AppId,
  flags: { headed: boolean; headless: boolean },
  environment: NodeJS.ProcessEnv = process.env,
): Promise<boolean> {
  if (flags.headed && flags.headless) {
    throw new CliError("Accepts only one of --headed or --headless.", 2);
  }
  if (flags.headed) return true;
  if (flags.headless) return false;

  const path = join(getAppPaths(environment, appId).root, "config.json");
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return appId === "reddit";
    }
    throw new CliError(`Could not read app config: ${path}`, 2);
  }
  let config: unknown;
  try {
    config = JSON.parse(text);
  } catch {
    throw new CliError(`Invalid JSON in app config: ${path}`, 2);
  }
  if (!config || typeof config !== "object" || Array.isArray(config)) {
    throw new CliError(`App config must be an object: ${path}`, 2);
  }
  const values = config as Record<string, unknown>;
  if (Object.keys(values).some((key) => key !== "headed")) {
    throw new CliError(`App config accepts only the headed setting: ${path}`, 2);
  }
  if (values.headed === undefined) return appId === "reddit";
  if (typeof values.headed !== "boolean") {
    throw new CliError(`App config headed must be a boolean: ${path}`, 2);
  }
  return values.headed;
}

export const NOTEBOOK_HOME_URL = "https://notebooklm.google.com/";
export const NOTEBOOK_URL_PATTERN =
  /^https:\/\/(?:notebooklm|notebook)\.google\.com\/notebook\/([a-zA-Z0-9_-]+)(?:[/?#].*)?$/;
