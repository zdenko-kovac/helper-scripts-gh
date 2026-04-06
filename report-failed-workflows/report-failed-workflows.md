# report-failed-workflows.js

A Node.js helper script that scans all repositories in a GitHub organization for failed Actions workflow runs, filters out workflows that have since recovered, and generates a markdown report with failure analysis.

## Features

- **Org-wide scan** — checks every non-archived repo in the organization for failed workflow runs.
- **Still-broken filter** — only reports workflows with no newer successful run, eliminating transient failures.
- **Failure analysis** — extracts failed job and step names from the Jobs API for a concise root-cause hint.
- **Configurable lookback** — `--hours` flag controls the time window (default: 24 hours).
- **Markdown report** — writes a `.md` file with repo, workflow, run link, branch, timestamp, and analysis.
- **GHES support** — set `GH_HOST` to target a GitHub Enterprise Server instance.
- **Error isolation** — repos with Actions disabled or API errors are skipped without halting the scan.

## Prerequisites

| Requirement | Details |
|---|---|
| **Node.js** | v18 or later |
| **GitHub CLI (`gh`)** | Must be installed and authenticated (`gh auth login`). Token needs `repo` scope and `actions:read`. |

## Usage

```bash
node report-failed-workflows.js <org> [--hours=24] [--output=failed-workflows.md]
```

| Argument | Required | Description |
|---|---|---|
| `org` | Yes | GitHub organization name |
| `--hours` | No | Lookback window in hours (default: `24`) |
| `--output` | No | Output markdown file path (default: `failed-workflows.md`) |

### Environment variables

| Variable | Required | Description |
|---|---|---|
| `GH_HOST` | For GHES | GHES hostname (e.g. `github.tools.sap`). Omit for `github.com`. |

## Examples

Scan a GHES org for failed workflows in the last 24 hours:

```bash
GH_HOST=github.tools.sap node report-failed-workflows.js cs-devops
```

Scan with a 48-hour lookback window:

```bash
GH_HOST=github.tools.sap node report-failed-workflows.js cs-devops --hours=48
```

Write report to a custom path:

```bash
GH_HOST=github.tools.sap node report-failed-workflows.js cs-devops --output=~/weekly-report.md
```

Scan a github.com org:

```bash
node report-failed-workflows.js my-org
```

### Sample output

```
Organization:    cs-devops (github.tools.sap)
Lookback:        24 hours (since 2026-04-04T10:00:00.000Z)

[repos]  Fetching repositories...
[repos]  Found 42 non-archived repos

[scan]   cs-devops/flux-controller — no failed runs
[scan]   cs-devops/helm-charts — 3 failed run(s), all recovered
[scan]   cs-devops/pipeline-controller — 2 failed run(s), 1 still broken
[skip]   cs-devops/legacy-app — Actions not enabled
[scan]   cs-devops/infra-modules — 1 failed run(s), 1 still broken
...

--- Summary ---
  Repos scanned:          42
  Repos with failures:    2
  Still-broken workflows: 2
  Errors:                 1

Report written to /Users/I340602/helper-scripts/report-failed-workflows/failed-workflows.md
```

### Sample report

```markdown
# Failed Workflows Report — cs-devops

> Generated on 2026-04-05 at 10:15:30 UTC from github.tools.sap
> Lookback: 24h (since 2026-04-04T10:00:00.000Z)
> 2 still-broken workflow(s) across 2 repo(s)

## cs-devops/pipeline-controller

### .github/workflows/ci.yml

| Field | Value |
|---|---|
| **Run** | [#12345678](https://github.tools.sap/cs-devops/pipeline-controller/actions/runs/12345678) |
| **Branch** | main |
| **Failed at** | 2026-04-05T08:30:00Z |
| **Analysis** | Job "test" failed at step: Run unit tests |

---

## cs-devops/infra-modules

### .github/workflows/validate.yml

| Field | Value |
|---|---|
| **Run** | [#87654321](https://github.tools.sap/cs-devops/infra-modules/actions/runs/87654321) |
| **Branch** | feature/vpc-update |
| **Failed at** | 2026-04-04T22:10:00Z |
| **Analysis** | Job "terraform-plan" failed at step: Terraform Plan |
```

## How it works

1. Fetches all non-archived repos from `orgs/{org}/repos` via `gh api --paginate`.
2. For each repo, queries `repos/{repo}/actions/runs?status=failure&created=>={since}` with manual pagination.
3. Groups failed runs by workflow file path and picks the most recent failure per workflow.
4. For each unique workflow, checks `repos/{repo}/actions/workflows/{id}/runs?status=success&per_page=1` to see if a newer success exists.
5. For still-broken workflows, fetches job details via `repos/{repo}/actions/runs/{id}/jobs` and extracts failed job/step names.
6. Writes a grouped markdown report with run links and failure analysis.

## API endpoints used

| Endpoint | Purpose |
|---|---|
| `GET /orgs/{org}/repos` | List all repos in the org |
| `GET /repos/{repo}/actions/runs` | Query failed workflow runs with date filter |
| `GET /repos/{repo}/actions/workflows/{id}/runs` | Check for newer successful runs |
| `GET /repos/{repo}/actions/runs/{id}/jobs` | Get job/step details for failure analysis |
