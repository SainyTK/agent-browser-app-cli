---
name: aba-gemini-notebook
description: Use the authenticated agent-browser-app CLI to interact with Gemini Notebook or NotebookLM, including signing in, selecting accounts, listing, creating, reading, querying, or removing notebooks, and listing, adding, uploading, or removing notebook sources. Use whenever a user asks to work with Gemini Notebook, NotebookLM, a notebook URL or ID, notebook sources, or answers grounded in a notebook.
---

# ABA Gemini Notebook

Use `aba gnb` for browser-driven Gemini Notebook operations.
Run the requested operation when the user wants an action performed.
Only explain commands without running them when the user asks for instructions.

## Operating rules

- Run `aba --version` before the first operation to confirm that the CLI is installed.
- Use `aba --help` as the source of truth if a command or option is uncertain.
- Use `--json` whenever results will be filtered, compared, summarized, or passed to another command.
- Use the active account unless the user identifies another account.
- Run `aba gnb auth list --json` before choosing among multiple accounts, then pass `--account <email-or-id>` explicitly.
- Never read or print browser profiles, cookies, local storage, `accounts.json`, `state.json`, passwords, or tokens.
- Keep all application behavior browser-driven through `aba`.
- Do not replace a missing command with a private Google API or a reverse-engineered endpoint.
- If the CLI reports a changed interface or selector failure, retry the same operation once with `--headed` and inspect only the visible browser behavior.
- Report the completed action and relevant public result without exposing authentication paths or private browser state.

## Authentication

List configured accounts first:

```bash
aba gnb auth list --json
```

If no suitable account exists, start login:

```bash
aba gnb auth login
```

Use a known email to add or refresh a specific account:

```bash
aba gnb auth login --account "you@example.com"
```

Login opens a visible browser and may require the user to choose an account, provide a passkey, or complete two-factor authentication.
Allow the command to continue until it confirms that authentication was saved.
Select the default account when requested:

```bash
aba gnb auth switch "email-or-account-id"
```

## Notebook operations

List notebooks before resolving a title to an ID:

```bash
aba gnb notebook list --json
```

Create a notebook:

```bash
aba gnb notebook create --json
```

Read visible notebook metadata, sources, and summary:

```bash
aba gnb notebook read "notebook-id-or-url" --json
```

Ask a grounded question:

```bash
aba gnb notebook ask "Question to answer" \
  --id "notebook-id-or-url" \
  --json
```

Use `--timeout <seconds>` when the default two-minute answer wait is insufficient.
Treat the returned answer as notebook-generated content and preserve any uncertainty it expresses.

Remove notebooks only when the user's request clearly authorizes permanent removal:

```bash
aba gnb notebook remove "notebook-id-1" "notebook-id-2" --json
```

Resolve titles to current IDs before removal.
The CLI validates all requested IDs before deleting any notebook.

## Source operations

List sources immediately before referring to source IDs:

```bash
aba gnb notebook source list \
  --id "notebook-id-or-url" \
  --json
```

Source IDs reflect the current displayed order and can change after sorting, adding, or removing sources.

Add one copied-text source:

```bash
aba gnb notebook source add-text \
  "Text content to use as a source." \
  --id "notebook-id-or-url" \
  --json
```

Add unique HTTP or HTTPS URLs:

```bash
aba gnb notebook source add-urls \
  "https://example.com/source-one" \
  "https://example.com/source-two" \
  --id "notebook-id-or-url" \
  --json
```

Add a Google Drive item by exact displayed name or Drive URL:

```bash
aba gnb notebook source add-drive \
  "Drive item name or URL" \
  --id "notebook-id-or-url" \
  --json
```

Use a Drive URL when multiple items have the same displayed name.

Upload one or more readable local files:

```bash
aba gnb notebook source upload-files \
  "/absolute/path/source-a.pdf" \
  "/absolute/path/source-b.m4a" \
  --id "notebook-id-or-url" \
  --json
```

Use absolute paths and ensure files in one call have unique filenames.
Source-add commands wait for Gemini Notebook to finish processing and default to a 30-minute timeout.
Increase `--timeout <seconds>` only when processing legitimately needs longer.

Remove sources only after obtaining their current IDs and when the user's request authorizes removal:

```bash
aba gnb notebook source remove \
  "source-id-1" \
  "source-id-2" \
  --id "notebook-id-or-url" \
  --json
```

## Capability boundary

Use only commands shown by `aba --help`.
If the user requests an unsupported Gemini Notebook action, confirm that it is absent from current help, state the limitation plainly, and offer the closest supported operation.

## Active development

ABA CLI is under active development.
Open a GitHub issue in the [Agent Browser App CLI repository](https://github.com/SainyTK/agent-browser-app-cli) to report bugs or request new features.
