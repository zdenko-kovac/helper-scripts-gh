#!/usr/bin/env node

/**
 * Create or update a GitHub organization secret from a local environment variable.
 *
 * Usage:
 *   node create-org-secret.js <org> <secret-name> <env-var> [visibility] [repos]
 *
 * Example:
 *   node create-org-secret.js my-org NPM_TOKEN MY_LOCAL_NPM_TOKEN
 *   node create-org-secret.js my-org NPM_TOKEN MY_LOCAL_NPM_TOKEN selected repo-a,repo-b
 *   GH_HOST=github.tools.sap node create-org-secret.js cs-actions DEPLOY_KEY LOCAL_DEPLOY_KEY
 */

const { execSync } = require("child_process");

function run(cmd, opts = {}) {
  return execSync(cmd, { encoding: "utf-8", stdio: "pipe", ...opts }).trim();
}

function main() {
  const [org, secretName, envVar] = process.argv.slice(2);

  if (!org || !secretName || !envVar) {
    console.error(
      "Usage: node create-org-secret.js <org> <secret-name> <env-var> [visibility] [repos]\n\n" +
      "  <org>          GitHub organization name\n" +
      "  <secret-name>  Name of the secret to create/update in the org\n" +
      "  <env-var>      Local environment variable whose value will be used\n" +
      "  [visibility]   all | private | selected (default: private)\n" +
      "  [repos]        Comma-separated repo names (required when visibility is 'selected')\n\n" +
      "Options (via environment):\n" +
      "  GH_HOST        GHES hostname (e.g. github.tools.sap). Omit for github.com\n"
    );
    process.exit(1);
  }

  const value = process.env[envVar];
  if (value === undefined || value === "") {
    console.error(`Error: Environment variable "${envVar}" is not set or is empty.`);
    process.exit(1);
  }

  // Optional visibility flag (4th positional arg)
  const visibility = process.argv[5] || "private";
  const validVisibilities = ["all", "private", "selected"];
  if (!validVisibilities.includes(visibility)) {
    console.error(`Error: Visibility must be one of: ${validVisibilities.join(", ")}`);
    process.exit(1);
  }

  // Optional repos list (5th positional arg, required when visibility is "selected")
  const repos = process.argv[6] || "";
  if (visibility === "selected" && !repos) {
    console.error('Error: A comma-separated list of repos is required when visibility is "selected".\n');
    console.error("  Example: node create-org-secret.js my-org SECRET ENV_VAR selected repo-a,repo-b");
    process.exit(1);
  }

  const host = process.env.GH_HOST;
  const target = host ? `${org} on ${host}` : org;

  console.log(`Setting secret "${secretName}" for org "${target}" (visibility: ${visibility})`);
  console.log(`  Source: $${envVar} (${value.length} chars)`);
  if (repos) {
    console.log(`  Repos:  ${repos}`);
  }

  try {
    // gh secret set handles sodium encryption internally
    let cmd = `gh secret set ${secretName} --org ${org} --visibility ${visibility}`;
    if (visibility === "selected" && repos) {
      cmd += ` --repos ${repos}`;
    }
    run(cmd, {
      input: value,
      env: { ...process.env, ...(host ? { GH_HOST: host } : {}) },
      stdio: ["pipe", "pipe", "pipe"],
    });
    console.log(`\nDone. Secret "${secretName}" set successfully.`);
  } catch (e) {
    const stderr = e.stderr?.trim() || e.message;
    console.error(`\nFailed to set secret: ${stderr}`);
    process.exit(1);
  }
}

main();
