# backfill-release-notes.js

A Node.js helper script that retroactively generates categorized release notes for GitHub releases based on conventional commits between tags.

## Features

- **Conventional commit categorization** (default) — fetches commits via the Compare API, parses prefixes (`feat:`, `fix:`, `chore:`, etc.), and produces categorized markdown with sections for Breaking Changes, New Features, Bug Fixes, Improvements, Documentation, and Other Changes.
- **GitHub fallback mode** — `--mode=github` uses the `POST /repos/{owner}/{repo}/releases/generate-notes` API for GitHub's auto-generated notes (flat PR list).
- **Force overwrite** — `--force` overwrites releases that already have notes (useful for migrating from GitHub auto-format to conventional-commit format).
- **Author filtering** — `--exclude-authors=bot1,bot2` skips commits from specified authors (e.g. service users, bots).
- **Release name normalization** — sets the release name to the clean tag name (e.g. `v1.2.3`) when updating. Use `--rename-only` to fix names without changing notes.
- **Tag filtering** — skip releases matching a configurable tag prefix (default: `helm-`).
- **Dry-run by default** — previews what would be updated; requires `--apply` to modify releases.
- **Verbose mode** — `--verbose` shows full generated notes and lists releases that already have notes.
- **GHES support** — set `GH_HOST` to target a GitHub Enterprise Server instance.
- **Idempotent** — skips releases that already have notes (unless `--force` is used); safe to re-run.

## Prerequisites

| Requirement | Details |
|---|---|
| **Node.js** | v18 or later |
| **GitHub CLI (`gh`)** | Must be installed and authenticated (`gh auth login`). For GHES, ensure your token has `repo` scope. |

## Usage

```bash
node backfill-release-notes.js <owner/repo> [flags]
```

| Argument | Required | Description |
|---|---|---|
| `owner/repo` | Yes | Repository in `owner/repo` format |
| `--apply` | No | Update releases (default: dry-run preview only) |
| `--force` | No | Overwrite releases that already have notes |
| `--rename-only` | No | Only rename releases to match their tag name (no notes changes) |
| `--verbose`, `-v` | No | Show full release notes and list releases that already have notes |
| `--exclude-prefix` | No | Tag prefix to skip (default: `helm-`) |
| `--exclude-authors` | No | Comma-separated commit author names to skip |
| `--mode` | No | Note generation engine: `conventional` (default) or `github` |

### Environment variables

| Variable | Required | Description |
|---|---|---|
| `GH_HOST` | For GHES | GHES hostname (e.g. `github.tools.sap`). Omit for `github.com`. |

## Examples

Dry-run preview (default — conventional commit mode):

```bash
GH_HOST=github.tools.sap node backfill-release-notes.js cs-devops/flux-notification-receiver
```

Apply changes to releases:

```bash
GH_HOST=github.tools.sap node backfill-release-notes.js cs-devops/flux-notification-receiver --apply
```

Force overwrite all releases with categorized notes:

```bash
node backfill-release-notes.js SAP/clustersecret-operator --force --apply
```

Exclude bot authors:

```bash
node backfill-release-notes.js SAP/clustersecret-operator --exclude-authors="renovate[bot],dependabot[bot]" --apply
```

Use GitHub's auto-generated notes instead of conventional commits:

```bash
node backfill-release-notes.js owner/repo --mode=github --apply
```

Custom exclude prefix:

```bash
GH_HOST=github.tools.sap node backfill-release-notes.js cs-devops/flux-notification-receiver --exclude-prefix=chart-
```

Verbose dry-run (shows full generated notes and lists existing ones):

```bash
node backfill-release-notes.js SAP/clustersecret-operator --verbose
```

Rename releases to match their tag name:

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

### Sample output

```
Repository:        SAP/clustersecret-operator
Exclude prefix:    helm-*
Notes engine:      conventional
Mode:              DRY-RUN (preview only)

Fetching releases...
  Found 74 release(s) total
  Excluded 0 release(s) matching "helm-*"
  74 release(s) already have notes
  0 release(s) need notes

Nothing to do.
```

With `--force --verbose`:

```
  [dry-run]  would update v0.3.2 (prev: v0.3.1)

## What's Changed

### 🐛 Bug Fixes
- update node.js to v20 (#9) (08e1b7a)
- update module github.com/google/uuid to v1.3.1 (e707a84)

### 🔧 Improvements
- update actions/upload-pages-artifact action to v2 (#8) (0742b2f)
- update golang docker tag to v1.21.0 (#11) (19bfc02)
- update actions/checkout action to v4 (#14) (680aaf6)

### Other Changes
- update website (b45e44c)
- add renovate.json (2771f69)

**Full Changelog**: https://github.com/SAP/clustersecret-operator/compare/v0.3.1...v0.3.2
```

## How it works

### Default mode (conventional commits)

1. Fetches all releases for the repository via `gh api --paginate`.
2. Filters out releases whose tag name starts with the exclude prefix.
3. Sorts remaining releases by `created_at` (oldest first).
4. For each release that needs notes (empty body, or all releases with `--force`):
   - Determines the previous tag from the chronologically sorted list.
   - Fetches commits between the two tags via the Compare API.
   - Filters out merge commits, version bumps, and excluded authors.
   - Categorizes each commit by its conventional prefix into sections.
   - Builds categorized markdown with emoji headers and a full changelog link.
   - In dry-run mode: prints a preview. In apply mode: PATCHes the release.
5. Prints a summary of totals, updates, and failures.

### GitHub mode (`--mode=github`)

Same flow, but step 4 calls GitHub's `generate-notes` API instead of parsing commits locally. Produces GitHub's standard auto-generated format (flat PR list with author attribution).

### Rename-only mode (`--rename-only`)

1. Fetches and filters releases as above.
2. Identifies releases whose name doesn't match their tag name (including `null` names).
3. In dry-run mode: lists what would be renamed.
4. In apply mode: PATCHes the release name to match the tag.

## Conventional commit categories

| Prefix | Section |
|---|---|
| `feat!:`, `fix!:`, `<type>!:` | ⚠️ Breaking Changes |
| `feat:` | 🚀 New Features |
| `fix:` | 🐛 Bug Fixes |
| `perf:`, `refactor:`, `chore:`, `ci:`, `build:`, `style:`, `test:`, `revert:` | 🔧 Improvements |
| `docs:` | 📄 Documentation |
| Everything else | Other Changes |

## API endpoints used

| Endpoint | Method | Purpose |
|---|---|---|
| `repos/{owner}/{repo}/releases` | GET | Fetch all releases (paginated) |
| `repos/{owner}/{repo}/compare/{base}...{head}` | GET | Fetch commits between tags (conventional mode) |
| `repos/{owner}/{repo}/releases/generate-notes` | POST | Generate notes via GitHub API (github mode) |
| `repos/{owner}/{repo}/releases/{id}` | PATCH | Update release name and/or body |

## Edge cases

| Case | Handling |
|---|---|
| First release (no predecessor) | Outputs `## Initial Release {tag}` |
| Zero relevant commits after filtering | Outputs `Release {tag} -- no notable changes since {prevTag}` |
| Previous tag not found (404) | Treats as initial release |
| Release body is `null` or whitespace | Treated as empty and eligible for backfill |
| Release name is `null` or differs from tag | Detected by `--rename-only`; displayed as `(no name)` |
| All releases already have notes | Prints "Nothing to do" and exits successfully (unless `--force`) |
| API failure for a single release | Logged as `[FAILED]`, counted in summary, processing continues |
| 100+ releases | Handled by `gh api --paginate` |
