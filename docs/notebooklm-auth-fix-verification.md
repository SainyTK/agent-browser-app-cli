# NotebookLM authentication fix verification

## Scope

This change fixes false authentication success and browser-state persistence in the local ABA source.
It does not install a new machine-level ABA binary, transfer credentials to the VPS, change VPS services, or change Slack.
The independent ABA repository remains excluded from SuperU Git history.

## Reproduction

At baseline commit `aced658ab73e0a378b55fff1727908656bd7dcbf`, the real source CLI listed notebooks for an isolated synthetic account with empty exported state.
Google redirected the browser to `https://notebook.google.com/trynow`.
The command nevertheless exited with code 0 and returned an empty notebook array.
This was an authentication-detection failure, not evidence of an empty account.

With the fix, the same real CLI and isolated account exit with code 1, produce no JSON success output, and report that Google authentication is required.
A final real-source read of a synthetic notebook ID also exits with code 1 and the same authentication error.
Both final success-output files contain zero bytes.
No private cookies or tokens were used for this reproduction.

## Changes

Login now requires a recognized HTTPS app URL and a visible, recognized dashboard control before it saves authentication.
Known landing and sign-in paths do not qualify.
Notebook listing fails when authentication is required or dashboard readiness times out.
A recognized empty dashboard can still return an empty list.
Native login checks all eligible tabs rather than allowing a loading first tab to hide a ready second tab.
Login retries a browser evaluation interrupted by navigation and checks readiness again before saving.

Chrome now restores its own current session across restarts.
ABA still imports exported state only into a fresh profile.
It does not overwrite a populated profile with stale exported cookies or reverse an intentional sign-out.
Owned browser contexts retain one operation tab to avoid accumulating restored startup tabs.
New snapshots include IndexedDB and origin private file system data in addition to cookies and local storage.
Snapshots do not export session storage or hardware-backed credentials.

These mechanics do not prove which storage limitation caused Google to reject the owner's previous session.
A service may also reject exported credentials on another device.

## Automated checks

Run from the ABA repository:

```sh
bun install --frozen-lockfile
bun run check
bun test
```

The final corrected worktree run passed TypeScript checking and all 58 tests across six files, with 570 assertions and no failures.
The compiled Chrome smoke passed every reported check.

The regression coverage includes:

- Real Chrome session-cookie persistence across three restarts.
- Deliberately cleared cookies remaining absent even when an older snapshot still contains them.
- IndexedDB and actual OPFS file restoration into a fresh profile and persistence on its next restart.
- Native Chrome session-cookie reuse through the native credential store.
- Real Chrome DOM evaluation on intercepted fixture pages for landing, empty dashboard, and hidden loading controls.
- Mocked CLI failures for landing pages and never-ready dashboards, including exit codes and unchanged authentication metadata.
- Mocked CLI success for an authenticated empty dashboard, interrupted navigation, and a ready second native tab.
- A compiled release running outside the repository with session-cookie persistence, IndexedDB restoration, and native WebSocket CDP attachment.

The initial full run caught missing required fake-browser environment values in the new multi-tab test.
The fixture configuration was corrected in both new native-login tests.
The native landing test now also requires the expected authentication timeout message so a fixture-startup error cannot pass it.
Both focused native tests passed after that correction.

## Real Google account status

A headed native Google login was attempted in a separate private profile.
It timed out after 540 seconds without reaching an authenticated dashboard.
A subsequent real headless probe of that same profile reached `notebook.google.com/trynow`, found no ready dashboard, and detected no account email.
This supports the reported signed-out state rather than a dashboard-selector failure in an authenticated profile.
It does not establish whether anyone completed the interactive Google sign-in.

### Owner-completed login follow-up

The owner subsequently completed sign-in using the fixed source in another isolated private home.
At source commit `ace10a8`, two native notebook-list commands each returned the same ten notebooks.
Two native reads of a known notebook matched its historical title and three sources.
Each command closed and reopened Chrome.
A separate test registry selected the same owned profile with the native credential store and `useSystemBrowser: false`.
Its true headless Playwright list and known-notebook read also passed.
No canonical registry or older user profile was replaced.

