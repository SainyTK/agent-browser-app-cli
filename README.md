![Agent Browser App visual identity](assets/agent-browser-app-wallpaper.png)

# Agent Browser App (aba cli)

`Agent Browser App` provides small, stable commands for authenticated web applications.
It is also installed as `aba`, a shorter alias that supports the same commands and options.
It runs browser work through Playwright under Bun and keeps the browser visible when authentication requires a real user.
The runtime dependency is pinned to exactly `playwright@1.63.0`.
The agent-browser executable is no longer required.

The included application adapters are Gemini Notebook, formerly NotebookLM, X, formerly Twitter, and Reddit.
Gemini Notebook accepts `gnb`, `gemini-notebook`, and `notebooklm`.
X accepts `x` and `twitter`.
Reddit accepts `reddit`.

## Why this exists

Google and social applications can reject automation that arrives with a fresh browser identity.
A profile directory preserves the browser fingerprint, cache, IndexedDB, service workers, and persistent cookies.
A separate storage-state file preserves cookies and web storage that may otherwise disappear between browser restarts.

Each application keeps its accounts separate while using both:

```text
~/.agent-browser/apps/agent-browser-app/
|-- gnb/
|   |-- accounts.json
|   `-- accounts/
|       `-- default/
|           |-- browser-profile/
|           `-- state.json
|-- x/
|   |-- accounts.json
|   `-- accounts/
|       `-- default/
|           |-- browser-profile/
|           `-- state.json
`-- reddit/
    |-- accounts.json
    `-- accounts/
        `-- username/
            |-- browser-profile/
            `-- state.json
```

Existing agent-browser-compatible account paths, Chrome profiles, and storage-state files remain in place.
Set `AGENT_BROWSER_HOME` to change the base directory from `~/.agent-browser`.
Playwright opens each account's isolated persistent browser context in system Chrome by default.
A populated profile is authoritative, so an older `state.json` does not overwrite its session.
When the profile is fresh, the CLI imports `state.json` before opening the application.
Native Chrome login records the profile's credential store so Playwright can reuse its encrypted cookies.
Existing unmarked profiles retain their legacy credential-store behavior.
Treat the profile and `state.json` as secrets because they contain authenticated session material.

## Requirements

- Bun 1.3 or newer for source development
- System Google Chrome for the default browser channel and native system-browser login

`bun install` installs the exact `playwright@1.63.0` runtime dependency.
Set `AGENT_BROWSER_APP_BROWSER_BIN` to override the executable used by Playwright.
For optional Playwright-managed Chromium instead of system Chrome:

```bash
bunx playwright install chromium
export AGENT_BROWSER_APP_BROWSER_CHANNEL=chromium
```

The default channel is `chrome`; the other supported channel is `chromium`.
Native `--system-browser` login still launches system Chrome, not the Playwright-managed Chromium channel.
Set `AGENT_BROWSER_APP_SYSTEM_BROWSER_BIN` to override the executable for that native login flow.

## Install

Install the latest LTS release from `main`:

```bash
curl -fsSL https://raw.githubusercontent.com/SainyTK/agent-browser-app-cli/main/install.sh | sh
```

Install the latest preview release from `preview`:

```bash
curl -fsSL https://raw.githubusercontent.com/SainyTK/agent-browser-app-cli/main/install.sh | sh -s -- --channel preview
```

The installer selects the correct macOS or Linux binary for Intel or ARM, verifies its SHA-256 checksum, and installs `agent-browser-app` plus the `aba` alias to `~/.local/bin`.
Set `AGENT_BROWSER_APP_INSTALL_DIR` or pass `--install-dir` to use another directory.
Make sure that directory is on `PATH`.

Chrome is still required for the default configuration.
The CLI does not require an agent-browser executable.
Compiled releases include an exact-version Playwright runtime directory beside the executable.
The installer keeps the executable and runtime together in a versioned directory and points both command names to it.
Do not move the executable without its runtime directory.
See [release packaging](release/packaging.md) for details.

