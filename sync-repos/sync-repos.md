# sync-repos.js

A Node.js helper script that keeps all git repositories under a folder in sync with their remote, without losing any local work.

## Features

- **Auto-detects default branch** — works with both `main` and `master`.
- **Preserves uncommitted work** — stashes dirty working trees before syncing and restores them afterward.
- **Non-destructive conflict handling** — merge and stash conflicts are aborted cleanly; no work is ever lost.
- **Branch-aware** — returns you to the branch you were on before the sync.
- **Idempotent** — safe to run as often as you like.

## Prerequisites

| Requirement | Details |
|---|---|
| **Node.js** | v18 or later |
| **Git** | Must be available on `PATH` |

## Usage

```bash
node sync-repos.js [repos-dir]
```

| Argument | Required | Description |
|---|---|---|
| `repos-dir` | No | Folder containing the repositories (default: `./repos`) |

## Examples

```bash
node sync-repos.js ~/ghtools/erp4sme
node sync-repos.js ~/ghtools/cs-actions
```

### Sample output

```
Syncing 3 repos in /Users/me/ghtools/erp4sme

repo-alpha/
  [info] on branch: feature/login
  [stash] saving uncommitted changes
  [pull] main updated
  [merge] main merged into feature/login
  [stash] restored uncommitted changes

repo-beta/
  [info] on branch: main
  [pull] main updated

repo-gamma/
  [info] on branch: fix/header
  [pull] main updated
  [WARN] merge conflict — aborting merge to keep branch clean

--- Summary ---
  Synced:          2
  Skipped:         0
  Pull failed:     0
  Merge conflict:  1
  Stash conflict:  0
```

## Sync workflow per repo

```
┌─ Detect current branch & default branch (main/master)
│
├─ Uncommitted changes? ──yes──▶ git stash push -u
│
├─ Checkout default branch
│  └─ git pull --ff-only
│     └─ ff fails? ──▶ git pull --rebase
│        └─ rebase fails? ──▶ abort rebase, report "pull-failed"
│
├─ Checkout back to original branch
│  └─ git merge <default-branch> --no-edit
│     └─ conflict? ──▶ abort merge, report "merge-conflict"
│
├─ Stashed earlier? ──yes──▶ git stash pop
│  └─ conflict? ──▶ abort, changes stay in stash, report "stash-conflict"
│
└─ Safety check: ensure we're back on the original branch
```

## Conflict handling

The script never leaves a repo in a broken state. Here is what happens when conflicts arise:

| Scenario | What happens | Your action |
|---|---|---|
| **Pull fails** | Rebase is aborted; default branch stays at its previous state | `cd <repo> && git pull` manually |
| **Merge conflict** | Merge is aborted; your branch is untouched | `cd <repo> && git merge main` and resolve manually |
| **Stash pop conflict** | Working tree is reset; changes remain in the stash | `cd <repo> && git stash pop` and resolve manually |

## Summary statuses

| Status | Meaning |
|---|---|
| `synced` | Default branch pulled and merged into the working branch successfully |
| `skipped` | Not a git repo, no default branch found, or cannot determine current branch |
| `pull-failed` | Could not pull the default branch from remote |
| `merge-conflict` | Default branch could not be merged into the current branch cleanly |
| `stash-conflict` | Stashed changes could not be re-applied cleanly (still saved in stash) |
