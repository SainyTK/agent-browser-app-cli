# agent-browser-app

`agent-browser-app` provides small, stable commands for authenticated web applications.
It delegates browser work to [agent-browser](https://github.com/vercel-labs/agent-browser) and keeps the underlying browser available for inspection when authentication requires a real user.

The first application adapter is Gemini Notebook, formerly NotebookLM.
The accepted application names are `gnb`, `gemini-notebook`, and `notebooklm`.

## Why this exists

Google and social applications can reject automation that arrives with a fresh browser identity.
A profile directory preserves the browser fingerprint, cache, IndexedDB, service workers, and persistent cookies.
A separate storage-state file preserves cookies and web storage that may otherwise disappear between browser restarts.

This CLI always uses both:

```text
~/.agent-browser/apps/agent-browser-app/gnb/
|-- accounts.json
`-- accounts/
    `-- default/
        |-- browser-profile/
        `-- state.json
```

The files remain compatible with agent-browser because the wrapper invokes its native `--profile`, `state load`, and `state save` interfaces.
Treat `state.json` as a secret because it contains authenticated session material.

## Requirements

- Bun 1.3 or newer
- agent-browser 0.26 or newer
- A locally available Chrome browser installed through agent-browser

agent-browser 0.26 fixed state loading in its native runtime.
The current development baseline is agent-browser 0.27.1.

## Install for local development

```bash
bun install
bun link
```

Verify both commands are available:

```bash
agent-browser --version
agent-browser-app --version
```

## Authenticate

Start a headed Chrome session and complete Google sign-in:

```bash
agent-browser-app gnb auth login
```

The CLI waits for the browser to return to Gemini Notebook, saves `state.json`, and records the detected account email when the page exposes it.

To add or refresh a specific account:

```bash
agent-browser-app gnb auth login --account you@example.com
```

List accounts and select the default account:

```bash
agent-browser-app gnb auth list
agent-browser-app gnb auth switch you@example.com
```

Account selectors accept an email address or the ID displayed by `auth list`.
Notebook commands also accept `--account <email-or-id>`.

## Gemini Notebook commands

List notebooks visible to the active account:

```bash
agent-browser-app gnb notebook list
agent-browser-app gnb notebook list --account you@example.com
```

Create an empty notebook and print its URL:

```bash
agent-browser-app gnb notebook create
```

Remove one or more notebooks by ID:

```bash
agent-browser-app gnb notebook remove notebook-id-1 notebook-id-2
```

The command validates every requested ID before it removes any notebook.
Notebook removal is permanent.

Read visible notebook metadata:

```bash
agent-browser-app gnb notebook read <notebook-id-or-url>
```

Ask a notebook a question:

```bash
agent-browser-app gnb notebook ask "What are the main findings?" \
  --id "notebook-id-or-url"
```

Use `--timeout <seconds>` to override the answer wait.

Upload a local file as a source:

```bash
agent-browser-app gnb notebook upload "/path/to/source.m4a" \
  --id "notebook-id-or-url"
```

The command stays open until the newly added source is ready for queries.
Use `--timeout <seconds>` to override the 30-minute processing timeout.

List sources and their current IDs:

```bash
agent-browser-app gnb notebook source list \
  --id "notebook-id-or-url"
```

Remove one or more sources:

```bash
agent-browser-app gnb notebook source remove source-2 source-4 \
  --id "notebook-id-or-url"
```

Source IDs describe the current displayed order.
Run `source list` immediately before removal because IDs can change after sorting, adding, or removing sources.
The command validates every requested ID before it removes any source.

Use `--headed` on a notebook command when debugging a UI change.
Use `--json` for machine-readable output.

## Authentication behavior

Login runs in headed mode because Google may require manual account selection, passkeys, or two-factor authentication.
Normal notebook operations run headless by default.
Authenticated operations launch the persistent profile without navigating, load `state.json` into the running session, and then open Gemini Notebook.
Only `auth login` writes `state.json`.
Normal notebook operations treat the known-good login state as read-only so a short-lived runtime session cannot overwrite it.

The wrapper never reads or prints cookie values.
It only stores account metadata in `accounts.json`.

## Development

```bash
bun run verify
```

Tests run the complete CLI process against a deterministic fake agent-browser binary.
Real authenticated verification still requires a user-controlled Google login:

```bash
agent-browser-app gnb auth login
agent-browser-app gnb auth list
agent-browser-app gnb notebook list
agent-browser-app gnb notebook ask "question" --id "notebook-id-or-url"
```

Gemini Notebook is an external application without a public browser-automation contract.
The adapter favors accessibility labels and URL semantics, then falls back to known component selectors.
If Google changes the interface, rerun the failed command with `--headed` and update the selectors in `src/apps/gnb/browser-scripts.ts`.