## Install for local development

```bash
bun install
bun link
```

Verify both names for this CLI are available:

```bash
agent-browser-app --version
aba --version
```

The examples below use `aba`.
Replace it with `agent-browser-app` if you prefer the full name.

## Authenticate

Start a headed Chrome session and complete Google sign-in:

```bash
aba gnb auth login
```

The CLI waits for the browser to return to Gemini Notebook, saves `state.json`, and records the detected account email when the page exposes it.

To add or refresh a specific account:

```bash
aba gnb auth login --account you@example.com
```

Google can reject sign-in in a software-controlled browser.
Use system Chrome when that happens:

```bash
aba gnb auth login --account you@example.com --system-browser
```

The CLI launches native system Chrome with an isolated account profile and waits for the Gemini Notebook home page.
Playwright attaches over CDP through Bun's native WebSocket transport, saves the authenticated state, and lets the launcher close the isolated browser.
Notebook commands reopen that same profile through Playwright.
It does not ask for cookies, passwords, or browser-session data.

List accounts and select the default account:

```bash
aba gnb auth list
aba gnb auth switch you@example.com
```

Account selectors accept an email address or the ID displayed by `auth list`.
Notebook commands also accept `--account <email-or-id>`.

## Gemini Notebook commands

List notebooks visible to the active account:

```bash
aba gnb notebook list
aba gnb notebook list --account you@example.com
```

Create an empty notebook and print its URL:

```bash
aba gnb notebook create
```

Remove one or more notebooks by ID:

```bash
agent-browser-app gnb notebook remove notebook-id-1 notebook-id-2
```

The command validates every requested ID before it removes any notebook.
Notebook removal is permanent.

Read visible notebook metadata:

```bash
aba gnb notebook read <notebook-id-or-url>
```

Ask a notebook question using only selected sources:

```bash
aba gnb ask "What are the main findings?" \
  --id "notebook-id-or-url" \
  --source source-1 \
  --source source-2 \
  --source "research-notes.pdf"
```

Repeat `--source` with a source ID from `source list` or an exact source filename.
If you do not specify `--source`, Gemini Notebook uses whichever sources are currently checked in that notebook.
Use `--timeout <seconds>` to override the answer wait.

Add copied text as a source:

```bash
aba gnb notebook source add-text \
  "Text content to use as a source." \
  --id "notebook-id-or-url"
```

Add one or more website URLs in one command:

```bash
aba gnb notebook source add-urls \
  "https://example.com/source-one" \
  "https://example.com/source-two" \
  --id "notebook-id-or-url"
```

URLs must use HTTP or HTTPS and must be unique within one command.

Add a Google Drive item by its exact displayed name or Drive URL:

```bash
aba gnb notebook source add-drive \
  "Quarterly research notes" \
  --id "notebook-id-or-url"
```

The command searches through Gemini Notebook's embedded Google Drive picker.
If more than one item has the requested name, pass the item's Drive URL to select it exactly.

Upload one or more local files as sources:

```bash
aba gnb notebook source upload-files \
  "/path/to/source-a.m4a" \
  "/path/to/source-b.pdf" \
  --id "notebook-id-or-url"
```

All paths are validated before the browser opens.
The command uses one file chooser and stays open until every newly added source is ready for queries.
Files in the same call must have unique filenames.
Copied text, URL, Drive, and file commands stay open until every newly added source is ready for queries.
Use `--timeout <seconds>` to override the 30-minute processing timeout for any source-add command.

List sources and their current IDs:

```bash
aba gnb notebook source list \
  --id "notebook-id-or-url"
```

Remove one or more sources:

```bash
aba gnb notebook source remove source-2 source-4 \
  --id "notebook-id-or-url"
```

