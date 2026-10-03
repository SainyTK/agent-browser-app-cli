# Packaging verification

The packaging branch started at `fb6b70ecbc05c7d3bfc3eb0d122ae1369e280726` and first fast-forward merged `feat/playwright-engine` at `f153140`.
Verification ran on macOS arm64 with Bun 1.3.12 and installed Google Chrome.
No live accounts were used.

## Passing checks

`bun run check` exited 0.
The packaging helpers also passed a separate strict TypeScript check because the repository configuration does not include `scripts/` or `release/`.

```sh
bun ./node_modules/typescript/bin/tsc --noEmit --target ES2022 --module ESNext \
  --moduleResolution Bundler --strict --allowImportingTsExtensions \
  --types bun-types scripts/compile-release.ts release/playwright-runtime.ts
bun test tests/install.test.ts tests/release-packaging.test.ts
```

Both commands exited 0.
The focused tests reported 5 passes, 0 failures and 47 assertions.
The actual compiled Chrome smoke printed:

```json
{"launch":"ok","interaction":"ok","tabs":"ok","storage":"ok","connectOverCDP":"ok","disconnect":"ok"}
```

The smoke executable ran through a symlink outside the repository and loaded the installer-deployed sidecar.
An ambient Playwright module deliberately throws if used.
Missing and mismatched runtime tests failed as expected without loading that ambient module.
The production CLI archive passed installation, reinstallation, version, help, invalid-command exit-code and JSON checks.

## Retained build

```sh
export AGENT_BROWSER_HOME=/tmp/aba-playwright-release-verification
sh scripts/build-release.sh 0.3.2 bun-darwin-arm64 /tmp/aba-release-build
cd /tmp
/tmp/aba-release-build/agent-browser-app --version
/tmp/aba-release-build/agent-browser-app gnb auth list --json
```

Each command exited 0.
The version was `0.3.2` and the JSON contained an empty accounts array.
The retained archive is `/tmp/aba-release-build/agent-browser-app-v0.3.2-darwin-arm64.tar.gz`, with a matching `.sha256` file.
The executable and its runtime are also retained in that directory.

## Full suite status

The original isolated packaging branch had twelve failures in the then-unmigrated CLI fixtures.
The CLI fixture migration has since been integrated.
`bun run check && bun test` now exits 0 with 36 passes, no failures, and 326 assertions, including X popup detection and native-cookie profile reuse.
The compiled-release smoke also passes with managed Chromium.
See [migration verification](../docs/playwright-migration-verification.md) for the integrated source and live application checks.
