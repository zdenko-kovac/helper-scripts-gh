# create-org-secret.js

A Node.js helper script that creates or updates a GitHub organization secret using the value of a local environment variable.

## Features

- **Reads from local env vars** — the secret value never needs to be typed or passed as a CLI argument.
- **GHES support** — set `GH_HOST` to target a GitHub Enterprise Server instance.
- **Visibility control** — choose whether the secret is available to `all`, `private`, or `selected` repos.
- **Secure** — secret encryption is handled by the `gh` CLI; the value is piped via stdin, never exposed in process args.

## Prerequisites

| Requirement | Details |
|---|---|
| **Node.js** | v18 or later |
| **GitHub CLI (`gh`)** | Must be installed and authenticated (`gh auth login`). For GHES orgs, the token needs the `admin:org` scope — run `gh auth refresh -h <ghes-host> -s admin:org` if you get a 403. |

## Usage

```bash
node create-org-secret.js <org> <secret-name> <env-var> [visibility] [repos]
```

| Argument | Required | Description |
|---|---|---|
| `org` | Yes | GitHub organization name |
| `secret-name` | Yes | Name of the secret to create or update |
| `env-var` | Yes | Name of the local environment variable to read the value from |
| `visibility` | No | Secret visibility: `all`, `private`, or `selected` (default: `private`) |
| `repos` | When `selected` | Comma-separated list of repository names to grant access to |

### Environment variables

| Variable | Required | Description |
|---|---|---|
| `GH_HOST` | For GHES | GHES hostname (e.g. `github.tools.sap`). Omit for `github.com`. Without this, the script defaults to `github.com` and will fail with a 401 if the org only exists on your GHES instance. |

## Examples

Create an org secret on `github.com` from a local variable:

```bash
export MY_LOCAL_NPM_TOKEN="npm_abc123..."
node create-org-secret.js my-org NPM_TOKEN MY_LOCAL_NPM_TOKEN
```

Create an org secret on GHES, visible to all repos:

```bash
export LOCAL_DEPLOY_KEY="ssh-rsa AAAA..."
GH_HOST=github.tools.sap node create-org-secret.js cs-actions DEPLOY_KEY LOCAL_DEPLOY_KEY all
```

Create an org secret scoped to specific repos:

```bash
export MY_LOCAL_NPM_TOKEN="npm_abc123..."
node create-org-secret.js my-org NPM_TOKEN MY_LOCAL_NPM_TOKEN selected repo-alpha,repo-beta,repo-gamma
```

### Sample output

```
Setting secret "NPM_TOKEN" for org "my-org" (visibility: private)
  Source: $MY_LOCAL_NPM_TOKEN (28 chars)

Done. Secret "NPM_TOKEN" set successfully.
```

## How it works

1. Reads the value of the specified local environment variable.
2. Validates that the variable is set and non-empty.
3. Pipes the value via stdin to `gh secret set`, which handles the NaCl encryption required by the GitHub API.
4. The `--org` and `--visibility` flags tell `gh` to create an org-level secret with the desired scope.

## Visibility options

| Value | Meaning |
|---|---|
| `private` | Available to private repositories only (default) |
| `all` | Available to all repositories in the org |
| `selected` | Available to explicitly selected repositories only (requires `repos` argument) |
