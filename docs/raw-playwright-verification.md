# Raw Playwright verification

Implemented in the existing Treehouse worktree on `feat/playwright-engine`, starting at `a5ca332618d100a8fe28f7b862ca16a78c03ac6e`.
The primary repository was clean on `main` at `fb6b70ecbc05c7d3bfc3eb0d122ae1369e280726` when inspected.
No integration into `main` was performed.

## Checks

Run from this worktree:

```bash
bun run check
bun test
```

Final results:

```text
bun run check: exit 0
bun test: exit 0
44 pass
0 fail
477 expect() calls
Ran 44 tests across 5 files.
```

Focused checks:

```bash
bun test tests/cli.test.ts -t raw
bun test tests/browser.test.ts
bun test tests/release-packaging.test.ts
```

The CLI contract tests run under Bun with the browser-session preload.
They cover all application aliases, default URLs, script files, JSON and text results, stderr diagnostics, missing accounts, invalid arguments, syntax errors, and non-serializable results.
These mocked tests do not prove live application behavior.

The real browser tests use local HTTP pages and temporary account directories.
They invoke `bun ./src/cli.ts gnb raw --file ... --url ... --account fixture@example.test --headless --json` in a subprocess with its own `AGENT_BROWSER_HOME`.
The successful command exits 0 and returns:

```json
{"result":{"title":"Fixture page","value":"cli-fixture"}}
```

Additional real CLI subprocesses verify exit 1 for a script exception and an asynchronous timeout, empty stdout, redacted error messages, and browser cleanup.
Reopening the profile verifies persistence and that no previous command holds its lock.
Direct real Chrome coverage exercises locators, `context.newPage()`, and storage-state file permissions.

The release-packaging test builds and installs the compiled CLI outside the repository.
It runs `gnb raw` through the installed `aba` symlink against a local page, fills an input, and checks `{"result":"compiled raw"}` with exit 0.
It also verifies the exact Playwright runtime and the existing browser smoke checks.

## Test-run issues

Initial full runs timed out while repeatedly launching Chrome in the same test process.
The affected tests included the new repeated-session raw test and existing storage-import and frame tests.
A focused browser rerun passed, but subsequent full runs reproduced the timeouts.
The root cause was not established.
Error and timeout coverage was moved to real CLI subprocesses, matching normal command invocation instead of repeatedly running these commands inside the test process.
The resulting browser suite and full repository suite passed.
No production browser-launch workaround was added.

## Live application verification

Live NotebookLM, X, and Reddit accounts were not accessed.
Live authentication and repair workflows remain unverified because no authorization to use private credentials was provided.

For an authorized manual test, create a worktree-specific test account first:

```bash
export AGENT_BROWSER_HOME="/tmp/aba-raw-manual-$(basename "$PWD")"
bun ./src/cli.ts gnb auth login
bun ./src/cli.ts gnb raw 'return { title: await page.title() };' --headed --json
```

Expected result: the command opens the selected account's isolated profile, prints a JSON result containing the page title, and closes Chrome.
For another app, replace `gnb` in both commands with `x` or `reddit`.
Do not copy or print private profiles, cookies, or storage-state contents as verification evidence.
