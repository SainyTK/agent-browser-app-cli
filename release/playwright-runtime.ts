import { realpathSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

// Resolve the executable, not argv[0] or cwd. Both installer aliases and user
// symlinks must find the same sidecar, with no ambient node_modules fallback.
const runtime = join(dirname(realpathSync(process.execPath)), "agent-browser-app.runtime");
const load = createRequire(join(runtime, "package.json"));
for (const name of ["playwright", "playwright-core"]) {
  const metadata = load(join(runtime, "node_modules", name, "package.json"));
  if (metadata.version !== "1.63.0") {
    throw new Error(`Release runtime requires ${name}@1.63.0.`);
  }
}
export const { chromium } = load(join(runtime, "node_modules", "playwright", "index.js"));
