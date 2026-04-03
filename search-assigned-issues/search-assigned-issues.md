# search-assigned-issues.js

A Node.js helper script that searches for open issues assigned to a user across all repositories in a GitHub organization, filtering out issues marked as done, completed, or archived.

## Features

- **Org-wide search** — searches across all repos in an organization using the GitHub search API.
- **Auto-detect user** — defaults to the currently authenticated `gh` user if no assignee is specified.
- **Label exclusion** — filters out issues with configurable labels (default: `done`, `completed`, `archived`).
- **Grouped output** — results are grouped by repository for easy scanning.
- **Markdown export** — `--output` writes results to a `.md` file with clickable issue links for personal tracking.
- **GHES support** — set `GH_HOST` to target a GitHub Enterprise Server instance.

## Prerequisites

| Requirement | Details |
|---|---|
| **Node.js** | v18 or later |
| **GitHub CLI (`gh`)** | Must be installed and authenticated (`gh auth login`). Token needs `repo` scope. |

## Usage

```bash
node search-assigned-issues.js <org> [assignee] [--exclude-label=done,completed,archived] [--output]
```

| Argument | Required | Description |
|---|---|---|
| `org` | Yes | GitHub organization name |
| `assignee` | No | GitHub username (default: current `gh` user) |
| `--exclude-label` | No | Comma-separated labels to exclude (default: `done,completed,archived`) |
| `--output`, `-o` | No | Write results to a markdown file (default: `assigned-issues.md`). Use `--output=FILE` for a custom path. |

### Environment variables

| Variable | Required | Description |
|---|---|---|
| `GH_HOST` | For GHES | GHES hostname (e.g. `github.tools.sap`). Omit for `github.com`. |

## Examples

Search your open issues in a GHES org:

```bash
GH_HOST=github.tools.sap node search-assigned-issues.js cs-devops
```

Search for a specific user:

```bash
GH_HOST=github.tools.sap node search-assigned-issues.js cs-devops I340602
```

Custom label exclusion:

```bash
GH_HOST=github.tools.sap node search-assigned-issues.js cs-devops --exclude-label=wontfix,stale,blocked
```

No label exclusion (show all open issues):

```bash
GH_HOST=github.tools.sap node search-assigned-issues.js cs-devops --exclude-label=
```

Export to markdown file:

```bash
GH_HOST=github.tools.sap node search-assigned-issues.js cs-devops I340602 -o
```

Export to a custom file path:

```bash
GH_HOST=github.tools.sap node search-assigned-issues.js cs-devops I340602 --output=~/my-issues.md
```

### Sample output

```
Organization:    cs-devops (github.tools.sap)
Assignee:        I340602
Exclude labels:  done, completed, archived

Searching...
  Found 5 open issue(s) across 3 repo(s)

cs-devops/flux-notification-receiver (2)
  #42  Add retry logic for webhook delivery  [enhancement]
        https://github.tools.sap/cs-devops/flux-notification-receiver/issues/42  (updated: 2026-03-15)
  #51  Support filtering by source cluster  [feature]
        https://github.tools.sap/cs-devops/flux-notification-receiver/issues/51  (updated: 2026-03-28)

cs-devops/helm-charts (1)
  #18  Consolidate values.yaml defaults  [tech-debt]
        https://github.tools.sap/cs-devops/helm-charts/issues/18  (updated: 2026-02-20)

cs-devops/pipeline-controller (2)
  #7   Fix race condition in reconciler  [bug]
        https://github.tools.sap/cs-devops/pipeline-controller/issues/7  (updated: 2026-04-01)
  #12  Add metrics endpoint for pipeline status  [enhancement, observability]
        https://github.tools.sap/cs-devops/pipeline-controller/issues/12  (updated: 2026-03-30)

--- Summary ---
  Total issues:  5
  Repositories:  3
```

## How it works

1. Resolves the assignee (from CLI arg or `gh api user`).
2. Builds a GitHub search query: `org:<org> assignee:<user> is:issue state:open -label:<excluded>`.
3. Calls `GET /search/issues` via `gh api --paginate` to fetch all matching issues.
4. Groups results by repository and sorts by repo name then issue number.
5. Prints a grouped listing with issue number, title, labels, URL, and last update date.

## Search query details

The script uses GitHub's [issue search syntax](https://docs.github.com/en/search-github/searching-on-github/searching-issues-and-pull-requests):

| Qualifier | Purpose |
|---|---|
| `org:<org>` | Scope to organization |
| `assignee:<user>` | Filter by assignee |
| `is:issue` | Exclude pull requests |
| `state:open` | Exclude closed/completed issues |
| `-label:<label>` | Exclude issues with specific labels |

Issues in archived repositories are automatically excluded by GitHub's search API.
