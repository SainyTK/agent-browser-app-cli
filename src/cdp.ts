import { CliError } from "./errors.ts";

interface CdpMessage {
  id?: number;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: { code: number; message: string };
  sessionId?: string;
}

interface PendingCommand {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timeout: ReturnType<typeof setTimeout>;
}

interface EventWaiter {
  method: string;
  sessionId?: string;
  resolve: (message: CdpMessage) => void;
  reject: (error: Error) => void;
  timeout: ReturnType<typeof setTimeout>;
}

export class CdpClient {
  private nextId = 1;
  private readonly pending = new Map<number, PendingCommand>();
  private readonly waiters = new Set<EventWaiter>();

  private constructor(private readonly socket: WebSocket) {
    socket.addEventListener("message", (event) => {
      this.handleMessage(event.data);
    });
    socket.addEventListener("close", () => {
      this.rejectAll(new CliError("Chrome DevTools connection closed unexpectedly."));
    });
  }

  static async connect(url: string, timeoutMs = 10_000): Promise<CdpClient> {
    const socket = new WebSocket(url);
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        socket.close();
        reject(new CliError("Timed out connecting to Chrome DevTools."));
      }, timeoutMs);
      socket.addEventListener(
        "open",
        () => {
          clearTimeout(timeout);
          resolve();
        },
        { once: true },
      );
      socket.addEventListener(
        "error",
        () => {
          clearTimeout(timeout);
          reject(new CliError("Could not connect to Chrome DevTools."));
        },
        { once: true },
      );
    });
    return new CdpClient(socket);
  }

  async send<T>(
    method: string,
    params: Record<string, unknown> = {},
    sessionId?: string,
    timeoutMs = 15_000,
  ): Promise<T> {
    const id = this.nextId;
    this.nextId += 1;
    const response = new Promise<T>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        reject(new CliError(`Chrome DevTools timed out running ${method}.`));
      }, timeoutMs);
      this.pending.set(id, {
        resolve: (value) => resolve(value as T),
        reject,
        timeout,
      });
    });
    this.socket.send(JSON.stringify({ id, method, params, sessionId }));
    return response;
  }

  waitForEvent<T>(
    method: string,
    sessionId?: string,
    timeoutMs = 15_000,
  ): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const waiter: EventWaiter = {
        method,
        sessionId,
        resolve: (message) => resolve(message.params as T),
        reject,
        timeout: setTimeout(() => {
          this.waiters.delete(waiter);
          reject(new CliError(`Chrome DevTools did not emit ${method}.`));
        }, timeoutMs),
      };
      this.waiters.add(waiter);
    });
  }

  close(): void {
    this.socket.close();
  }

  private handleMessage(data: string | ArrayBuffer | Blob): void {
    if (typeof data !== "string") {
      if (data instanceof Blob) {
        void data.text().then((text) => this.handleMessage(text));
      } else {
        this.handleMessage(new TextDecoder().decode(data));
      }
      return;
    }
    const message = JSON.parse(data) as CdpMessage;
    if (message.id !== undefined) {
      const command = this.pending.get(message.id);
      if (!command) {
        return;
      }
      clearTimeout(command.timeout);
      this.pending.delete(message.id);
      if (message.error) {
        command.reject(
          new CliError(
            `Chrome DevTools ${message.error.code}: ${message.error.message}`,
          ),
        );
      } else {
        command.resolve(message.result);
      }
      return;
    }
    if (!message.method) {
      return;
    }
    for (const waiter of this.waiters) {
      if (
        waiter.method === message.method &&
        (!waiter.sessionId || waiter.sessionId === message.sessionId)
      ) {
        clearTimeout(waiter.timeout);
        this.waiters.delete(waiter);
        waiter.resolve(message);
      }
    }
  }

  private rejectAll(error: Error): void {
    for (const command of this.pending.values()) {
      clearTimeout(command.timeout);
      command.reject(error);
    }
    this.pending.clear();
    for (const waiter of this.waiters) {
      clearTimeout(waiter.timeout);
      waiter.reject(error);
    }
    this.waiters.clear();
  }
}

