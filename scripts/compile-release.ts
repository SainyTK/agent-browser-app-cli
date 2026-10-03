import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";

const root = resolve(import.meta.dir, "..");
const require = createRequire(join(root, "package.json"));

export async function compileRelease(
  entrypoint: string,
  outfile: string,
  target: Bun.Build.CompileTarget,
  version: string,
): Promise<void> {
  const runtime = join(dirname(outfile), "agent-browser-app.runtime");
  await rm(runtime, { recursive: true, force: true });
  await mkdir(join(runtime, "node_modules"), { recursive: true });
  for (const name of ["playwright", "playwright-core"]) {
    const metadataPath = require.resolve(`${name}/package.json`);
    const metadata = JSON.parse(await readFile(metadataPath, "utf8"));
    if (metadata.version !== "1.63.0") {
      throw new Error(`Release packaging requires ${name}@1.63.0, found ${metadata.version}.`);
    }
    // Keep the complete published package. Playwright resolves scripts, browser
    // metadata, injected sources and other assets relative to its own files.
    await cp(dirname(metadataPath), join(runtime, "node_modules", name), { recursive: true, dereference: true });
  }
  await writeFile(join(runtime, "package.json"), JSON.stringify({ private: true, dependencies: { playwright: "1.63.0", "playwright-core": "1.63.0" } }) + "\n");
  const result = await Bun.build({
    entrypoints: [entrypoint],
    compile: { target, outfile },
    define: { AGENT_BROWSER_APP_BUILD_VERSION: JSON.stringify(version) },
    plugins: [{
      name: "release-playwright-sidecar",
      setup(build) {
        build.onResolve({ filter: /^playwright$/ }, () => ({ path: join(root, "release/playwright-runtime.ts") }));
      },
    }],
  });
  if (!result.success) throw new AggregateError(result.logs, "Release compilation failed");
}

if (import.meta.main) {
  const [version, target, outputDirectory] = process.argv.slice(2);
  if (!version || !target || !outputDirectory) throw new Error("Usage: compile-release.ts <version> <bun-target> <output-directory>");
  await compileRelease(join(root, "src/cli.ts"), resolve(outputDirectory, "agent-browser-app"), target as Bun.Build.CompileTarget, version);
}
