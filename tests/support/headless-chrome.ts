#!/usr/bin/env bun
import { chromium } from "playwright";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const channel = process.env.AGENT_BROWSER_APP_BROWSER_CHANNEL || "chrome";
const chrome = process.platform === "darwin"
  ? ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", join(homedir(), "Applications/Google Chrome.app/Contents/MacOS/Google Chrome")].find(existsSync)
  : Bun.which("google-chrome") || Bun.which("google-chrome-stable") || Bun.which("chromium") || Bun.which("chromium-browser");
const binary = process.env.AGENT_BROWSER_APP_BROWSER_BIN || (channel === "chromium" ? chromium.executablePath() : chrome);
if (!binary) throw new Error("Install Chrome or select bundled Chromium for browser tests.");
const child = Bun.spawn([binary, "--headless=new", ...process.argv.slice(2)], {
  stdin: "ignore", stdout: "inherit", stderr: "inherit",
});
process.on("SIGTERM", () => child.kill());
process.on("SIGINT", () => child.kill());
process.exit(await child.exited);
