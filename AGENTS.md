# Repository instructions

## Product direction

This repository wraps agent-browser with stable commands for authenticated web applications.
Keep authentication profiles and storage-state files compatible with agent-browser.
Do not replace browser-driven application behavior with private or reverse-engineered APIs.

Gemini Notebook is the first adapter.
Keep application-specific selectors and workflows isolated under `src/apps/<app>/`.

## Engineering workflow

Start bug fixes by reproducing the user-facing command with the real agent-browser CLI.
Use fake-process tests only after the real failure mode is understood.
Validate command help, error output, exit codes, and JSON output.

Run these checks before handing off a change:

```bash
bun run check
bun test
```

Never print cookies, local storage values, passwords, access tokens, or the contents of `state.json`.
Treat every file below `~/.agent-browser/apps/agent-browser-app/` as private user data.

Do not manually edit generated lockfiles.
Use Bun commands to update dependency lockfiles.

## Style

Never use an em dash.
Do not add an agent name as a commit co-author.
Put each full sentence on its own physical line in long Markdown files.
Favor clear control flow, explicit errors, and durable application boundaries over short-term implementation convenience.
