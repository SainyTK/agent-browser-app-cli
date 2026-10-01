import { readFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { PlaywrightBrowser } from "../../src/browser/playwright.ts";

const [url, home] = process.argv.slice(2);
if (!url || !home) throw new Error("Expected a local fixture URL and isolated home");
const account = { id: "release-fixture", profileDir: join(home, "profile"), stateFile: join(home, "state.json"), createdAt: "", updatedAt: "" };
const browser = new PlaywrightBrowser(account, "fixture");
try {
  await browser.open(url);
  await browser.fill("#value", "compiled-release");
  await browser.click("#store");
  if (await browser.eval<string>("document.body.dataset.result") !== "compiled-release") throw new Error("Compiled page interaction failed");
  const tabs = await browser.listTabs();
  if (tabs[0]?.title !== "Release fixture") throw new Error("Compiled tab listing failed");
  await browser.saveState();
} finally {
  await browser.close();
}

// Verify the native WebSocket public connectOverCDP path in a compiled binary.
const chrome = process.env.AGENT_BROWSER_APP_BROWSER_BIN || (process.platform === "darwin"
  ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" : "/usr/bin/google-chrome");
const attachProfile = join(home, "attach-profile");
await mkdir(attachProfile, { recursive: true });
const child = Bun.spawn([chrome, "--headless=new", "--remote-debugging-port=0", `--user-data-dir=${attachProfile}`, "--no-first-run", "--no-default-browser-check", "about:blank"], { stdout: "ignore", stderr: "ignore" });
const attached = new PlaywrightBrowser({ ...account, profileDir: attachProfile }, "fixture");
try {
  let port = 0;
  for (let attempt = 0; attempt < 100; attempt++) {
    try { port = Number((await readFile(join(attachProfile, "DevToolsActivePort"), "utf8")).split("\n")[0]); } catch {}
    if (port) break;
    await Bun.sleep(100);
  }
  if (!port) throw new Error("Chrome debugging port did not become ready");
  await attached.attach(port);
  await attached.open(url);
  await attached.fill("#value", "compiled-cdp");
  await attached.click("#store");
  if (await attached.eval<string>("document.body.dataset.result") !== "compiled-cdp") throw new Error("Compiled CDP interaction failed");
  await attached.close();
  if (!(await fetch(`http://127.0.0.1:${port}/json/version`)).ok) throw new Error("Disconnect terminated Chrome");
} finally {
  await attached.close();
  child.kill();
  await child.exited;
}
console.log(JSON.stringify({ launch: "ok", interaction: "ok", tabs: "ok", storage: "ok", connectOverCDP: "ok", disconnect: "ok" }));
