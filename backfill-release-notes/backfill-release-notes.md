# backfill-release-notes.js

A Node.js helper script that retroactively generates release notes for GitHub releases that are missing them, using GitHub's auto-generated release notes API.

## Features

- **Auto-generated notes** — uses the `POST /repos/{owner}/{repo}/releases/generate-notes` API for structured notes with PR links and author attribution.
- **Release name normalization** — sets the release name to the clean tag name (e.g. `v1.2.3`) when updating. Use `--rename-only` to fix names without changing notes.
- **Tag filtering** — skip releases matching a configurable tag prefix (default: `helm-`).
- **Dry-run by default** — previews what would be updated; requires `--apply` to modify releases.
- **Verbose mode** — `--verbose` shows full generated notes and lists releases that already have notes.
- **GHES support** — set `GH_HOST` to target a GitHub Enterprise Server instance (3.6+).
- **Idempotent** — skips releases that already have notes; safe to re-run.

## Prerequisites

| Requirement | Details |
|---|---|
| **Node.js** | v18 or later |
| **GitHub CLI (`gh`)** | Must be installed and authenticated (`gh auth login`). For GHES, ensure your token has `repo` scope. |
| **GHES version** | 3.6+ (the `generate-notes` endpoint was added in GHES 3.6) |

## Usage

```bash
node backfill-release-notes.js <owner/repo> [--apply] [--rename-only] [--verbose] [--exclude-prefix=helm-]
```

| Argument | Required | Description |
|---|---|---|
| `owner/repo` | Yes | Repository in `owner/repo` format |
| `--apply` | No | Update releases (default: dry-run preview only) |
| `--rename-only` | No | Only rename releases to match their tag name (no notes changes) |
| `--verbose`, `-v` | No | Show full release notes and list releases that already have notes |
| `--exclude-prefix` | No | Tag prefix to skip (default: `helm-`) |

### Environment variables

| Variable | Required | Description |
|---|---|---|
| `GH_HOST` | For GHES | GHES hostname (e.g. `github.tools.sap`). Omit for `github.com`. |

## Examples

Dry-run preview (default):

```bash
GH_HOST=github.tools.sap node backfill-release-notes.js cs-devops/flux-notification-receiver
```

Apply changes to releases:

```bash
GH_HOST=github.tools.sap node backfill-release-notes.js cs-devops/flux-notification-receiver --apply
```

Custom exclude prefix:

```bash
GH_HOST=github.tools.sap node backfill-release-notes.js cs-devops/flux-notification-receiver --exclude-prefix=chart-
```

Verbose dry-run (shows full generated notes and lists existing ones):

```bash
node backfill-release-notes.js SAP/clustersecret-operator --verbose
```

Rename releases to match their tag name (dry-run):

```bash
node backfill-release-notes.js SAP/clustersecret-operator --rename-only
```

Rename releases (apply):

```bash
node backfill-release-notes.js SAP/clustersecret-operator --rename-only --apply
```

### Batch usage (shell composition)

The script processes one repo at a time. Use shell loops for batch operations:

Backfill a list of repos:

```bash
for repo in cs-devops/flux-notification-receiver cs-devops/other-repo; do
  GH_HOST=github.tools.sap node backfill-release-notes.js "$repo" --apply
done
```

Backfill all repos in a GHES org:

```bash
GH_HOST=github.tools.sap gh api "orgs/cs-devops/repos" --paginate -q '.[].full_name' \
  | while read -r repo; do
      node backfill-release-notes.js "$repo" --apply
    done
```

Dry-run across an org on `github.com`:

```bash
gh api "orgs/my-org/repos" --paginate -q '.[].full_name' \
  | while read -r repo; do
      node backfill-release-notes.js "$repo"
    done
```

### Sample output

```
Repository:      cs-devops/flux-notification-receiver (github.tools.sap)
Exclude prefix:  helm-*
Mode:            DRY-RUN (preview only)

Fetching releases...
  Found 24 release(s) total
  Excluded 8 release(s) matching "helm-*"
  12 release(s) already have notes
  4 release(s) need notes

  [dry-run]  would update v1.0.0 (first release)
             preview: ## What's Changed...
  [dry-run]  would update v1.1.0 (prev: v1.0.0)
             preview: ## What's Changed...
  [dry-run]  would update v1.2.0 (prev: v1.1.0)
             preview: ## What's Changed...
  [dry-run]  would update v2.0.0 (prev: v1.2.0)
             preview: ## What's Changed...

--- Summary ---
  Total releases:      24
  Excluded (filtered): 8
  Already have notes:  12
  Would update:        4
  Failed:              0

This was a dry run. Re-run with --apply to update releases.
```

## How it works

### Default mode (backfill notes)

1. Fetches all releases for the repository via `gh api --paginate`.
2. Filters out releases whose tag name starts with the exclude prefix.
3. Sorts remaining releases by `created_at` (oldest first).
4. For each release with an empty body:
   - Determines the previous tag from the chronologically sorted list.
   - Calls GitHub's `generate-notes` API with the current and previous tag.
   - In dry-run mode: prints a preview of the generated notes (full notes with `--verbose`).
   - In apply mode: PATCHes the release name (set to the tag) and body (generated notes).
5. Prints a summary of totals, updates, and failures.

### Rename-only mode (`--rename-only`)

1. Fetches and filters releases as above.
2. Identifies releases whose name doesn't match their tag name (including `null` names).
3. In dry-run mode: lists what would be renamed.
4. In apply mode: PATCHes the release name to match the tag.

## API endpoints used

| Endpoint | Method | Purpose |
|---|---|---|
| `repos/{owner}/{repo}/releases` | GET | Fetch all releases (paginated) |
| `repos/{owner}/{repo}/releases/generate-notes` | POST | Generate release notes between two tags |
| `repos/{owner}/{repo}/releases/{id}` | PATCH | Update release name and/or body |

## Edge cases

| Case | Handling |
|---|---|
| First release (no predecessor) | `previous_tag_name` is omitted; API generates notes from repo start |
| Release body is `null` or whitespace | Treated as empty and eligible for backfill |
| Release name is `null` or differs from tag | Detected by `--rename-only`; displayed as `(no name)` |
| All releases already have notes | Prints "Nothing to do" and exits successfully |
| No releases / all excluded | Clean summary, exits 0 |
| API failure for a single release | Logged as `[FAILED]`, counted in summary, processing continues |
| 100+ releases | Handled by `gh api --paginate` |
