import { expect, test } from "bun:test";
import {
  evaluateInFrame,
  fillInFrame,
  uploadThroughFileChooser,
} from "../src/cdp.ts";

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

test("evaluates an expression inside a matching child frame", async () => {
  let evaluatedContext: number | undefined;
  let evaluatedExpression: string | undefined;
  const server = Bun.serve({
    port: 0,
    fetch(request, serverInstance) {
      if (serverInstance.upgrade(request)) {
        return;
      }
      return new Response("Upgrade required", { status: 426 });
    },
    websocket: {
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
        } else if (message.method === "Page.getFrameTree") {
          result = {
            frameTree: {
              frame: {
                id: "main-frame",
                url: "https://notebooklm.google.com/notebook/test-id",
              },
              childFrames: [
                {
                  frame: {
                    id: "picker-frame",
                    url: "https://docs.google.com/picker/v2/home",
                  },
                },
              ],
            },
          };
        } else if (message.method === "Page.createIsolatedWorld") {
          expect(message.params.frameId).toBe("picker-frame");
          result = { executionContextId: 42 };
        } else if (message.method === "Runtime.evaluate") {
          evaluatedContext = message.params.contextId as number;
          evaluatedExpression = message.params.expression as string;
          result = {
            result: {
              value: { ready: true, optionCount: 1 },
            },
          };
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
    const result = await evaluateInFrame<{
      ready: boolean;
      optionCount: number;
    }>(
      `ws://127.0.0.1:${server.port}`,
      "https://notebooklm.google.com/notebook/test-id",
      "docs.google.com/picker/",
      "(() => ({ ready: true, optionCount: 1 }))()",
    );
    expect(result).toEqual({ ready: true, optionCount: 1 });
    expect(evaluatedContext).toBe(42);
    expect(evaluatedExpression).toContain("optionCount");
  } finally {
    server.stop(true);
  }
});

test("fills a child-frame input with CDP keyboard events", async () => {
  let insertedText: string | undefined;
  const keyEvents: string[] = [];
  const server = Bun.serve({
    port: 0,
    fetch(request, serverInstance) {
      if (serverInstance.upgrade(request)) {
        return;
      }
      return new Response("Upgrade required", { status: 426 });
    },
    websocket: {
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
        } else if (message.method === "Page.getFrameTree") {
          result = {
            frameTree: {
              frame: {
                id: "main-frame",
                url: "https://notebooklm.google.com/notebook/test-id",
              },
              childFrames: [
                {
                  frame: {
                    id: "picker-frame",
                    url: "https://docs.google.com/picker/v2/home",
                  },
                },
              ],
            },
          };
        } else if (message.method === "Page.createIsolatedWorld") {
          result = { executionContextId: 42 };
        } else if (message.method === "Runtime.evaluate") {
          result = { result: { value: true } };
        } else if (message.method === "Input.insertText") {
          insertedText = message.params.text as string;
        } else if (message.method === "Input.dispatchKeyEvent") {
          keyEvents.push(message.params.type as string);
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
    const result = await fillInFrame(
      `ws://127.0.0.1:${server.port}`,
      "https://notebooklm.google.com/notebook/test-id",
      "docs.google.com/picker/",
      'input[role="combobox"]',
      "Target document",
      true,
    );
    expect(result).toBe(true);
    expect(insertedText).toBe("Target document");
    expect(keyEvents).toEqual(["keyDown", "keyUp"]);
  } finally {
    server.stop(true);
  }
});