Source IDs describe the current displayed order.
Run `source list` immediately before removal because IDs can change after sorting, adding, or removing sources.
The command validates every requested ID before it removes any source.

Use `--headed` on a notebook command when debugging a UI change.
Use `--json` for machine-readable output.

## Gemini Notebook authentication behavior

Login runs in headed mode because Google may require manual account selection, passkeys, or two-factor authentication.
Pass `--system-browser` to use native system Chrome login when Google rejects the Playwright-controlled window.
Both login flows use the account's isolated profile, not your regular Chrome profile.
Notebook commands reopen that persistent profile through Playwright and run headless unless you pass `--headed`.
A populated profile supplies authentication directly.
Only a fresh profile imports `state.json` before navigation.
Only `auth login` writes `state.json`, but normal browser operations can update the persistent profile.

The CLI does not print cookie values.
It stores account metadata in `accounts.json`.

## X authentication

Start a headed Chrome session and complete X sign-in:

```bash
agent-browser-app x auth login
```

The CLI opens X's browser login flow and detects authenticated account navigation.
An authenticated page can remain on another X route or retain a sign-in popup.
It saves Playwright storage state to the existing `state.json` path and records the detected username when X exposes the profile navigation link.

Google can reject sign-in when its OAuth page detects software-controlled Chrome.
Use the system-browser bootstrap when signing in to X through Google:

```bash
agent-browser-app x auth login --system-browser
```

This opens normal Google Chrome with the same isolated account profile.
Complete X sign-in.
The CLI checks all X tabs for authenticated account navigation, so a remaining sign-in popup does not prevent login detection.
Playwright attaches to that authenticated Chrome instance over CDP through Bun's native WebSocket transport.
The CLI saves `state.json` and closes the isolated browser automatically.

To add or refresh a specific account:

```bash
agent-browser-app x auth login --account @username
```

List configured X accounts:

```bash
agent-browser-app x auth list
agent-browser-app x auth list --json
```

The most recently authenticated account is active.
X commands accept `--account <handle-or-id>` when more than one account is configured.

## X commands

Read posts from the authenticated home feed:

```bash
agent-browser-app x feed
agent-browser-app x feed --limit 10
agent-browser-app x feed --limit 10 --json
```

The default limit is 20.
The adapter accumulates posts while scrolling the browser-rendered home timeline and stops at the requested limit or when no additional posts load.

Read an X profile by username, handle, numeric user ID, or profile URL:

```bash
agent-browser-app x profile OpenAI
agent-browser-app x profile @OpenAI
agent-browser-app x profile 4398626122
agent-browser-app x profile https://x.com/OpenAI --json
```

Twitter profile URLs are accepted and normalized to X.
Numeric user IDs use X's browser profile route and resolve to the current username.
Profile output includes the numeric user ID when X exposes it, the username, display name, bio, public profile fields, exact schema-provided counts, and verification and protection status.

Use `--headed` on `feed` or `profile` when debugging an X interface change.
Use `--json` for machine-readable output.

X workflows stay browser-driven.
The adapter reads semantic HTML, schema.org metadata, accessible labels, and visible client-side elements from the rendered page.
It does not call private X APIs.

## Reddit authentication

Start an isolated system Chrome session and complete Reddit sign-in:

```bash
agent-browser-app reddit auth login
```

The CLI uses normal system Chrome by default because Reddit may challenge software-controlled Chrome.
It opens Reddit's login page in an isolated profile, waits for an authenticated page, saves Playwright storage state, and records the detected username.
The isolated browser closes automatically after authentication is captured.
To use Playwright-controlled login instead of native system Chrome login:

```bash
agent-browser-app reddit auth login --playwright
```

This uses the configured Playwright browser channel or executable override.
Reddit may challenge this automated login flow.
`--agent-browser` remains a deprecated alias for `--playwright` and prints a warning.
It does not invoke agent-browser.
The former `--system-browser` option remains accepted for compatibility but is no longer required.

