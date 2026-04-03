#!/usr/bin/env node

/**
 * Retroactively generate release notes for GitHub releases that are missing them.
 *
 * Usage:
 *   node backfill-release-notes.js <owner/repo> [--apply] [--exclude-prefix=helm-]
 *
 * Example:
 *   GH_HOST=github.tools.sap node backfill-release-notes.js cs-devops/flux-notification-receiver
 *   GH_HOST=github.tools.sap node backfill-release-notes.js cs-devops/flux-notification-receiver --apply
 *   GH_HOST=github.tools.sap node backfill-release-notes.js cs-devops/flux-notification-receiver --exclude-prefix=chart-
 */

const { execSync } = require("child_process");

function run(cmd, opts = {}) {
  return execSync(cmd, { encoding: "utf-8", stdio: "pipe", ...opts }).trim();
}

function parseArgs() {
  const argv = process.argv.slice(2);
  const positional = [];
  const flags = { apply: false, excludePrefix: "helm-", verbose: false, renameOnly: false };

  for (const arg of argv) {
    if (arg === "--apply") {
      flags.apply = true;
    } else if (arg === "--verbose" || arg === "-v") {
      flags.verbose = true;
    } else if (arg === "--rename-only") {
      flags.renameOnly = true;
    } else if (arg.startsWith("--exclude-prefix=")) {
      flags.excludePrefix = arg.split("=")[1];
    } else if (arg.startsWith("-")) {
      console.error(`Unknown flag: ${arg}`);
      process.exit(1);
    } else {
      positional.push(arg);
    }
  }

  const repo = positional[0];
  if (!repo || !repo.includes("/")) {
    console.error(
      "Usage: node backfill-release-notes.js <owner/repo> [--apply] [--exclude-prefix=helm-]\n\n" +
      "  <owner/repo>            Repository in owner/repo format\n" +
      "  --apply                 Update releases (default: dry-run preview)\n" +
      "  --rename-only           Only rename releases to match their tag name\n" +
      "  --verbose, -v           Show full release notes and list existing notes\n" +
      "  --exclude-prefix=PREFIX Skip tags starting with PREFIX (default: helm-)\n\n" +
      "Options (via environment):\n" +
      "  GH_HOST                 GHES hostname (e.g. github.tools.sap). Omit for github.com\n"
    );
    process.exit(1);
  }

  return { repo, ...flags };
}

function fetchAllReleases(repo) {
  const raw = run(`gh api "repos/${repo}/releases" --paginate`);
  return JSON.parse(raw);
}

function generateNotes(repo, tagName, previousTagName) {
  let cmd = `gh api "repos/${repo}/releases/generate-notes" -X POST -f tag_name="${tagName}"`;
  if (previousTagName) {
    cmd += ` -f previous_tag_name="${previousTagName}"`;
  }
  const raw = run(cmd);
  return JSON.parse(raw);
}

function updateRelease(repo, releaseId, tagName, body) {
  const payload = JSON.stringify({ name: tagName, body });
  execSync(
    `gh api "repos/${repo}/releases/${releaseId}" -X PATCH --input -`,
    { input: payload, encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] }
  );
}

function renameRelease(repo, releaseId, name) {
  const payload = JSON.stringify({ name });
  execSync(
    `gh api "repos/${repo}/releases/${releaseId}" -X PATCH --input -`,
    { input: payload, encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] }
  );
}

