#!/usr/bin/env bun

import { access, appendFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";

const logPath = process.env.FAKE_SYSTEM_BROWSER_LOG;
if (!logPath) {
  throw new Error("FAKE_SYSTEM_BROWSER_LOG is required");
}
await mkdir(dirname(logPath), { recursive: true });
await appendFile(
  logPath,
  `${JSON.stringify(process.argv.slice(2))}\n`,
);

const portArgument = process.argv
  .slice(2)
  .find((argument) => argument.startsWith("--remote-debugging-port="));
const port = Number(portArgument?.split("=")[1]);
if (!Number.isSafeInteger(port) || port <= 0) {
  throw new Error("A remote debugging port is required");
}
const donePath = process.env.FAKE_SYSTEM_BROWSER_DONE;
if (!donePath) {
  throw new Error("FAKE_SYSTEM_BROWSER_DONE is required");
}
const server = Bun.serve({
  hostname: "127.0.0.1",
  port,
  fetch(request) {
    if (new URL(request.url).pathname === "/json/list") {
      return Response.json([
        {
          type: "page",
          url: "https://x.com/home",
        },
      ]);
    }
    return new Response("Not found", { status: 404 });
  },
});
try {
  while (true) {
    try {
      await access(donePath);
      break;
    } catch {
      await Bun.sleep(25);
    }
  }
} finally {
  server.stop(true);
}
