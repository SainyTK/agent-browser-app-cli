import { existsSync } from "node:fs";
import { lstat } from "node:fs/promises";
import { createServer } from "node:net";
import { homedir } from "node:os";
import { join } from "node:path";
import { CliError } from "../errors.ts";
import type { Account } from "../registry.ts";

export interface SystemBrowserApp {
  name: string;
  loginUrl: string;
  isAuthenticatedUrl: (url: URL, title?: string) => boolean;
  authenticatedDestination: string;
}

interface BrowserTarget {
  title?: string;
  type: string;
  url: string;
}

export interface SystemBrowserSession {
  cdpPort: number;
  close: () => Promise<void>;
}

async function reserveTcpPort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const address = server.address();
  const port =
    typeof address === "object" && address ? address.port : undefined;
  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
      } else {
        resolve();
      }
    });
  });
  if (!port) {
    throw new CliError(
      "Could not reserve a local debugging port for system Google Chrome.",
    );
  }
  return port;
}

function browserCommand(
  account: Account,
  cdpPort: number,
  loginUrl: string,
  environment: NodeJS.ProcessEnv,
): string[] {
  const sharedArguments = [
    "--new-window",
    `--remote-debugging-port=${cdpPort}`,
    "--remote-debugging-address=127.0.0.1",
    `--user-data-dir=${account.profileDir}`,
    "--no-first-run",
    "--no-default-browser-check",
    loginUrl,
  ];
  const override = environment.AGENT_BROWSER_APP_SYSTEM_BROWSER_BIN?.trim();
  if (override) {
    return [override, ...sharedArguments];
  }
  if (process.platform === "darwin") {
    const candidates = [
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
      join(
        homedir(),
        "Applications",
        "Google Chrome.app",
        "Contents",
        "MacOS",
        "Google Chrome",
      ),
    ];
    const binary = candidates.find(existsSync);
    if (binary) {
      return [binary, ...sharedArguments];
    }
  }
  if (process.platform === "linux") {
    const binary =
      Bun.which("google-chrome") ||
      Bun.which("google-chrome-stable") ||
      Bun.which("chromium") ||
      Bun.which("chromium-browser");
    if (binary) {
      return [binary, ...sharedArguments];
    }
  }
  throw new CliError(
    "Could not find system Google Chrome. Set AGENT_BROWSER_APP_SYSTEM_BROWSER_BIN to its executable path.",
  );
}

async function profileIsLocked(account: Account): Promise<boolean> {
  try {
    await lstat(join(account.profileDir, "SingletonLock"));
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return false;
    }
    throw new CliError(
      `Could not inspect the isolated Chrome profile lock. ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}

async function waitForProfileRelease(
  account: Account,
  timeoutMs = 10_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (await profileIsLocked(account)) {
    if (Date.now() >= deadline) {
      throw new CliError(
        "System Google Chrome is still using the isolated profile. Quit that isolated Chrome instance with Command-Q, then rerun the command.",
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
}

async function readBrowserTargets(cdpPort: number): Promise<BrowserTarget[]> {
  try {
    const response = await fetch(`http://127.0.0.1:${cdpPort}/json/list`);
    if (!response.ok) {
      return [];
    }
    const value = await response.json();
    return Array.isArray(value) ? (value as BrowserTarget[]) : [];
  } catch {
    return [];
  }
}

async function waitForDebuggingPort(
  cdpPort: number,
  exited: Promise<number>,
  timeoutMs = 15_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let exitCode: number | undefined;
  void exited.then((value) => {
    exitCode = value;
  });
  while (Date.now() < deadline) {
    if (exitCode !== undefined) {
      throw new CliError(
        `System Google Chrome exited before its debugging port was ready with code ${exitCode}.`,
      );
    }
    if ((await readBrowserTargets(cdpPort)).length > 0) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new CliError(
    "System Google Chrome did not expose its local debugging port.",
  );
}

export async function startSystemBrowser(
  account: Account,
  loginUrl: string,
  environment: NodeJS.ProcessEnv = process.env,
  onStarted: () => void = () => undefined,
): Promise<SystemBrowserSession> {
  if (await profileIsLocked(account)) {
    throw new CliError(
      "The isolated Chrome profile is already open. Quit that isolated Chrome instance with Command-Q, then rerun the command.",
    );
  }
  const cdpPort = await reserveTcpPort();
  const command = browserCommand(account, cdpPort, loginUrl, environment);
  let processHandle: ReturnType<typeof Bun.spawn>;
  try {
    processHandle = Bun.spawn(command, {
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
      env: environment,
    });
  } catch (error) {
    throw new CliError(
      `Could not start system Google Chrome. ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
  const stdoutPromise = new Response(
    processHandle.stdout as ReadableStream<Uint8Array>,
  ).text();
  const stderrPromise = new Response(
    processHandle.stderr as ReadableStream<Uint8Array>,
  ).text();
  onStarted();
  try {
    await waitForDebuggingPort(cdpPort, processHandle.exited);
  } catch (error) {
    processHandle.kill();
    const [stdout, stderr] = await Promise.all([
      stdoutPromise,
      stderrPromise,
    ]);
    if (error instanceof CliError && !stdout.trim() && !stderr.trim()) {
      throw error;
    }
    throw new CliError(
      stderr.trim() ||
        stdout.trim() ||
        (error instanceof Error ? error.message : String(error)),
    );
  }

  return {
    cdpPort,
    close: async () => {
      if (processHandle.exitCode === null) {
        processHandle.kill();
      }
      await processHandle.exited;
      await Promise.all([stdoutPromise, stderrPromise]);
      await waitForProfileRelease(account);
    },
  };
}

export async function waitForSystemBrowserLogin(
  session: SystemBrowserSession,
  timeoutSeconds: number,
  app: SystemBrowserApp,
): Promise<void> {
  const deadline = Date.now() + timeoutSeconds * 1000;
  while (Date.now() < deadline) {
    const targets = await readBrowserTargets(session.cdpPort);
    const authenticated = targets.some((target) => {
      if (target.type !== "page") {
        return false;
      }
      try {
        const url = new URL(target.url);
        return app.isAuthenticatedUrl(url, target.title);
      } catch {
        return false;
      }
    });
    if (authenticated) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new CliError(
    `${app.name} authentication did not reach ${app.authenticatedDestination} within ${timeoutSeconds} seconds.`,
  );
}