interface TargetInfo {
  targetId: string;
  type: string;
  url: string;
}

interface Frame {
  id: string;
  url: string;
}

interface FrameTree {
  frame: Frame;
  childFrames?: FrameTree[];
}

function flattenFrames(tree: FrameTree): Frame[] {
  return [
    tree.frame,
    ...(tree.childFrames || []).flatMap((child) => flattenFrames(child)),
  ];
}

function notebookTarget(
  targets: TargetInfo[],
  pageUrl: string,
): TargetInfo | undefined {
  return (
    targets.find(
      (candidate) =>
        candidate.type === "page" && candidate.url === pageUrl,
    ) ??
    targets.find(
      (candidate) =>
        candidate.type === "page" &&
        /^https:\/\/(?:notebooklm|notebook)\.google\.com\/notebook\//.test(
          candidate.url,
        ),
    )
  );
}

async function withFrameSession<T>(
  cdpUrl: string,
  pageUrl: string,
  frameUrlIncludes: string,
  timeoutMs: number,
  operation: (
    client: CdpClient,
    sessionId: string,
    executionContextId: number,
  ) => Promise<T>,
): Promise<T> {
  const client = await CdpClient.connect(cdpUrl);
  let sessionId: string | undefined;
  try {
    const targets = await client.send<{ targetInfos: TargetInfo[] }>(
      "Target.getTargets",
    );
    const target = notebookTarget(targets.targetInfos, pageUrl);
    if (!target) {
      throw new CliError("Could not find the Gemini Notebook browser target.");
    }
    const attached = await client.send<{ sessionId: string }>(
      "Target.attachToTarget",
      { targetId: target.targetId, flatten: true },
    );
    sessionId = attached.sessionId;

    const deadline = Date.now() + timeoutMs;
    let frame: Frame | undefined;
    while (!frame && Date.now() < deadline) {
      const result = await client.send<{ frameTree: FrameTree }>(
        "Page.getFrameTree",
        {},
        sessionId,
      );
      frame = flattenFrames(result.frameTree).find((candidate) =>
        candidate.url.includes(frameUrlIncludes),
      );
      if (!frame) {
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
    }
    if (!frame) {
      throw new CliError(
        `Could not find the browser frame containing "${frameUrlIncludes}".`,
      );
    }

    const isolatedWorld = await client.send<{
      executionContextId: number;
    }>(
      "Page.createIsolatedWorld",
      {
        frameId: frame.id,
        worldName: "agent-browser-app",
        grantUniveralAccess: false,
      },
      sessionId,
    );
    return await operation(
      client,
      sessionId,
      isolatedWorld.executionContextId,
    );
  } finally {
    if (sessionId) {
      await client
        .send("Target.detachFromTarget", { sessionId })
        .catch(() => undefined);
    }
    client.close();
  }
}

export async function evaluateInFrame<T>(
  cdpUrl: string,
  pageUrl: string,
  frameUrlIncludes: string,
  expression: string,
  timeoutMs = 20_000,
): Promise<T> {
  return withFrameSession(
    cdpUrl,
    pageUrl,
    frameUrlIncludes,
    timeoutMs,
    async (client, sessionId, executionContextId) => {
      const evaluated = await client.send<{
        result: { value?: T; description?: string };
        exceptionDetails?: {
          text?: string;
          exception?: { description?: string };
        };
      }>(
        "Runtime.evaluate",
        {
          expression,
          contextId: executionContextId,
          returnByValue: true,
          awaitPromise: true,
          userGesture: true,
        },
        sessionId,
        timeoutMs,
      );
      if (evaluated.exceptionDetails) {
        throw new CliError(
          evaluated.exceptionDetails.exception?.description ||
            evaluated.exceptionDetails.text ||
            "Browser frame evaluation failed.",
        );
      }
      return evaluated.result.value as T;
    },
  );
}

export async function fillInFrame(
  cdpUrl: string,
  pageUrl: string,
  frameUrlIncludes: string,
  selector: string,
  value: string,
  pressEnter = false,
  timeoutMs = 20_000,
): Promise<boolean> {
  return withFrameSession(
    cdpUrl,
    pageUrl,
    frameUrlIncludes,
    timeoutMs,
    async (client, sessionId, executionContextId) => {
      const focused = await client.send<{
        result: { value?: boolean };
        exceptionDetails?: {
          text?: string;
          exception?: { description?: string };
        };
      }>(
        "Runtime.evaluate",
        {
          expression: String.raw`
(() => {
  const target = document.querySelector(${JSON.stringify(selector)});
  if (!target) return false;
  target.focus();
  target.select();
  return true;
})()
`,
          contextId: executionContextId,
          returnByValue: true,
          userGesture: true,
        },
        sessionId,
        timeoutMs,
      );
      if (focused.exceptionDetails || !focused.result.value) {
        return false;
      }
      await client.send(
        "Input.insertText",
        { text: value },
        sessionId,
        timeoutMs,
      );
      if (pressEnter) {
        await client.send(
          "Input.dispatchKeyEvent",
          {
            type: "keyDown",
            key: "Enter",
            code: "Enter",
            windowsVirtualKeyCode: 13,
            nativeVirtualKeyCode: 13,
          },
          sessionId,
          timeoutMs,
        );
        await client.send(
          "Input.dispatchKeyEvent",
          {
            type: "keyUp",
            key: "Enter",
            code: "Enter",
            windowsVirtualKeyCode: 13,
            nativeVirtualKeyCode: 13,
          },
          sessionId,
          timeoutMs,
        );
      }
      return true;
    },
  );
}

export async function uploadThroughFileChooser(
  cdpUrl: string,
  pageUrl: string,
  filePaths: string[],
  trigger: () => Promise<void>,
): Promise<void> {
  if (filePaths.length === 0) {
    throw new CliError("At least one file is required for upload.");
  }
  const client = await CdpClient.connect(cdpUrl);
  let sessionId: string | undefined;
  try {
    const targets = await client.send<{ targetInfos: TargetInfo[] }>(
      "Target.getTargets",
    );
    const target = notebookTarget(targets.targetInfos, pageUrl);
    if (!target) {
      throw new CliError("Could not find the Gemini Notebook browser target.");
    }
    const attached = await client.send<{ sessionId: string }>(
      "Target.attachToTarget",
      { targetId: target.targetId, flatten: true },
    );
    sessionId = attached.sessionId;
    await client.send("Page.enable", {}, sessionId);
    await client.send(
      "Page.setInterceptFileChooserDialog",
      { enabled: true },
      sessionId,
    );
    const chooser = client.waitForEvent<{
      backendNodeId: number;
      mode?: "selectSingle" | "selectMultiple";
    }>(
      "Page.fileChooserOpened",
      sessionId,
      20_000,
    );
    await trigger();
    const { backendNodeId, mode } = await chooser;
    if (filePaths.length > 1 && mode === "selectSingle") {
      throw new CliError(
        "Gemini Notebook opened a single-file chooser for a multi-file upload.",
      );
    }
    await client.send(
      "DOM.setFileInputFiles",
      { files: filePaths, backendNodeId },
      sessionId,
      30_000,
    );
  } finally {
    if (sessionId) {
      await client
        .send(
          "Page.setInterceptFileChooserDialog",
          { enabled: false },
          sessionId,
        )
        .catch(() => undefined);
      await client
        .send("Target.detachFromTarget", { sessionId })
        .catch(() => undefined);
    }
    client.close();
  }
}
