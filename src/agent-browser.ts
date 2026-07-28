import { access, chmod, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { CliError } from "./errors.ts";
import { uploadThroughFileChooser } from "./cdp.ts";
import type { Account } from "./registry.ts";

interface AgentBrowserEnvelope<T> {
  success: boolean;
  data: T;
  error: string | null;
}

interface RunOptions {
  headed?: boolean;
  stdin?: string;
  timeoutMs?: number;
}

interface BrowserTab {
  active: boolean;
  label: string | null;
  tabId: string;
  title: string;
  type: string;
  url: string;
}

function processErrorMessage(
  stdout: string,
  stderr: string,
): string | undefined {
  for (const output of [stderr, stdout]) {
    const trimmed = output.trim();
    if (!trimmed) {
      continue;
    }
    try {
      const parsed = JSON.parse(trimmed) as {
        error?: unknown;
      };
      if (typeof parsed.error === "string" && parsed.error.trim()) {
        return parsed.error.trim();
      }
    } catch {
      // Use the original process output when it is not JSON.
    }
    return trimmed;
  }
  return undefined;
}

export class AgentBrowser {
  readonly sessionName: string;
  private readonly binary: string;
  private cdpPort: number | undefined;
  private headed = false;

  constructor(
    private readonly account: Account,
    appId = "gnb",
    environment: NodeJS.ProcessEnv = process.env,
  ) {
    this.binary = environment.AGENT_BROWSER_BIN?.trim() || "agent-browser";
    this.sessionName = `agent-browser-app-${appId}-${account.id}`;
  }

  async open(url: string, headed = false): Promise<void> {
    this.headed = headed;
    await mkdir(this.account.profileDir, { recursive: true, mode: 0o700 });
    if (await this.stateExists()) {
      await this.runJson(["open"], { headed, timeoutMs: 60_000 });
      await this.runJson(["state", "load", this.account.stateFile]);
      await this.runJson(["open", url], { timeoutMs: 60_000 });
      return;
    }
    await this.runJson(["open", url], { headed, timeoutMs: 60_000 });
  }

  async currentUrl(): Promise<string> {
    const data = await this.runJson<{ url: string }>(["get", "url"]);
    return data.url;
  }

  async attach(cdpPort: number): Promise<void> {
    this.cdpPort = cdpPort;
    await this.currentUrl();
  }

  async listTabs(): Promise<BrowserTab[]> {
    const data = await this.runJson<{ tabs: BrowserTab[] }>([
      "tab",
      "list",
    ]);
    return data.tabs;
  }

  async switchTab(tabId: string): Promise<void> {
    await this.runJson(["tab", tabId]);
  }

  async eval<T>(script: string): Promise<T> {
    const encoded = Buffer.from(script, "utf8").toString("base64");
    const data = await this.runJson<{ result: T }>(["eval", "-b", encoded]);
    return data.result;
  }

  async click(selector: string): Promise<void> {
    await this.runJson(["click", selector]);
  }

  async fill(selector: string, value: string): Promise<void> {
    await this.runJson(["fill", selector, value]);
  }

  async press(key: string): Promise<void> {
    await this.runJson(["press", key]);
  }

  async uploadFilesThroughFileChooser(
    triggerSelector: string,
    filePaths: string[],
  ): Promise<void> {
    const cdp = await this.runJson<{ cdpUrl: string }>(["get", "cdp-url"]);
    const pageUrl = await this.currentUrl();
    await uploadThroughFileChooser(cdp.cdpUrl, pageUrl, filePaths, () =>
      this.click(triggerSelector),
    );
  }

  async saveState(): Promise<void> {
    await mkdir(dirname(this.account.stateFile), { recursive: true, mode: 0o700 });
    await this.runJson(["state", "save", this.account.stateFile]);
    await chmod(this.account.stateFile, 0o600).catch(() => undefined);
  }

  async close(): Promise<void> {
    await this.run(["close"], { timeoutMs: 30_000 }).catch(() => undefined);
  }

  private async stateExists(): Promise<boolean> {
    try {
      await access(this.account.stateFile);
      return true;
    } catch {
      return false;
    }
  }

  private async globalArgs(headed?: boolean): Promise<string[]> {
    if (this.cdpPort !== undefined) {
      return [
        "--session",
        this.sessionName,
        "--cdp",
        String(this.cdpPort),
      ];
    }
    const effectiveHeaded = headed ?? this.headed;
    const args = [
      "--session",
      this.sessionName,
      "--profile",
      this.account.profileDir,
    ];
    args.push("--headed", effectiveHeaded ? "true" : "false");
    return args;
  }

  private async runJson<T>(
    args: string[],
    options: RunOptions = {},
  ): Promise<T> {
    const result = await this.run(["--json", ...args], options);
    let envelope: AgentBrowserEnvelope<T>;
    try {
      envelope = JSON.parse(result.stdout) as AgentBrowserEnvelope<T>;
    } catch {
      throw new CliError(
        `agent-browser returned invalid JSON for "${args.join(" ")}": ${result.stdout.trim() || result.stderr.trim()}`,
      );
    }
    if (!envelope.success) {
      throw new CliError(
        envelope.error || `agent-browser failed: ${args.join(" ")}`,
      );
    }
    return envelope.data;
  }

  private async run(
    args: string[],
    options: RunOptions = {},
  ): Promise<{ stdout: string; stderr: string }> {
    const globalArgs = await this.globalArgs(options.headed);
    let processHandle: ReturnType<typeof Bun.spawn>;
    try {
      processHandle = Bun.spawn([this.binary, ...globalArgs, ...args], {
        stdin: options.stdin ? new Blob([options.stdin]) : "ignore",
        stdout: "pipe",
        stderr: "pipe",
        env: process.env,
      });
    } catch (error) {
      throw new CliError(
        `Could not start agent-browser. Install it and confirm it is on PATH. ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }

    const timeoutMs = options.timeoutMs ?? 30_000;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const completed = processHandle.exited;
    const timed = new Promise<never>((_, reject) => {
      timeout = setTimeout(() => {
        processHandle.kill();
        reject(
          new CliError(
            `agent-browser timed out after ${Math.ceil(timeoutMs / 1000)} seconds: ${args.join(" ")}`,
          ),
        );
      }, timeoutMs);
    });

    try {
      const exitCode = await Promise.race([completed, timed]);
      const stdout = await new Response(
        processHandle.stdout as ReadableStream<Uint8Array>,
      ).text();
      const stderr = await new Response(
        processHandle.stderr as ReadableStream<Uint8Array>,
      ).text();
      if (exitCode !== 0) {
        throw new CliError(
          processErrorMessage(stdout, stderr) ||
            `agent-browser exited with code ${exitCode}`,
        );
      }
      return { stdout, stderr };
    } finally {
      if (timeout) {
        clearTimeout(timeout);
      }
    }
  }
}
