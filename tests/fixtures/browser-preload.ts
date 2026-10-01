import { mock } from "bun:test";
import { LegacyTestBrowser } from "./legacy-test-browser.ts";

// Only CLI subprocesses preload this mock. Production has no fake browser hook.
mock.module("../../src/browser/index.ts", () => ({
  createBrowser: (
    ...args: ConstructorParameters<typeof LegacyTestBrowser>
  ) => new LegacyTestBrowser(...args),
}));
