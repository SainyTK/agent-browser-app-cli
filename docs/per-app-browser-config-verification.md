# Per-app browser configuration verification

This change supersedes the all-headless default recorded in `headless-default-verification.md`.
Reddit now defaults to headed browsing.
X and NotebookLM retain headless defaults.

## Configuration

Each canonical app directory accepts an optional `config.json` containing `{"headed": true}` or `{"headed": false}`.
The path is `$AGENT_BROWSER_HOME/apps/agent-browser-app/<app>/config.json`, where `<app>` is `gnb`, `x`, or `reddit`.
The default home is `~/.agent-browser`.
Aliases use the canonical app's file.
Existing account registries, profiles, and storage-state paths are unchanged.
No config file is required or generated automatically.

Explicit `--headed` or `--headless` takes precedence over the file.
Supplying both flags fails with exit code 2.
Without either flag, an invalid config reports an error with exit code 2 before browser launch.
A missing file or an empty object uses the app's default.
Login does not read this setting and remains visible.
No automatic mode fallback was added.

## Live checks

Checks used this checkout's `src/cli.ts` and the same private worktree-specific copies of authenticated profiles used for the headless retest.
No config files or mode flags were supplied, so these checks exercised the new defaults.
Original user profiles were not edited.
Private account identities and application contents are omitted.

| Command | Browser mode | Exit code | Result |
| --- | --- | --- | --- |
| `bun ./src/cli.ts gnb notebook list --json` | Headless | 0 | Ten notebooks. |
| `bun ./src/cli.ts x feed --limit 5 --json` | Headless | 0 | Five posts. |
| `bun ./src/cli.ts reddit feed --limit 5 --json` | Headed | 0 | Five posts. |

These results cover listing and feeds, not every live workflow.
Notebook mutation, chat, fresh login, and live config overrides were not exercised in this change.

## Automated coverage

Config tests cover defaults and both config values for all three apps, explicit flag overrides, conflicting flags, missing and empty files, malformed JSON, invalid types, unknown settings, and read failures.
Errors include the config path but do not echo file contents.
Reddit CLI regression coverage checks headed defaults, explicit headless mode, config-selected headless feed and profile commands, and a headed override of that config.
Full repository checks include real local Chrome tests and compiled-release packaging smoke coverage.
