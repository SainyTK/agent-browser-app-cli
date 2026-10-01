import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp, mkdir, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { PlaywrightBrowser } from "../src/browser/playwright.ts";
import type { Account } from "../src/registry.ts";
import { startSystemBrowser } from "../src/apps/system-browser.ts";
import { markConfirmNotebookRemovalScript } from "../src/apps/gnb/browser-scripts.ts";

const homes: string[] = [];
const sessions: PlaywrightBrowser[] = [];
let server: ReturnType<typeof Bun.serve>;
let frameServer: ReturnType<typeof Bun.serve>;
let baseUrl: string;

beforeAll(() => {
  frameServer = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch() {
    return new Response('<input id="search"><script>document.querySelector("input").addEventListener("keydown", e => { if (e.key === "Enter") document.body.dataset.enter = "yes"; });</script>', { headers: { "content-type": "text/html" } });
  } });
  server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch(request) {
    const path = new URL(request.url).pathname;
    const html = path === "/frames"
      ? `<iframe src="http://localhost:${frameServer.port}/picker"></iframe>`
      : `<title>Fixture page</title><input id="value"><button id="store" onclick="localStorage.setItem('fixture', document.querySelector('#value').value)">Store</button><input id="files" type="file" multiple><input id="single" type="file">`;
    return new Response(html, { headers: { "content-type": "text/html" } });
  } });
  baseUrl = `http://127.0.0.1:${server.port}`;
});

afterEach(async () => {
  await Promise.all(sessions.splice(0).map((browser) => browser.close()));
  await Promise.all(homes.splice(0).map((home) => rm(home, { recursive: true, force: true })));
});
afterAll(() => { server.stop(true); frameServer.stop(true); });

async function account(): Promise<Account> {
  const home = await mkdtemp(join(tmpdir(), "aba-playwright-test-"));
  homes.push(home);
  return { id: "fixture", profileDir: join(home, "profile"), stateFile: join(home, "state.json"), createdAt: "", updatedAt: "" };
}
function session(value: Account): PlaywrightBrowser {
  const browser = new PlaywrightBrowser(value, "fixture");
  sessions.push(browser);
  return browser;
}

