---
name: aba-x
description: Use the authenticated agent-browser-app CLI to interact with X or Twitter, including signing in, listing accounts, reading the home feed, and reading public profile details by username, handle, numeric user ID, or profile URL. Use whenever a user asks to inspect their X or Twitter feed, retrieve posts, look up an X account or profile, or work with an authenticated X session.
---

# ABA X

Use `aba x` for browser-driven X operations.
Run the requested operation when the user wants an action performed.
Only explain commands without running them when the user asks for instructions.

## Operating rules

- Run `aba --version` before the first operation to confirm that the CLI is installed.
- Use `aba --help` as the source of truth if a command or option is uncertain.
- Use `--json` whenever results will be filtered, compared, summarized, or passed to another command.
- Use the active account unless the user identifies another account.
- Run `aba x auth list --json` before choosing among multiple accounts, then pass `--account <handle-or-id>` explicitly.
- Never read or print browser profiles, cookies, local storage, `accounts.json`, `state.json`, passwords, or tokens.
- Keep all X behavior browser-driven through `aba`.
- Do not replace a missing command with a private X API or a reverse-engineered endpoint.
- Preserve `null` values in structured output as unavailable data rather than guessing.
- Report the completed read and relevant public result without exposing authentication paths or private browser state.

## Authentication

List configured accounts first:

```bash
aba x auth list --json
```

If no suitable account exists, start login:

```bash
aba x auth login
```

Use a known handle to add or refresh a specific account:

```bash
aba x auth login --account "@username"
```

Login opens a visible browser and waits for the authenticated X home feed.
Allow the command to continue until it confirms that authentication was saved.
If Google rejects sign-in from software-controlled Chrome, retry with the isolated system-browser flow:

```bash
aba x auth login --account "@username" --system-browser
```

The most recently authenticated account is active.
Select a different configured account per read operation with `--account`.

## Read the home feed

Read posts from the authenticated home feed:

```bash
aba x feed --limit 20 --json
```

Choose the smallest positive integer limit that satisfies the request.
The default is 20.
The browser scrolls until it reaches the limit or no more posts load, so report when fewer posts are returned.
Feed results can include author identity, text, URL, creation time, and available reply, repost, quote, like, and view counts.

Use another configured account explicitly:

```bash
aba x feed \
  --account "handle-or-account-id" \
  --limit 10 \
  --json
```

## Read a profile

Pass a username, handle, numeric user ID, X URL, or Twitter URL:

```bash
aba x profile "OpenAI" --json
aba x profile "@OpenAI" --json
aba x profile "4398626122" --json
aba x profile "https://x.com/OpenAI" --json
```

Twitter URLs are normalized to X.
Numeric user IDs resolve through X's browser profile route.
Profile results can include the numeric ID, display name, username, bio, public profile fields, counts, verification status, and protection status.

## Troubleshooting

Normal feed and profile reads run headless.
If X changes its interface or the CLI reports a selector failure, retry the same command once with `--headed`:

```bash
aba x feed --limit 10 --json --headed
aba x profile "@OpenAI" --json --headed
```

Inspect only the visible page and the CLI error.
Do not inspect stored authentication data.

## Capability boundary

Use only commands shown by `aba --help`.
This adapter currently reads the home feed and profiles.
If the user requests posting, liking, replying, following, direct messaging, search, or another unsupported X action, confirm that it is absent from current help, state the limitation plainly, and offer the closest supported read operation.

## Active development

ABA CLI is under active development.
Open a GitHub issue in the [Agent Browser App CLI repository](https://github.com/SainyTK/agent-browser-app-cli) to report bugs or request new features.
