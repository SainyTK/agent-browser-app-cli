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

At that checkpoint, native and headless authenticated reads were genuinely observed, but current durable authentication and real exported-state portability were not established.
The owner subsequently renewed sign-in for the native-only control below.
Do not claim complete NotebookLM readiness or transfer the failed restored state to the VPS.
The owner must complete any required Google password, verification, or consent step.

### Renewed native-only control

The owner renewed login in the same isolated home and reported choosing "continue without profile" in Chrome.
Using source commit `f4f392b`, the control ran only the native Chrome/CDP notebook path.
It did not switch to headless Playwright, copy or restore the session, or export a new snapshot during the checks.

At scheduled offsets of zero, 90, and 300 seconds, each notebook list and known-notebook read exited with code 0.
All three lists returned the same ten notebook IDs from the earlier authenticated list.
All three reads matched the historical notebook's ID, title, and three sources.
Each command closed and reopened Chrome, for six separate command/browser launches.
The final round finished 314.7 seconds after the control started.

This verifies native-only local reads over the tested five-minute interval with the renewed profile.
It does not establish indefinite session lifetime, show that the Chrome prompt choice caused the improvement, or resolve exported-state portability.
Keep this profile on the native Chrome path and avoid further clone/restore experiments until the portability failure has a separately bounded diagnostic plan.
The installed ABA, older user profiles, VPS, and Slack remain unchanged.

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
The first owner-completed login passed these native list/read steps and a separate true headless list/read, but later checks lost authentication.
The renewed native-only control above subsequently passed three list/read rounds over five minutes without cloning its session.
Treat these commands as renewal and bounded persistence checks, not proof that the exported session is portable.
Native accounts use native Chrome/CDP even if a command includes `--headless`.
A fresh-profile restoration is a separate acceptance check, and the real restoration follow-up failed after its first successful list.

## Release 0.4.1 live verification

### Reproduction with installed 0.4.0

Installed 0.4.0 listed notebooks headless for the owner's work account with exit code 0 and an empty array.
A copy of that profile reached `notebook.google.com/trynow` both headless and headed, and Google account pages showed it signed out.
Its Google session cookies were all created on 9 October, so the earlier revoked session was the only one stored.
The 14 October `auth login` had written no new session cookies.
Version 0.4.0 accepted the `/trynow` landing page as the home page, so login saved immediately before any sign-in.
No cookie values were printed.

### Changes in 0.4.1

Release 0.4.1 includes the landing-page and dashboard readiness fixes above.
`gnb auth login` uses native system Chrome by default, and `--playwright` selects the automated window.
Notebook commands always run through Playwright on the account profile with its recorded credential store, so `--headless` no longer opens system Chrome.
A profile lock counts as in use only when it belongs to another host or a running process.
The source list treats a rendered `has-sources` drop zone as loaded when NotebookLM hides the cover and its source count.

### Live results on 19 October 2026

The release was built with `scripts/build-release.sh` and installed with `install.sh` from a local file mirror.
Against the revoked profile, installed 0.4.1 exited with code 1 and "Google authentication is required".
The revoked profile was moved aside, and the owner signed in once through `aba gnb auth login`.
The registry recorded the native credential store.

Installed 0.4.1 then passed these headless commands, each in its own browser launch:

- Notebook list, three times, each returning the same ten notebooks.
- Notebook read of a known notebook with one source, three times, and of an empty notebook once.
- Source list of a healthy notebook and of a notebook whose only source had failed.

A file upload of a synthetic tone reached NotebookLM, which marked the source as failed because it contained no speech.
That run left Chrome's profile lock behind, and the next commands were refused until the lock fix above.
The cause of that unclean exit was not isolated.
After the lock fix, Chrome reclaimed the stale lock and later commands left no lock behind.
Installed 0.4.1 then uploaded a real 56.9 MB, 1 hour 54 minute recording headless with exit code 0 and status `ready` after 146 seconds.
A fresh headless source list showed it as ready, and no profile lock remained.
Session lifetime beyond that day remains unverified.

A second upload of the same recording then printed `ready` while NotebookLM still showed the new copy as processing.
Upload matched new sources by title in list order, but NotebookLM inserts new sources at the top, so the earlier ready copy was reported.
Upload and the add-source commands now share an order-independent title and status comparison that can only delay success or report failure when same-titled rows are ambiguous.
Applied to the live notebook, it identified the second copy as the new, still-processing source.
`bun run check` and `bun test` then passed with 66 tests, including the compiled-release Chrome smoke.
One earlier full run of `tests/browser.test.ts` had a single 30-second test timeout that did not recur in eight later runs.
