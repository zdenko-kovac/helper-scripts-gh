# clone-org-repos.js

A Node.js helper script that clones all non-archived repositories from a GitHub Enterprise Server (GHES) organization.

## Features

- **Pagination** — Fetches repos in batches of 100, handling orgs with any number of repositories.
- **Skips archived repos** — Archived repositories are detected and excluded from cloning.
- **Idempotent** — Safe to re-run; repos that already exist locally are skipped.
- **Summary report** — Prints a final tally of cloned, skipped, and failed repos.

## Prerequisites

| Requirement | Details |
|---|---|
| **Node.js** | v18 or later (uses built-in `fetch`) |
| **Git** | Must be available on `PATH` |
| **Personal Access Token** | A GHES PAT with `repo` scope |

## Usage

```bash
GHES_TOKEN=<pat> node clone-org-repos.js <ghes-host> <org> [clone-dir]
```

| Argument | Required | Description |
|---|---|---|
| `ghes-host` | Yes | Your GHES hostname (e.g. `github.tools.sap`) |
| `org` | Yes | The organization name to clone from |
| `clone-dir` | No | Target directory for cloned repos (default: `./repos`) |

### Environment variables

| Variable | Required | Description |
|---|---|---|
| `GHES_TOKEN` | Yes | Personal access token with `repo` scope |

## Examples

Clone all active repos from the `cs-actions` org into `./ghtools/cs-actions`:

```bash
GHES_TOKEN=$GITHUB_TOKEN node clone-org-repos.js github.tools.sap cs-actions ./ghtools/cs-actions
```

Clone into the default `./repos` directory:

```bash
GHES_TOKEN=$GITHUB_TOKEN node clone-org-repos.js github.tools.sap cs-actions
```

### Sample output

```
Fetching repos for org "cs-actions" on github.tools.sap...
  Fetched page 1 (40 repos)

Found 40 repos total, 1 archived (skipped), 39 to clone.

[skip] publish-docker-action — already exists
[clone] upload-helm-action
[clone] msteams-notification-action
...
[clone] sonar-token-rotator

Done. Cloned: 33, Skipped (exists): 6, Failed: 0
```

## How it works

1. Calls the GHES REST API (`/api/v3/orgs/{org}/repos`) page by page (100 per page) until all repositories are fetched.
2. Filters out any repository where `archived` is `true`.
3. For each active repo, checks if a local directory with that name already exists in the target folder — if so, it skips it.
4. Clones the repo over HTTPS using the provided token for authentication.
5. Prints a summary with the count of cloned, skipped, and failed repos.
