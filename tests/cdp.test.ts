import { expect, test } from "bun:test";
import { uploadThroughFileChooser } from "../src/cdp.ts";

test("uploads multiple files through an intercepted Chrome file chooser", async () => {
  let browserSocket: import("bun").ServerWebSocket<unknown> | undefined;
  let uploadedFiles: string[] = [];
  const server = Bun.serve({
    port: 0,
    fetch(request, serverInstance) {
      if (serverInstance.upgrade(request)) {
        return;
      }
      return new Response("Upgrade required", { status: 426 });
    },
    websocket: {
      open(socket) {
        browserSocket = socket;
      },
      message(socket, rawMessage) {
        const message = JSON.parse(String(rawMessage)) as {
          id: number;
          method: string;
          params: Record<string, unknown>;
          sessionId?: string;
        };
        let result: unknown = {};
        if (message.method === "Target.getTargets") {
          result = {
            targetInfos: [
              {
                targetId: "target-1",
                type: "page",
                url: "https://notebooklm.google.com/notebook/test-id",
              },
            ],
          };
        } else if (message.method === "Target.attachToTarget") {
          result = { sessionId: "session-1" };
        } else if (message.method === "DOM.setFileInputFiles") {
          uploadedFiles = message.params.files as string[];
        }
        socket.send(
          JSON.stringify({
            id: message.id,
            result,
            sessionId: message.sessionId,
          }),
        );
      },
    },
  });

  try {
    await uploadThroughFileChooser(
      `ws://127.0.0.1:${server.port}`,
      "https://notebooklm.google.com/notebook/test-id",
      ["/tmp/source-a.m4a", "/tmp/source-b.pdf"],
      async () => {
        expect(browserSocket).toBeDefined();
        browserSocket?.send(
          JSON.stringify({
            method: "Page.fileChooserOpened",
            params: { backendNodeId: 42, mode: "selectMultiple" },
            sessionId: "session-1",
          }),
        );
      },
    );
    expect(uploadedFiles).toEqual([
      "/tmp/source-a.m4a",
      "/tmp/source-b.pdf",
    ]);
  } finally {
    server.stop(true);
  }
});
