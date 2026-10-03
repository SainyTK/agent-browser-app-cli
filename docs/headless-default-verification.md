# Headless default verification

Live checks used this worktree's `src/cli.ts` with an isolated `AGENT_BROWSER_HOME`.
NotebookLM and Reddit profiles were freshly copied from the user's saved accounts after renewed authentication.
X used a copy of the retained authenticated test profile.
The original profiles were not edited.
No credential values or private application contents are recorded here.

## Default behavior

X and NotebookLM application commands already ran headless by default.
Reddit feed and profile commands now also run headless unless `--headed` is supplied.
Reddit still accepts explicit `--headless` and rejects conflicting browser flags.
Authentication remains visible for manual sign-in.
No command automatically falls back to a visible browser.

## Live results

All commands used `bun ./src/cli.ts` from this checkout.
Commands without browser flags exercised the headless default.
Private notebook identifiers and the Reddit username below are placeholders.

| Arguments | Exit code | Result |
| --- | --- | --- |
| `gnb notebook list --json` | 0 | Ten notebooks returned. |
| `gnb notebook read <existing-id> --json` | 0 | Notebook title, summary, and two sources returned. |
| `gnb notebook source list --id <existing-id> --json` | 0 | Two sources returned. |
| `x feed --limit 5 --json` | 0 | Five posts returned. |
| `x profile OpenAI --json` | 0 | Profile returned. |
| `reddit feed --limit 5 --headless --json` before the change | 1 | Reddit requested browser verification. |
| `reddit feed --limit 5 --json` after the change | 1 | Reddit requested browser verification and suggested `--headed`. |
| `reddit profile <own-username> --json` after the change | 1 | Profile did not finish loading. |

Authenticated Reddit did not pass these headless checks.
Authentication alone does not guarantee that Reddit accepts headless browsing.
Notebook creation, source modification, chat, and fresh login were not repeated in this read-only retest.
No claims are made about those live workflows.

## Repository checks

`bun run check` passed with exit code 0.
`bun test` passed with exit code 0: 36 tests, 0 failures, 328 assertions.
The full suite included real local Chrome coverage and compiled-release packaging smoke coverage.
CLI regression tests verified five headless Reddit page opens and two explicit headed opens, excluding the visible login session.
Mocked CLI results do not substitute for the live Reddit failures above.

## Repeat checks

Copy the desired saved accounts into a private worktree-specific home without printing their contents.
Set `AGENT_BROWSER_HOME` to that home and run the commands above.
Successful commands should exit with code 0 and return JSON without opening a window.
If Reddit requests verification, `bun ./src/cli.ts reddit feed --limit 5 --headed --json` is an explicit visible-browser diagnostic option, not an automatic fallback.
