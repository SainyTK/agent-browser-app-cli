import { access, appendFile, chmod, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { CliError } from "../../src/errors.ts";
import type { Account } from "../../src/registry.ts";
import type { BrowserSession, BrowserTab } from "../../src/browser/types.ts";

// Test-only adapter for the legacy fake-agent-browser script.
// Its logged arguments describe this adapter, not the Playwright engine.
export class LegacyTestBrowser implements BrowserSession {
  readonly sessionName: string;
  private cdpPort?: number;
  private headed = false;

  constructor(
    private readonly account: Account,
    appId = "gnb",
    private readonly environment: NodeJS.ProcessEnv = process.env,
  ) {
    this.sessionName = `agent-browser-app-${appId}-${account.id}`;
  }

  async open(url: string, headed = false): Promise<void> {
    this.headed = headed;
    if (this.cdpPort === undefined) {
      await mkdir(this.account.profileDir, { recursive: true, mode: 0o700 });
      const hasState = await access(this.account.stateFile).then(
        () => true,
        () => false,
      );
      if (hasState) {
        await this.run(["open"]);
        await this.run(["state", "load", this.account.stateFile]);
      }
    }
    await this.run(["open", url]);
  }

  async currentUrl(): Promise<string> {
    return (await this.run<{ url: string }>(["get", "url"])).url;
  }

  async attach(cdpPort: number): Promise<void> {
    this.cdpPort = cdpPort;
    await this.currentUrl();
  }

  async listTabs(): Promise<BrowserTab[]> {
    return (await this.run<{ tabs: BrowserTab[] }>(["tab", "list"])).tabs;
  }

  async switchTab(tabId: string): Promise<void> {
    await this.run(["tab", tabId]);
  }

  async eval<T>(script: string): Promise<T> {
    const encoded = Buffer.from(script).toString("base64");
    return (await this.run<{ result: T }>(["eval", "-b", encoded])).result;
  }

  async evalInFrame<T>(frameUrlIncludes: string, script: string): Promise<T> {
    if (!frameUrlIncludes.includes("docs.google.com/picker")) {
      throw new Error(`Unsupported legacy fixture frame: ${frameUrlIncludes}`);
    }
    const log = this.environment.FAKE_AGENT_BROWSER_LOG;
    if (log) await appendFile(log, `${JSON.stringify(["frame-eval", frameUrlIncludes, Buffer.from(script).toString("base64")])}\n`);
    const url = this.environment.FAKE_CDP_URL;
    if (!url) throw new Error("FAKE_CDP_URL is required by the legacy frame fixture.");
    // The local test server returns scripted values, not browser evaluations.
    const socket = new WebSocket(url);
    try {
      return await new Promise<T>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error("Legacy frame fixture timed out.")), 2_000);
        socket.addEventListener("open", () => {
          socket.send(JSON.stringify({
            id: 1,
            method: "Runtime.evaluate",
            params: { expression: script },
          }));
        });
        socket.addEventListener("error", () => {
          clearTimeout(timeout);
          reject(new Error("Legacy frame fixture connection failed."));
        });
        socket.addEventListener("message", (event) => {
          clearTimeout(timeout);
          const response = JSON.parse(String(event.data)) as { result: { result: { value: T } } };
          resolve(response.result.result.value);
        }, { once: true });
      });
    } finally {
      socket.close();
    }
  }

  async fillInFrame(
    frameUrlIncludes: string,
    selector: string,
    value: string,
    pressEnter = false,
  ): Promise<boolean> {
    await this.run(["frame", frameUrlIncludes]);
    await this.fill(selector, value);
    if (pressEnter) await this.press("Enter");
    return true;
  }

  async click(selector: string): Promise<void> {
    await this.run(["click", selector]);
  }

  async fill(selector: string, value: string): Promise<void> {
    await this.run(["fill", selector, value]);
  }

  async press(key: string): Promise<void> {
    await this.run(["press", key]);
  }

  async uploadFilesThroughFileChooser(): Promise<void> {
    throw new Error("File chooser uploads require the real browser tests.");
  }

  async saveState(): Promise<void> {
    await mkdir(dirname(this.account.stateFile), { recursive: true, mode: 0o700 });
    await this.run(["state", "save", this.account.stateFile]);
    await chmod(this.account.stateFile, 0o600);
  }

  async close(): Promise<void> {
    await this.run(["close"], false).catch(() => undefined);
  }

  private async run<T = unknown>(args: string[], json = true): Promise<T> {
    const globalArgs = ["--session", this.sessionName];
    if (this.cdpPort !== undefined) {
      globalArgs.push("--cdp", String(this.cdpPort));
    } else {
      globalArgs.push("--profile", this.account.profileDir, "--headed", String(this.headed));
    }
    const child = Bun.spawn([
      process.execPath,
      `${import.meta.dir}/fake-agent-browser.ts`,
      ...globalArgs,
      ...(json ? ["--json"] : []),
      ...args,
    ], { stdout: "pipe", stderr: "pipe", env: this.environment });
    const [exitCode, stdout, stderr] = await Promise.all([
      child.exited,
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ]);
    if (exitCode !== 0) throw new CliError(stderr.trim() || stdout.trim());
    if (!json) return undefined as T;
    const envelope = JSON.parse(stdout) as { success: boolean; data: T; error: string | null };
    if (!envelope.success) throw new CliError(envelope.error || "Legacy test adapter failed.");
    return envelope.data;
  }
}
