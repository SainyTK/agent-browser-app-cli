# Repository instructions

## Product direction

This repository wraps agent-browser with stable commands for authenticated web applications.
Keep authentication profiles and storage-state files compatible with agent-browser.
Do not replace browser-driven application behavior with private or reverse-engineered APIs.

Gemini Notebook is the first adapter.
Keep application-specific selectors and workflows isolated under `src/apps/<app>/`.

## Engineering workflow

### Parallel development with Treehouse

Use Treehouse for features that can be developed independently.
Use one terminal, one Treehouse worktree, and one feature branch per feature.
Treat the branch checked out in the primary repository as the current development branch and integration target.

Before starting parallel work, anchor the development branch in the primary repository:

```bash
git branch --show-current
git rev-parse HEAD
git status --short
```

Record the branch name and commit.
Keep the primary repository checked out on that branch while parallel work is in progress.
Do not begin integration from a dirty primary repository until the existing changes and their ownership are understood.

Open one terminal for each feature.
From the primary repository, run `treehouse` in each terminal to acquire a dedicated worktree and enter its subshell.
Treehouse worktrees begin on a detached HEAD, so create a uniquely named feature branch immediately:

```bash
export DEVELOPMENT_BRANCH="$(git branch --show-current)"
export FEATURE_BRANCH="feat/notebook-sharing"
treehouse
```

Inside the Treehouse subshell, run:

```bash
git switch -c "$FEATURE_BRANCH" "$DEVELOPMENT_BRANCH"
git merge "$DEVELOPMENT_BRANCH"
```

Use a different descriptive `FEATURE_BRANCH` value in every terminal.
Do not assume that Treehouse's initial detached HEAD matches the current development branch.
The feature branch must start from and merge the recorded development branch before implementation begins.
Never develop directly on the detached HEAD.

Implement and test each feature entirely inside its dedicated worktree.
For bug fixes, reproduce the user-facing failure with the real CLI before changing the code.
Run focused checks during iteration, then run the full repository checks before handoff.
When the result can be demonstrated clearly, provide the exact commands, relevant logs, exit codes, and other inspectable evidence.
Never include secrets or private browser state in that evidence.
When verification is too complex to communicate reliably through logs, provide exact manual test steps and the expected observable result.
Keep iterating in the same worktree until the user and agent agree that the feature behaves correctly.

Commit the feature branch before leaving the Treehouse subshell.
Do not return or destroy a worktree that contains uncommitted work or that the user still needs for testing.

Final integration must be serialized because parallel features can advance the development branch while another feature is being verified.
Immediately before integrating a feature, merge the latest development branch into its feature branch again:

```bash
git status --short
git merge "$DEVELOPMENT_BRANCH"
```

Resolve every conflict in the feature worktree.
Preserve the intended behavior from both branches, then rerun the focused tests and the full repository checks.
Confirm that the feature worktree is clean and contains no unresolved conflicts.
If the development branch advances after this verification, repeat the merge, conflict resolution, and testing against the new tip.

After the feature branch is synchronized and verified, merge it into the development branch from the anchored primary repository:

```bash
git switch "$DEVELOPMENT_BRANCH"
git merge "$FEATURE_BRANCH"
```

Run the full repository checks on the merged development branch.
Integrate parallel feature branches one at a time, and require every remaining feature branch to repeat the final synchronization against the newly advanced development branch.
Return the Treehouse worktree only after its feature is safely integrated or intentionally retained on a named branch.

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