describe("Playwright browser engine with real Chrome", () => {
  test("navigates, fills, clicks, evaluates, enumerates tabs and persists an isolated profile", async () => {
    const value = await account();
    const browser = session(value);
    await browser.open(baseUrl);
    await browser.fill("#value", "fixture-value");
    await browser.click("#store");
    expect(await browser.eval<string>("localStorage.getItem('fixture')")).toBe("fixture-value");
    const tabs = await browser.listTabs();
    expect(tabs[0]?.title).toBe("Fixture page");
    await browser.switchTab(tabs[0]!.tabId);
    expect(await browser.currentUrl()).toBe(`${baseUrl}/`);
    await browser.saveState();
    expect((await stat(value.stateFile)).mode & 0o777).toBe(0o600);
    expect((await stat(value.profileDir)).mode & 0o777).toBe(0o700);
    await browser.close();
    await browser.close();
    const restored = session(value);
    await restored.open(baseUrl);
    expect(await restored.eval<string>("localStorage.getItem('fixture')")).toBe("fixture-value");
  }, 30_000);

  test("imports legacy state into a new profile and does not overwrite a populated profile", async () => {
    const value = await account();
    await writeFile(value.stateFile, JSON.stringify({ cookies: [], origins: [{ origin: baseUrl, localStorage: [{ name: "fixture", value: "imported" }] }] }));
    const browser = session(value);
    await browser.open(baseUrl);
    expect(await browser.eval<string>("localStorage.getItem('fixture')")).toBe("imported");
    await browser.fill("#value", "newer-profile");
    await browser.click("#store");
    await browser.close();
    const restored = session(value);
    await restored.open(baseUrl);
    expect(await restored.eval<string>("localStorage.getItem('fixture')")).toBe("newer-profile");
    await restored.saveState();
    const saved = JSON.parse(await readFile(value.stateFile, "utf8"));
    expect(saved.origins[0].localStorage).toEqual([{ name: "fixture", value: "newer-profile" }]);
  }, 30_000);

  test("uses cross-origin frames for evaluation and real keyboard input", async () => {
    const browser = session(await account());
    await browser.open(`${baseUrl}/frames`);
    expect(await browser.fillInFrame("/picker", "#search", "Drive fixture", true)).toBe(true);
    expect(await browser.evalInFrame<string>("/picker", "document.querySelector('#search').value")).toBe("Drive fixture");
    expect(await browser.evalInFrame<string>("/picker", "document.body.dataset.enter")).toBe("yes");
    expect(await browser.fillInFrame("/picker", "#missing", "unused")).toBe(false);
  }, 30_000);

  test("uploads real files and validates single-file choosers", async () => {
    const value = await account();
    const browser = session(value);
    const one = join(homes.at(-1)!, "one.txt");
    const two = join(homes.at(-1)!, "two.txt");
    await writeFile(one, "one");
    await writeFile(two, "two");
    await browser.open(baseUrl);
    await browser.uploadFilesThroughFileChooser("#files", [one, two]);
    expect(await browser.eval<string[]>("Array.from(document.querySelector('#files').files, f => f.name)")).toEqual(["one.txt", "two.txt"]);
    await expect(browser.uploadFilesThroughFileChooser("#single", [one, two])).rejects.toThrow("single-file chooser");
    await expect(browser.uploadFilesThroughFileChooser("#files", [])).rejects.toThrow("At least one file");
  }, 30_000);

  test("attaches to system Chrome and disconnects without terminating its browser", async () => {
    const value = await account();
    await mkdir(value.profileDir, { recursive: true, mode: 0o700 });
    const system = await startSystemBrowser(value, baseUrl, {
      ...process.env,
      AGENT_BROWSER_APP_SYSTEM_BROWSER_BIN: join(import.meta.dir, "support/headless-chrome.ts"),
    });
    try {
      const browser = session(value);
      await browser.attach(system.cdpPort);
      const tabs = await browser.listTabs();
      await browser.switchTab(tabs.find((tab) => tab.url.startsWith(baseUrl))!.tabId);
      await browser.fill("#value", "attached");
      await browser.saveState();
      await browser.close();
      const response = await fetch(`http://127.0.0.1:${system.cdpPort}/json/list`);
      expect(response.ok).toBe(true);
    } finally {
      await system.close();
    }
    await session(value).open(baseUrl);
  }, 30_000);

  test("rejects locked profiles, invalid channels, and malformed storage without exposing secrets", async () => {
    const value = await account();
    await mkdir(value.profileDir);
    await symlink("nonexistent-host-123", join(value.profileDir, "SingletonLock"));
    await expect(session(value).open(baseUrl)).rejects.toThrow("profile is already open");
    await rm(join(value.profileDir, "SingletonLock"));
    const invalid = new PlaywrightBrowser(value, "fixture", { AGENT_BROWSER_APP_BROWSER_CHANNEL: "invalid" });
    await expect(invalid.open(baseUrl)).rejects.toThrow("must be chrome or chromium");
    await writeFile(value.stateFile, "SECRET invalid JSON");
    await expect(session(value).open(baseUrl)).rejects.toThrow("Could not read authentication storage state");
  });

  test("recognizes the current NotebookLM deletion dialog without matching other dialogs", async () => {
    const browser = session(await account());
    await browser.open(baseUrl);
    await browser.eval(`document.body.innerHTML = '<div role="dialog">Delete this notebook? This notebook and all of its content will be permanently deleted across all locations, including Gemini.<button>Cancel</button><button>Delete</button></div>'`);
    expect(await browser.eval<boolean>(markConfirmNotebookRemovalScript)).toBe(true);
    expect(await browser.eval<string>(`document.querySelector('[data-agent-browser-app-target="confirm-notebook-removal"]').textContent`)).toBe("Delete");
    await browser.eval(`document.body.innerHTML = '<div role="dialog">Delete this source?<button>Delete</button></div>'`);
    expect(await browser.eval<boolean>(markConfirmNotebookRemovalScript)).toBe(false);
  }, 30_000);

  test("redacts browser evaluation errors and closes the session", async () => {
    const browser = session(await account());
    await browser.open(baseUrl);
    await expect(browser.eval("(() => { throw new Error('SECRET fixture credential'); })()")).rejects.toThrow("Playwright failed while evaluating application state.");
    await browser.close();
    await expect(browser.currentUrl()).rejects.toThrow("not open");
  }, 30_000);
});