function main() {
  const { repo, apply, excludePrefix, verbose, renameOnly } = parseArgs();

  // Verify gh CLI is available
  try {
    run("gh --version");
  } catch {
    console.error("Error: gh CLI is not installed or not on PATH.");
    process.exit(1);
  }

  const host = process.env.GH_HOST;
  const mode = renameOnly
    ? (apply ? "RENAME (will rename releases)" : "RENAME DRY-RUN (preview only)")
    : (apply ? "APPLY (will update releases)" : "DRY-RUN (preview only)");
  console.log(`Repository:      ${repo}${host ? ` (${host})` : ""}`);
  console.log(`Exclude prefix:  ${excludePrefix}*`);
  console.log(`Mode:            ${mode}`);
  console.log();

  // Fetch all releases
  console.log("Fetching releases...");
  const allReleases = fetchAllReleases(repo);
  console.log(`  Found ${allReleases.length} release(s) total`);

  if (allReleases.length === 0) {
    console.log("\nNothing to do.");
    return;
  }

  // Filter out excluded tags
  const included = allReleases.filter((r) => !r.tag_name.startsWith(excludePrefix));
  const excludedCount = allReleases.length - included.length;
  console.log(`  Excluded ${excludedCount} release(s) matching "${excludePrefix}*"`);

  // Sort by created_at ascending (oldest first)
  included.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));

  // --rename-only: rename releases whose name doesn't match their tag
  if (renameOnly) {
    const misnamed = included.filter((r) => r.name !== r.tag_name);
    console.log(`  ${misnamed.length} release(s) need renaming`);
    console.log(`  ${included.length - misnamed.length} release(s) already named correctly`);
    console.log();

    if (misnamed.length === 0) {
      console.log("Nothing to do.");
      return;
    }

    const results = { renamed: 0, failed: 0 };

    for (const release of misnamed) {
      try {
        if (apply) {
          renameRelease(repo, release.id, release.tag_name);
          console.log(`  [renamed]  ${release.name || "(no name)"} -> ${release.tag_name}`);
        } else {
          console.log(`  [dry-run]  would rename "${release.name || "(no name)"}" -> "${release.tag_name}"`);
        }
        results.renamed++;
      } catch (err) {
        const msg = err.stderr?.trim() || err.message;
        console.error(`  [FAILED]   ${release.tag_name}: ${msg}`);
        results.failed++;
      }
    }

    console.log();
    console.log("--- Summary ---");
    console.log(`  Total releases:      ${allReleases.length}`);
    console.log(`  Excluded (filtered): ${excludedCount}`);
    console.log(`  ${apply ? "Renamed" : "Would rename"}:        ${results.renamed}`);
    console.log(`  Failed:              ${results.failed}`);

    if (!apply && results.renamed > 0) {
      console.log();
      console.log("This was a dry run. Re-run with --apply to rename releases.");
    }

    if (results.failed > 0) process.exit(1);
    return;
  }

  // Identify releases missing body text
  const missing = included.filter((r) => !r.body || r.body.trim() === "");
  const withNotes = included.filter((r) => r.body && r.body.trim() !== "");
  console.log(`  ${withNotes.length} release(s) already have notes`);
  console.log(`  ${missing.length} release(s) need notes`);
  console.log();

  if (verbose && withNotes.length > 0) {
    console.log("Releases with existing notes:");
    for (const r of withNotes) {
      const preview = r.body.split("\n").find((l) => l.trim()) || "(empty)";
      console.log(`  [has-notes] ${r.tag_name}`);
      console.log(`              ${preview}`);
    }
    console.log();
  }

  if (missing.length === 0) {
    console.log("Nothing to do.");
    return;
  }

  // Build tag-to-previous-tag mapping from the full sorted included list
  const tagIndex = new Map();
  for (let i = 0; i < included.length; i++) {
    tagIndex.set(included[i].tag_name, i > 0 ? included[i - 1].tag_name : null);
  }

  // Process each release missing a body
  const results = { updated: 0, failed: 0 };

  for (const release of missing) {
    const prevTag = tagIndex.get(release.tag_name);
    const label = prevTag
      ? `${release.tag_name} (prev: ${prevTag})`
      : `${release.tag_name} (first release)`;

    try {
      const notes = generateNotes(repo, release.tag_name, prevTag);

      if (apply) {
        updateRelease(repo, release.id, release.tag_name, notes.body);
        console.log(`  [updated]  ${label}`);
        if (verbose) {
          console.log();
          console.log(notes.body);
          console.log();
        }
      } else {
        console.log(`  [dry-run]  would update ${label}`);
        if (verbose) {
          console.log();
          console.log(notes.body);
          console.log();
        } else {
          const preview = notes.body.split("\n").find((l) => l.trim()) || "(empty)";
          console.log(`             preview: ${preview}`);
        }
      }
      results.updated++;
    } catch (err) {
      const msg = err.stderr?.trim() || err.message;
      console.error(`  [FAILED]   ${label}: ${msg}`);
      results.failed++;
    }
  }

  // Summary
  console.log();
  console.log("--- Summary ---");
  console.log(`  Total releases:      ${allReleases.length}`);
  console.log(`  Excluded (filtered): ${excludedCount}`);
  console.log(`  Already have notes:  ${withNotes.length}`);
  console.log(`  ${apply ? "Updated" : "Would update"}:       ${results.updated}`);
  console.log(`  Failed:              ${results.failed}`);

  if (!apply && results.updated > 0) {
    console.log();
    console.log("This was a dry run. Re-run with --apply to update releases.");
  }

  if (results.failed > 0) {
    process.exit(1);
  }
}

main();
