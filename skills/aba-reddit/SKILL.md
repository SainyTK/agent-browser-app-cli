---
name: aba-reddit
description: Use the authenticated agent-browser-app CLI to interact with Reddit, including signing in, listing accounts, reading the authenticated home feed, and reading public user profiles by username or profile URL. Use whenever a user asks to inspect their Reddit feed, retrieve Reddit posts, look up a Reddit user or profile, or work with an authenticated Reddit session.
---

# ABA Reddit

Use `aba reddit` for browser-driven Reddit operations.
Run the requested operation when the user wants an action performed.
Only explain commands without running them when the user asks for instructions.

## Operating rules

- Run `aba --version` before the first operation to confirm that the CLI is installed.
- Use `aba --help` as the source of truth if a command or option is uncertain.
- Use `--json` whenever results will be filtered, compared, summarized, or passed to another command.
- Use the active account unless the user identifies another account.
- Run `aba reddit auth list --json` before choosing among multiple accounts, then pass `--account <username-or-id>` explicitly.
- Never read or print browser profiles, cookies, local storage, `accounts.json`, `state.json`, passwords, or tokens.
- Keep all Reddit behavior browser-driven through `aba`.
- Do not replace a missing command with a private Reddit API or a reverse-engineered endpoint.
- Preserve `null` values in structured output as unavailable data rather than guessing.
- Report the completed read and relevant public result without exposing authentication paths or private browser state.

## Authentication

List configured accounts first:

```bash
aba reddit auth list --json
```

If no suitable account exists, start login:

```bash
aba reddit auth login
```

Reddit login opens an isolated system Chrome profile by default because Reddit may challenge software-controlled Chrome.
The user does not need to provide a username before signing in.
Allow the command to continue until it detects the authenticated username, saves authentication, and closes the isolated browser.

Use agent-browser login only when system Chrome cannot be launched:

```bash
aba reddit auth login --agent-browser
```

Do not pass `--account` to `reddit auth login`.
The most recently authenticated account is active.
Select a different configured account per read operation with `--account`.

## Read the home feed

Read posts from the authenticated home feed:

```bash
aba reddit feed --limit 20 --json
```

Choose the smallest positive integer limit that satisfies the request.
The default is 20.
The browser scrolls until it reaches the limit or no more posts load, so report when fewer posts are returned.
Feed results can include the post ID and URL, subreddit, author, title, body text, creation time, outbound content URL, score, comment count, and NSFW, spoiler, or promoted labels.
Retain content labels when summarizing or presenting posts.

Use another configured account explicitly:

```bash
aba reddit feed \
  --account "username-or-account-id" \
  --limit 10 \
  --json
```

## Read a profile

Pass a username, `u/username`, or a Reddit user profile URL:

```bash
aba reddit profile "spez" --json
aba reddit profile "u/spez" --json
aba reddit profile "https://www.reddit.com/user/spez/" --json
```

Profile URLs from current, old, new, mobile, and non-participation Reddit hosts are accepted and normalized to `www.reddit.com`.
Subreddit URLs are not profile targets.
Profile results can include the account ID, username, display name, bio, creation time, available karma counts, follower count, and public admin or moderator labels.

## Browser visibility

Feed and profile reads open visible Chrome by default because Reddit commonly challenges headless browsers.
Do not add `--headless` merely for convenience.
Use it only when the current environment is known to accept headless Reddit browsing:

```bash
aba reddit feed --limit 10 --json --headless
aba reddit profile "u/spez" --json --headless
```

The former `--headed` option remains accepted but is unnecessary.

## Capability boundary

Use only commands shown by `aba --help`.
This adapter currently reads the authenticated home feed and user profiles.
If the user requests subreddit browsing, search, posting, voting, commenting, saving, following, moderation, or another unsupported Reddit action, confirm that it is absent from current help, state the limitation plainly, and offer the closest supported read operation.

## Active development

ABA CLI is under active development.
Open a GitHub issue in the [Agent Browser App CLI repository](https://github.com/SainyTK/agent-browser-app-cli) to report bugs or request new features.