List configured Reddit accounts:

```bash
agent-browser-app reddit auth list
agent-browser-app reddit auth list --json
```

The most recently authenticated account is active.
Reddit login detects the username from the authenticated browser and records it automatically.
You do not need to know or provide the username before signing in.
Reddit commands accept `--account <username-or-id>` when more than one account is configured.

## Reddit commands

Read posts from the authenticated home feed:

```bash
agent-browser-app reddit feed
agent-browser-app reddit feed --limit 10
agent-browser-app reddit feed --limit 10 --json
```

Reddit `feed` and `profile` commands open a visible Chrome window by default because Reddit commonly challenges headless browsers.
Use `--headless` only in an environment where Reddit accepts headless browsing.
The default feed limit is 20.
The adapter accumulates posts while scrolling the browser-rendered home feed and stops at the requested limit or when no additional posts load.
Post output includes the post ID and URL, subreddit, author, title and text, creation time, outbound content URL, score, comment count, and content labels when Reddit exposes them.

Read a Reddit profile by username or profile URL:

```bash
agent-browser-app reddit profile spez
agent-browser-app reddit profile u/spez
agent-browser-app reddit profile https://www.reddit.com/user/spez/ --json
```

Profile URLs from the current, old, new, mobile, and non-participation Reddit hosts are accepted and normalized to `www.reddit.com`.
Profile output includes the account ID when exposed, username, display name, bio, creation time, available karma counts, follower count, and public admin or moderator labels.

The former `--headed` option remains accepted for compatibility but is no longer required.
Use `--json` for machine-readable output.

Reddit workflows stay browser-driven.
The adapter reads semantic HTML, custom-element attributes, accessibility labels, and visible client-side elements from the rendered page.
It does not call private Reddit APIs.

## Development

```bash
bun run verify
```

Build a standalone release archive locally:

```bash
sh scripts/build-release.sh v0.1.0 bun-darwin-arm64 dist
```

## Release channels

GitHub Actions publishes releases from two source branches:

- `main` publishes the stable LTS tag matching the version in `package.json`.
- `preview` publishes a prerelease tag using the package version and the workflow run number.

Bump `package.json` before the next LTS release because stable tags are immutable.
Every release contains standalone archives and SHA-256 checksum files for macOS and Linux on Intel and ARM.

## Migration verification

`tests/browser.test.ts` uses real Chrome with temporary isolated profiles and local fixture pages.
It covers cross-origin frames, file uploads, persistent profiles, storage-state import and export, and native system Chrome CDP attachment.
CLI tests use a Bun preload that mocks the browser-session boundary.
Their legacy fixture adapter is test-only and does not verify Playwright itself.
Compiled-release tests install an archive, run outside the repository through symlink aliases, and verify browser launch, interaction, storage, and CDP attachment.
CI installs managed Chromium for these checks.

Live checks used isolated copies of the user's saved accounts.
NotebookLM and Reddit results, cleanup, and remaining coverage limits are recorded in [migration verification](docs/playwright-migration-verification.md).
X native login, feed, and profile checks passed after fixing route-dependent authentication detection and native credential-store compatibility.
The tests also cover an authenticated X page with a remaining sign-in dialog and a separate login tab.
The following commands are manual checks, not a list of completed live tests:

```bash
aba gnb auth login
aba gnb auth list
aba gnb notebook list
aba gnb notebook ask "question" --id "notebook-id-or-url"
aba x auth login
aba x auth list
aba x feed --limit 5
aba x profile OpenAI
aba reddit auth login
aba reddit auth list
aba reddit feed --limit 5
aba reddit profile spez
```

Gemini Notebook, X, and Reddit are external applications without public browser-automation contracts.
The adapters favor semantic metadata, accessibility labels, and URL semantics, then fall back to known component selectors.
If an interface changes, inspect the visible browser and update the scripts under the corresponding `src/apps/<app>/` directory.
