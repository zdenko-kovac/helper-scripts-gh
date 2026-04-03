#!/usr/bin/env node

/**
 * Clone all non-archived repositories from a GitHub Enterprise Server org.
 *
 * Usage:
 *   GHES_TOKEN=<pat> node clone-org-repos.js <ghes-host> <org> [clone-dir]
 *
 * Example:
 *   GHES_TOKEN=ghp_xxx node clone-org-repos.js github.mycompany.com my-org ./repos
 */

const { execSync } = require("child_process");
const path = require("path");
const fs = require("fs");

const PER_PAGE = 100;

async function fetchAllRepos(host, org, token) {
  const repos = [];
  let page = 1;

  while (true) {
    const url = `https://${host}/api/v3/orgs/${org}/repos?per_page=${PER_PAGE}&page=${page}&type=all`;
    const res = await fetch(url, {
      headers: {
        Authorization: `token ${token}`,
        Accept: "application/vnd.github.v3+json",
      },
    });

    if (!res.ok) {
      throw new Error(`API request failed: ${res.status} ${res.statusText}`);
    }

    const batch = await res.json();
    if (batch.length === 0) break;

    repos.push(...batch);
    console.log(`  Fetched page ${page} (${batch.length} repos)`);
    page++;
  }

  return repos;
}

async function main() {
  const [host, org, cloneDir = "./repos"] = process.argv.slice(2);

  if (!host || !org) {
    console.error(
      "Usage: GHES_TOKEN=<pat> node clone-org-repos.js <ghes-host> <org> [clone-dir]"
    );
    process.exit(1);
  }

  const token = process.env.GHES_TOKEN;
  if (!token) {
    console.error("Error: GHES_TOKEN environment variable is required.");
    process.exit(1);
  }

  console.log(`Fetching repos for org "${org}" on ${host}...`);
  const allRepos = await fetchAllRepos(host, org, token);

  const active = allRepos.filter((r) => !r.archived);
  const archived = allRepos.length - active.length;

  console.log(
    `\nFound ${allRepos.length} repos total, ${archived} archived (skipped), ${active.length} to clone.\n`
  );

  const dest = path.resolve(cloneDir);
  fs.mkdirSync(dest, { recursive: true });

  let cloned = 0;
  let skipped = 0;
  let failed = 0;

  for (const repo of active) {
    const repoDir = path.join(dest, repo.name);

    if (fs.existsSync(repoDir)) {
      console.log(`[skip] ${repo.name} — already exists`);
      skipped++;
      continue;
    }

    const cloneUrl = `https://${token}@${host}/${org}/${repo.name}.git`;
    try {
      console.log(`[clone] ${repo.name}`);
      execSync(`git clone --quiet ${cloneUrl} ${repoDir}`, {
        stdio: "inherit",
      });
      cloned++;
    } catch {
      console.error(`[FAIL] ${repo.name}`);
      failed++;
    }
  }

  console.log(
    `\nDone. Cloned: ${cloned}, Skipped (exists): ${skipped}, Failed: ${failed}`
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
