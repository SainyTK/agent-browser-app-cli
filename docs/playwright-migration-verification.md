# Playwright migration verification

Verified on macOS ARM64 with Bun 1.3.12, Playwright 1.63.0, and installed Google Chrome on 2026-10-01.
All real CLI commands used this checkout's `src/cli.ts` and a worktree-specific `AGENT_BROWSER_HOME`.
Live checks used private temporary copies of the saved account profiles and storage-state files.
The original account directories were not edited.
Only counts, booleans, exit codes, and controlled fixture results were recorded.
No credentials, account identities, notebook contents, or storage-state values are included here.

## Automated checks

```bash
bun run check
bun test
AGENT_BROWSER_APP_BROWSER_CHANNEL=chromium bun test tests/release-packaging.test.ts
```

Type checking passed.
The integrated suite passed with 32 tests, no failures, and 312 assertions after the final Drive readiness change.
Focused chat and Drive hydration regression tests also passed.
The compiled-release smoke test passed with system Chrome and managed Chromium.
It installs an archive, resolves aliases outside the repository, rejects missing or mismatched runtime packages, and checks browser interaction, state saving, CDP attachment, and disconnect ownership.

The CLI suite mocks the browser-session factory through a test preload.
Its legacy fake executable is a test-only adapter, not the production browser engine.
Real browser tests separately cover navigation, input, uploads, cross-origin frames, state restoration, profile locking, and error redaction.

## Live checks

Commands below use placeholders instead of private account or notebook identifiers.
Every successful JSON command exited with code 0 and returned valid JSON.

| Command | Result |
| --- | --- |
| `bun src/cli.ts gnb auth list --json` | One cloned account was available. |
| `bun src/cli.ts gnb notebook list --json` | Ten existing notebooks were found. |
| `bun src/cli.ts gnb notebook read <existing-id> --json` | The existing notebook was readable. |
| `bun src/cli.ts gnb notebook source list --id <existing-id> --json` | Two sources were listed. |
| `bun src/cli.ts gnb notebook create --json` | A temporary notebook was created. |
| `bun src/cli.ts gnb notebook source add-text <fixture-text> --id <temporary-id> --timeout 90 --json` | A controlled text source was added. |
| `bun src/cli.ts gnb notebook source upload-files <fixture.txt> --id <temporary-id> --timeout 90 --json` | A controlled file source was uploaded and processed. |
| `bun src/cli.ts gnb notebook source add-urls https://playwright.dev/docs/intro --id <temporary-id> --timeout 90 --json` | A public URL source was added. |
| `bun src/cli.ts gnb ask "What is the fixture project code?" --id <temporary-id> --source playwright-fixture.txt --timeout 90 --json` | The answer contained the controlled fixture code. |
| `bun src/cli.ts gnb notebook source list --id <temporary-id> --json` | All three temporary sources were listed. |
| `bun src/cli.ts gnb notebook source remove <temporary-source-ids> --id <temporary-id> --json` | All three temporary sources were removed. |
| `bun src/cli.ts gnb notebook remove <temporary-id> --json` | The temporary notebook was removed. |
| `bun src/cli.ts gnb notebook source add-drive <unique-nonexistent-name> --id <existing-id> --timeout 60 --json` | The live picker opened, accepted input, and settled with the expected no-match error and exit code 1. No Drive document was imported. |
| `bun src/cli.ts reddit auth list --json` | One cloned account was available. |
| `bun src/cli.ts reddit feed --limit 3 --json` | Three posts were returned. |
| `bun src/cli.ts reddit profile <own-username> --json` | The profile was readable. |

Temporary notebooks from the initial diagnostic run and the final workflow run were removed.
The notebook count returned to the original ten after the first cleanup.
Cleanup commands remove only identifiers returned by the temporary create operation.

## Issues found and fixed

The initial NotebookLM chat command timed out waiting for an answer.
A diagnostic run showed that the query control was present before chat history finished loading.
Chat submission now waits for stable history with no visible loading indicator.
A regression test holds the loading state beyond the old stability threshold and checks that input is not filled early.
The final selected-source live query passed without mocks or diagnostic preloads.

Notebook deletion initially failed because the confirmation now says "Delete this notebook?" and "permanently deleted across all locations".
The adapter recognizes this wording while still rejecting unrelated deletion dialogs.
Both temporary notebook cleanup runs passed after the fix.

The first live Drive search did not settle.
The picker now waits for stable initial readiness before accepting search input.
A delayed-loading regression test passes, and the final live negative search returned the expected no-match result without mocks.
Actual Drive document insertion is not covered by this negative search.

Bun stalled Playwright's default CDP WebSocket handshake in a local reproduction.
The engine uses Playwright's public transport API with Bun's native WebSocket.
Playwright still owns the CDP protocol and browser operations.
Real local Chrome tests and compiled-release tests verify attachment and disconnect.
The system-browser launcher requests graceful Chrome shutdown before its process fallback so the owned profile lock is released.

## Authentication limits

No X account registry was present in the default application directory.
An isolated `x auth login --system-browser --timeout 600` window was opened, but sign-in did not complete.
Live X feed and profile checks remain unverified.
They require the user to complete login.

Reddit's saved legacy storage-state file also worked when imported into a fresh profile, returning a live feed with exit code 0.
NotebookLM's old storage-state snapshot alone produced an expired-authentication error, although its copied persistent profile passed the live application checks.
This confirms why a populated profile must not be overwritten by an older snapshot.
A native system Chrome authentication-recapture attempt with the copied NotebookLM profile did not reach a ready home page within the login timeout.
Fresh native NotebookLM authentication still requires user-controlled sign-in.
Synthetic local tests verify Playwright state import and export independently of live session expiration.

To complete the missing X checks in an isolated test home:

```bash
export AGENT_BROWSER_HOME="/path/to/private-test-home"
bun ./src/cli.ts x auth login --system-browser
bun ./src/cli.ts x auth list --json
bun ./src/cli.ts x feed --limit 3 --json
bun ./src/cli.ts x profile OpenAI --json
```

Complete sign-in in the isolated Chrome window.
The login command should detect the authenticated profile, save its state, and close the window.
The subsequent commands should exit with code 0 and produce valid JSON.
Do not include the account registry or storage-state file contents in shared logs.
