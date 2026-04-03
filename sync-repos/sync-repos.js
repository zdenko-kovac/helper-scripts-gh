#!/usr/bin/env node

/**
 * Sync all git repositories under a given folder with their remote.
 *
 * For each repo:
 *   1. Stash uncommitted changes (if any)
 *   2. Checkout main/master and pull
 *   3. Switch back to the original branch
 *   4. Merge main/master into it (abort on conflict, leaving repo clean)
 *   5. Restore stashed changes
 *
 * Usage:
 *   node sync-repos.js [repos-dir]    (default: ./repos)
 *
 * Example:
 *   node sync-repos.js ~/ghtools/erp4sme
 */

const { execSync } = require("child_process");
const path = require("path");
const fs = require("fs");

function git(args, cwd) {
  return execSync(`git ${args}`, { cwd, encoding: "utf-8", stdio: "pipe" }).trim();
}

function gitSafe(args, cwd) {
  try {
    return { ok: true, output: git(args, cwd) };
  } catch (e) {
    return { ok: false, output: e.stderr?.trim() || e.message };
  }
}

function detectDefaultBranch(cwd) {
  for (const name of ["main", "master"]) {
    const check = gitSafe(`rev-parse --verify ${name}`, cwd);
    if (check.ok) return name;
  }
  return null;
}

function syncRepo(repoDir) {
  const name = path.basename(repoDir);
  const log = (tag, msg) => console.log(`  [${tag}] ${msg}`);

  // Verify it's a git repo
  if (!gitSafe("rev-parse --git-dir", repoDir).ok) {
    log("skip", "not a git repository");
    return "skipped";
  }

  // 1 — Detect current branch and default branch
  const currentBranch = gitSafe("rev-parse --abbrev-ref HEAD", repoDir);
  if (!currentBranch.ok) {
    log("skip", "cannot determine current branch");
    return "skipped";
  }
  const branch = currentBranch.output;
  log("info", `on branch: ${branch}`);

  const defaultBranch = detectDefaultBranch(repoDir);
  if (!defaultBranch) {
    log("skip", "no main or master branch found");
    return "skipped";
  }

  // 2 — Stash uncommitted changes (tracked + untracked)
  const dirty =
    git("status --porcelain", repoDir).length > 0;
  let stashed = false;
  if (dirty) {
    log("stash", "saving uncommitted changes");
    git("stash push -u -m sync-repos-autostash", repoDir);
    stashed = true;
  }

  let result = "synced";

  try {
    // 3 — Checkout default branch and pull
    if (branch !== defaultBranch) {
      git(`checkout ${defaultBranch}`, repoDir);
    }

    const pull = gitSafe("pull --ff-only", repoDir);
    if (!pull.ok) {
      // ff-only failed — try rebase pull to avoid merge commits on the default branch
      const pullRebase = gitSafe("pull --rebase", repoDir);
      if (!pullRebase.ok) {
        log("WARN", `pull failed on ${defaultBranch}: ${pullRebase.output}`);
        gitSafe("rebase --abort", repoDir);
        result = "pull-failed";
      }
    }
    log("pull", `${defaultBranch} updated`);

    // 4 — Switch back to original branch and merge default branch in
    if (branch !== defaultBranch) {
      git(`checkout ${branch}`, repoDir);

      const merge = gitSafe(`merge ${defaultBranch} --no-edit`, repoDir);
      if (!merge.ok) {
        log("WARN", `merge conflict — aborting merge to keep branch clean`);
        gitSafe("merge --abort", repoDir);
        result = "merge-conflict";
      } else {
        log("merge", `${defaultBranch} merged into ${branch}`);
      }
    }
  } finally {
    // 5 — Always try to restore stash, even if something above failed
    if (stashed) {
      const pop = gitSafe("stash pop", repoDir);
      if (!pop.ok) {
        log("WARN", "stash pop conflict — changes kept in stash, run 'git stash pop' manually");
        gitSafe("checkout -- .", repoDir);
        result = "stash-conflict";
      } else {
        log("stash", "restored uncommitted changes");
      }
    }

    // Safety: make sure we end up on the original branch
    const finalBranch = gitSafe("rev-parse --abbrev-ref HEAD", repoDir);
    if (finalBranch.ok && finalBranch.output !== branch) {
      gitSafe(`checkout ${branch}`, repoDir);
    }
  }

  return result;
}

function main() {
  const reposDir = path.resolve(process.argv[2] || "./repos");

  if (!fs.existsSync(reposDir)) {
    console.error(`Directory not found: ${reposDir}`);
    process.exit(1);
  }

  const entries = fs.readdirSync(reposDir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort();

  console.log(`Syncing ${entries.length} repos in ${reposDir}\n`);

  const summary = { synced: 0, skipped: 0, "pull-failed": 0, "merge-conflict": 0, "stash-conflict": 0 };

  for (const dir of entries) {
    const fullPath = path.join(reposDir, dir);
    console.log(`${dir}/`);
    const status = syncRepo(fullPath);
    summary[status] = (summary[status] || 0) + 1;
    console.log();
  }

  console.log("--- Summary ---");
  console.log(`  Synced:          ${summary.synced}`);
  console.log(`  Skipped:         ${summary.skipped}`);
  console.log(`  Pull failed:     ${summary["pull-failed"]}`);
  console.log(`  Merge conflict:  ${summary["merge-conflict"]}`);
  console.log(`  Stash conflict:  ${summary["stash-conflict"]}`);
}

main();
