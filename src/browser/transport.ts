import type { ConnectOverCDPTransport } from "playwright";
import { CliError } from "../errors.ts";

// Bun's node:ws compatibility can stall Playwright's CDP handshake.
// Use the public transport API with Bun's native WebSocket; Playwright still owns CDP.
export async function connectLocalChromeTransport(port: number): Promise<ConnectOverCDPTransport> {
  const response = await fetch(`http://127.0.0.1:${port}/json/version`, { signal: AbortSignal.timeout(10_000) });
  if (!response.ok) throw new CliError("System Chrome did not expose its debugging endpoint.");
  const version = await response.json() as { webSocketDebuggerUrl?: string };
  const endpoint = new URL(version.webSocketDebuggerUrl || "");
  if (endpoint.protocol !== "ws:" || !["127.0.0.1", "localhost", "[::1]"].includes(endpoint.hostname) || Number(endpoint.port) !== port) {
    throw new CliError("System Chrome returned an invalid local debugging endpoint.");
  }
  const socket = new WebSocket(endpoint);
  const transport: ConnectOverCDPTransport = {
    send(message) { socket.send(JSON.stringify(message)); },
    close() { socket.close(); },
  };
  socket.addEventListener("message", (event) => {
    if (typeof event.data !== "string") {
      socket.close();
      return;
    }
    try {
      transport.onmessage?.(JSON.parse(event.data));
    } catch {
      socket.close();
    }
  });
  socket.addEventListener("close", () => transport.onclose?.());
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      socket.close();
      reject(new CliError("Timed out connecting to system Chrome."));
    }, 10_000);
    socket.addEventListener("open", () => { clearTimeout(timeout); resolve(); }, { once: true });
    socket.addEventListener("error", () => {
      clearTimeout(timeout);
      socket.close();
      reject(new CliError("Could not connect to system Chrome."));
    }, { once: true });
  });
  return transport;
}