A successful headless raw command then captured current expanded state only after checking dashboard readiness.
That state was copied into one fresh local profile, not an entire Chrome profile.
The first restored headless list returned the expected ten notebooks.
The next command, a known-notebook read after browser shutdown, exited with code 1 and required Google authentication.
This fails the fresh-profile persistence acceptance check.

Subsequent checks of the original newly authenticated profile also failed.
Its headless list required authentication, and its native list timed out without a ready dashboard.
These failures followed the restoration attempt, but the sequence alone does not prove that restoration caused them.

A privacy-preserving cookie comparison found all 49 exported cookies still present with unchanged values in the original profile.
None had expired, and the snapshot contained no session cookies.
The restored profile contained 32 cookies, with 17 exported cookies absent and 30 unchanged exported values.
No cookie values were printed.
Thus simple disappearance or time expiry of exported cookies does not explain the original profile's failure.
The precise Google session-rejection mechanism remains unknown.

Native and headless authenticated reads were genuinely observed, but current durable authentication and real exported-state portability are not established.
Do not claim complete NotebookLM readiness or transfer this state to the VPS.
Stop further restoration attempts until the owner renews sign-in and the original profile passes a longer native-only repeat check without cloning its session.
The owner must complete any required Google password, verification, or consent step.

## Complete the authenticated local check

Run these commands from the independent ABA repository in one shell.
They use the source CLI and a new private home rather than the installed ABA or the existing account registry.
Do not use another browser command against the same profile while login is running.

```sh
umask 077
export AGENT_BROWSER_HOME="$(mktemp -d "${TMPDIR:-/tmp}/aba-notebook-local.XXXXXX")"
printf 'Google account email: '
read -r NOTEBOOK_ACCOUNT
case "$NOTEBOOK_ACCOUNT" in
  *@*) ;;
  *) printf 'An account email is required.\n' >&2; exit 2 ;;
esac
bun src/cli.ts gnb auth login --account "$NOTEBOOK_ACCOUNT" --system-browser --timeout 540
```

Complete Google sign-in in the isolated Chrome window.
A successful command must say authentication was saved and close the owned browser.
If it times out or remains on `/trynow`, stop rather than treating the profile as authenticated.

After a successful login, run:

```sh
bun src/cli.ts gnb notebook list --account "$NOTEBOOK_ACCOUNT" --json > "$AGENT_BROWSER_HOME/notebooks-first.json"
bun src/cli.ts gnb notebook list --account "$NOTEBOOK_ACCOUNT" --json > "$AGENT_BROWSER_HOME/notebooks-second.json"
```

Each command opens and closes its own browser session.
Both must exit with code 0 and list the expected account's known notebooks.
An empty list is valid only if the visible authenticated account really has no notebooks.
For an account with notebooks, obtain a known ID from the private list output and run:

```sh
printf 'Known notebook ID from the list: '
read -r NOTEBOOK_ID
if [ -z "$NOTEBOOK_ID" ]; then
  printf 'A notebook ID is required.\n' >&2
  exit 2
fi
bun src/cli.ts gnb notebook read "$NOTEBOOK_ID" --account "$NOTEBOOK_ACCOUNT" --json > "$AGENT_BROWSER_HOME/notebook-first.json"
bun src/cli.ts gnb notebook read "$NOTEBOOK_ID" --account "$NOTEBOOK_ACCOUNT" --json > "$AGENT_BROWSER_HOME/notebook-second.json"
```

Inspect both private outputs and verify the known notebook identity and expected source metadata.
Do not publish the files or the browser home.
The owner-completed login follow-up above passed these native list/read steps and a separate true headless list/read, but later checks lost authentication.
Treat these commands as renewal and persistence checks, not proof that the exported session is portable.
Native accounts use native Chrome/CDP even if a command includes `--headless`.
A fresh-profile restoration is a separate acceptance check, and the real restoration follow-up failed after its first successful list.
