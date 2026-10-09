# NotebookLM authentication fix verification

## Scope

This change fixes false authentication success and browser-state persistence in the local ABA source.
It does not install a new machine-level ABA binary, transfer credentials, change VPS services, or change Slack.
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

An authenticated real notebook list, notebook read, repeated read after browser shutdown, and exported-state restoration remain unverified.
Do not claim that NotebookLM account access or VPS credential portability works based on the fixture tests.
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
These authenticated steps could not be completed during this verification because the Google login did not succeed.
Native accounts use native Chrome/CDP even if a command includes `--headless`.
True headless Playwright coverage and real exported-state portability require separate checks after an authenticated session exists.
