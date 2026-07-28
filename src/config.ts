import { homedir } from "node:os";
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

export const NOTEBOOK_HOME_URL = "https://notebooklm.google.com/";
export const NOTEBOOK_URL_PATTERN =
  /^https:\/\/(?:notebooklm|notebook)\.google\.com\/notebook\/([a-zA-Z0-9_-]+)(?:[/?#].*)?$/;
