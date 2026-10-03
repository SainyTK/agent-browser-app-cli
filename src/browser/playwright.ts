import { access, chmod, lstat, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { dirname, join } from "node:path";
import { chromium, type Browser, type BrowserContext, type Frame, type Page } from "playwright";
import { CliError } from "../errors.ts";
import { getProfileCredentialStore, type Account } from "../registry.ts";
import type { BrowserSession, BrowserTab } from "./types.ts";
import { connectLocalChromeTransport } from "./transport.ts";

const ACTION_TIMEOUT = 30_000;
const NAVIGATION_TIMEOUT = 60_000;

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw new CliError("Could not inspect the isolated browser profile or storage state.");
  }
}

export class PlaywrightBrowser implements BrowserSession {
  readonly sessionName: string;
  private context?: BrowserContext;
  private browser?: Browser;
  private page?: Page;
  private readonly tabs = new Map<string, Page>();
  private nextTab = 1;

  constructor(
    private readonly account: Account,
    appId = "gnb",
    private readonly environment: NodeJS.ProcessEnv = process.env,
  ) {
    this.sessionName = `agent-browser-app-${appId}-${account.id}`;
  }

  private async perform<T>(operation: string, action: () => Promise<T>, timeoutMs = ACTION_TIMEOUT): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        action(),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new CliError(`Playwright timed out while ${operation}.`)), timeoutMs);
        }),
      ]);
    } catch (error) {
      if (error instanceof CliError) throw error;
      // Browser errors can contain evaluated source, form values, and private URLs.
      throw new CliError(`Playwright failed while ${operation}.`);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  private requireContext(): BrowserContext {
    if (!this.context) throw new CliError("The browser session is not open.");
    return this.context;
  }

  private requirePage(): Page {
    if (!this.page || this.page.isClosed()) throw new CliError("The selected browser tab is not open.");
    return this.page;
  }

  private configure(context: BrowserContext): void {
    context.setDefaultTimeout(ACTION_TIMEOUT);
    context.setDefaultNavigationTimeout(NAVIGATION_TIMEOUT);
    this.context = context;
  }

  private async launch(headed: boolean): Promise<void> {
    const credentialStore = getProfileCredentialStore(this.account);
    const channel = this.environment.AGENT_BROWSER_APP_BROWSER_CHANNEL?.trim() || "chrome";
    if (channel !== "chrome" && channel !== "chromium") {
      throw new CliError("AGENT_BROWSER_APP_BROWSER_CHANNEL must be chrome or chromium.", 2);
    }
    try {
      await lstat(join(this.account.profileDir, "SingletonLock"));
      throw new CliError("The isolated browser profile is already open. Close that browser and retry.");
    } catch (error) {
      if (error instanceof CliError) throw error;
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        throw new CliError("Could not inspect the isolated browser profile lock.");
      }
    }
    // A real Chrome profile is authoritative. Import legacy storage only into a fresh profile.
    const hasProfile = await exists(join(this.account.profileDir, "Default", "Preferences"));
    let storageState: Parameters<BrowserContext["setStorageState"]>[0] | undefined;
    if (!hasProfile && await exists(this.account.stateFile)) {
      try {
        storageState = JSON.parse(await readFile(this.account.stateFile, "utf8"));
        if (!storageState || typeof storageState !== "object" || !Array.isArray(storageState.cookies) || !Array.isArray(storageState.origins)) {
          throw new Error("invalid state");
        }
      } catch {
        throw new CliError("Could not read authentication storage state. Refresh authentication with auth login.");
      }
    }
    await mkdir(this.account.profileDir, { recursive: true, mode: 0o700 });
    await chmod(this.account.profileDir, 0o700);
    const executablePath = this.environment.AGENT_BROWSER_APP_BROWSER_BIN?.trim();
    try {
      const context = await chromium.launchPersistentContext(this.account.profileDir, {
        channel: executablePath ? undefined : channel,
        executablePath,
        headless: !headed,
        // Native Chrome login cookies use its OS credential store.
        // Keep legacy Playwright profiles on their existing mock/basic store.
        ignoreDefaultArgs: credentialStore === "native"
          ? ["--use-mock-keychain", "--password-store=basic"]
          : undefined,
        timeout: NAVIGATION_TIMEOUT,
        viewport: null,
      });
      this.configure(context);
      this.page = context.pages()[0] || await context.newPage();
      if (storageState) await context.setStorageState(storageState);
    } catch {
      await this.close();
      throw new CliError("Could not start Playwright's isolated browser or restore authentication. Check Chrome installation, profile locks, and storage state. For bundled Chromium, run bunx playwright install chromium and set AGENT_BROWSER_APP_BROWSER_CHANNEL=chromium.");
    }
  }

  async open(url: string, headed = false): Promise<void> {
    if (!this.context) await this.launch(headed);
    await this.perform("opening the application", async () => {
      await this.requirePage().goto(url, { waitUntil: "domcontentloaded" });
    }, NAVIGATION_TIMEOUT);
  }

  async currentUrl(): Promise<string> {
    return this.requirePage().url();
  }

  async attach(cdpPort: number): Promise<void> {
    if (this.context) throw new CliError("The browser session is already open.");
    if (!Number.isSafeInteger(cdpPort) || cdpPort <= 0 || cdpPort > 65535) {
      throw new CliError("A valid local Chrome debugging port is required.");
    }
    await this.perform("connecting to system Chrome", async () => {
      const transport = await connectLocalChromeTransport(cdpPort);
      try {
        this.browser = await chromium.connectOverCDP(transport, { timeout: 20_000 });
        const context = this.browser.contexts()[0];
        if (!context) throw new CliError("System Chrome has no browser context.");
        this.configure(context);
        this.page = context.pages()[0] || await context.newPage();
      } catch (error) {
        transport.close();
        await this.close();
        throw error;
      }
    });
  }

  async listTabs(): Promise<BrowserTab[]> {
    return this.perform("listing browser tabs", async () => {
      const pages = this.requireContext().pages();
      for (const [id, page] of this.tabs) {
        if (page.isClosed()) this.tabs.delete(id);
      }
      return Promise.all(pages.map(async (page) => {
        let id = [...this.tabs].find(([, candidate]) => candidate === page)?.[0];
        if (!id) {
          id = `t${this.nextTab++}`;
          this.tabs.set(id, page);
        }
        return { active: page === this.page, label: null, tabId: id, title: await page.title(), type: "page", url: page.url() };
      }));
    });
  }

  async switchTab(tabId: string): Promise<void> {
    const page = this.tabs.get(tabId);
    if (!page || page.isClosed()) throw new CliError("The requested browser tab no longer exists.");
    this.page = page;
  }

  async eval<T>(script: string): Promise<T> {
    return this.perform("evaluating application state", () => this.requirePage().evaluate<T>(script));
  }

  private async findFrame(frameUrlIncludes: string): Promise<Frame> {
    const deadline = Date.now() + 20_000;
    while (Date.now() < deadline) {
      const frame = this.requirePage().frames().find((candidate) => candidate !== this.requirePage().mainFrame() && candidate.url().includes(frameUrlIncludes));
      if (frame) return frame;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new CliError("Could not find the requested application frame.");
  }

  async evalInFrame<T>(frameUrlIncludes: string, script: string): Promise<T> {
    return this.perform("evaluating application frame state", async () => (await this.findFrame(frameUrlIncludes)).evaluate<T>(script));
  }

  async fillInFrame(frameUrlIncludes: string, selector: string, value: string, pressEnter = false): Promise<boolean> {
    return this.perform("filling an application frame", async () => {
      const locator = (await this.findFrame(frameUrlIncludes)).locator(selector);
      if (await locator.count() === 0) return false;
      await locator.fill(value);
      if (pressEnter) await locator.press("Enter");
      return true;
    });
  }

  async click(selector: string): Promise<void> {
    await this.perform("clicking an application control", () => this.requirePage().locator(selector).click());
  }

  async fill(selector: string, value: string): Promise<void> {
    await this.perform("filling an application control", () => this.requirePage().locator(selector).fill(value));
  }

  async press(key: string): Promise<void> {
    await this.perform("pressing a browser key", () => this.requirePage().keyboard.press(key));
  }

  async uploadFilesThroughFileChooser(triggerSelector: string, filePaths: string[]): Promise<void> {
    if (filePaths.length === 0) throw new CliError("At least one file is required for upload.");
    await this.perform("uploading files", async () => {
      const page = this.requirePage();
      const [chooser] = await Promise.all([
        page.waitForEvent("filechooser", { timeout: 20_000 }),
        page.locator(triggerSelector).click(),
      ]);
      if (filePaths.length > 1 && !chooser.isMultiple()) {
        throw new CliError("The application opened a single-file chooser for a multi-file upload.");
      }
      await chooser.setFiles(filePaths);
    });
  }

  async saveState(): Promise<void> {
    await this.perform("saving authentication", async () => {
      const directory = dirname(this.account.stateFile);
      await mkdir(directory, { recursive: true, mode: 0o700 });
      const state = await this.requireContext().storageState();
      const temporary = `${this.account.stateFile}.${randomUUID()}.tmp`;
      try {
        await writeFile(temporary, JSON.stringify(state), { mode: 0o600 });
        await rename(temporary, this.account.stateFile);
        await chmod(this.account.stateFile, 0o600);
      } finally {
        await rm(temporary, { force: true });
      }
    });
  }

  async close(): Promise<void> {
    const browser = this.browser;
    const context = this.context;
    this.browser = undefined;
    this.context = undefined;
    this.page = undefined;
    this.tabs.clear();
    // A connected Browser.close disconnects. The system-browser launcher owns Chrome.
    if (browser) await browser.close();
    else if (context) await context.close();
  }
}
