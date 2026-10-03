# Compiled release packaging

Run `sh scripts/build-release.sh <version> <bun-target> <output-directory>` from the repository root after `bun install --frozen-lockfile`.
The archive contains the compiled `agent-browser-app` executable and its `agent-browser-app.runtime` directory.
Both `playwright` and `playwright-core` must be exactly version `1.63.0`.
The packager copies their complete published packages, including licenses, browser metadata, scripts and runtime assets.
It does not bundle Playwright's coreBundle.js or its optional chromium-bidi imports.
It does not download browser binaries.
Chrome must be installed, or an existing browser executable supplied through `AGENT_BROWSER_APP_BROWSER_BIN`.

The build plugin replaces only the application's Playwright import with the sidecar loader.
The loader locates the runtime beside the real executable using `process.execPath` and `realpathSync`.
It loads absolute package paths and checks both versions, without searching the current directory or an ambient `node_modules`.
Keep the executable and runtime directory together when moving a release manually.
Bun and Node are not required on the destination machine.

The installer verifies the archive checksum, then copies the executable and runtime into a new private release directory below the installation directory.
The `agent-browser-app` symlink points to that executable and `aba` points to `agent-browser-app`.
Additional symlinks also work because the loader resolves the executable's real path.
Reinstallation creates a separate directory so previous executable paths retain their matching runtime.
Previous release directories are retained deliberately and can be removed when no longer used.

Run `bun test tests/install.test.ts tests/release-packaging.test.ts` to verify packaging.
The test builds and installs a real archive, checks CLI help, errors, version and JSON output, and reinstalls it.
A separate smoke executable uses the production browser implementation and the same build plugin, with the installer-deployed runtime.
It runs through a symlink outside the repository against a local HTTP fixture and isolated Chrome profiles.
It tests persistent-context launch, page interaction, tab listing, state saving, native WebSocket CDP attachment and disconnect without terminating Chrome.
It also verifies that a missing sidecar fails rather than loading an ambient package.
No live accounts are used.
