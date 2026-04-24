#!/usr/bin/env node

/**
 * Retroactively generate categorized release notes for GitHub releases
 * based on conventional commits between tags.
 *
 * By default, fetches commits via the Compare API, parses conventional
 * commit prefixes, and produces categorized markdown (Breaking, Features,
 * Fixes, Improvements, Documentation, Other). Use --mode=github to fall
 * back to GitHub's generic "generate-notes" API.
 *
 * Usage:
 *   node backfill-release-notes.js <owner/repo> [flags]
 *
 * Flags:
 *   --apply                       Update releases (default: dry-run preview)
 *   --force                       Overwrite releases that already have notes
 *   --verbose, -v                 Show full release notes
 *   --rename-only                 Only rename releases to match their tag name
 *   --exclude-prefix=PREFIX       Skip tags starting with PREFIX (default: helm-)
 *   --exclude-authors=a,b         Comma-separated commit author names to skip
 *   --mode=conventional|github    Note generation engine (default: conventional)
 *
 * Environment:
 *   GH_HOST   GHES hostname (e.g. github.tools.sap). Omit for github.com
 *
 * Examples:
 *   GH_HOST=github.tools.sap node backfill-release-notes.js cs-devops/flux-notification-receiver
 *   node backfill-release-notes.js SAP/clustersecret-operator --apply --verbose
 *   node backfill-release-notes.js owner/repo --mode=github   # GitHub's auto-generated notes
 */

const { execSync } = require("child_process");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function run(cmd, opts = {}) {
  return execSync(cmd, { encoding: "utf-8", stdio: "pipe", ...opts }).trim();
}

// ---------------------------------------------------------------------------
// Argument parsing
// ---------------------------------------------------------------------------

function parseArgs() {
  const argv = process.argv.slice(2);
  const positional = [];
  const flags = {
    apply: false,
    force: false,
    excludePrefix: "helm-",
    excludeAuthors: [],
    verbose: false,
    renameOnly: false,
    mode: "conventional",
  };

  for (const arg of argv) {
    if (arg === "--apply") {
      flags.apply = true;
    } else if (arg === "--force") {
      flags.force = true;
    } else if (arg === "--verbose" || arg === "-v") {
      flags.verbose = true;
    } else if (arg === "--rename-only") {
      flags.renameOnly = true;
    } else if (arg.startsWith("--exclude-prefix=")) {
      flags.excludePrefix = arg.split("=")[1];
    } else if (arg.startsWith("--exclude-authors=")) {
      flags.excludeAuthors = arg.split("=")[1].split(",").map((s) => s.trim()).filter(Boolean);
    } else if (arg.startsWith("--mode=")) {
      const val = arg.split("=")[1];
      if (val !== "conventional" && val !== "github") {
        console.error(`Invalid --mode value: ${val}. Must be 'conventional' or 'github'.`);
        process.exit(1);
      }
      flags.mode = val;
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
      "Usage: node backfill-release-notes.js <owner/repo> [flags]\n\n" +
      "  <owner/repo>                  Repository in owner/repo format\n" +
      "  --apply                       Update releases (default: dry-run preview)\n" +
      "  --force                       Overwrite releases that already have notes\n" +
      "  --rename-only                 Only rename releases to match their tag name\n" +
      "  --verbose, -v                 Show full release notes and list existing notes\n" +
      "  --exclude-prefix=PREFIX       Skip tags starting with PREFIX (default: helm-)\n" +
      "  --exclude-authors=a,b         Comma-separated commit authors to skip\n" +
      "  --mode=conventional|github    Note generation engine (default: conventional)\n\n" +
      "Options (via environment):\n" +
      "  GH_HOST                       GHES hostname (e.g. github.tools.sap). Omit for github.com\n"
    );
    process.exit(1);
  }

  return { repo, ...flags };
}

// ---------------------------------------------------------------------------
// GitHub API helpers (via gh CLI)
// ---------------------------------------------------------------------------

function fetchAllReleases(repo) {
  const raw = run(`gh api "repos/${repo}/releases" --paginate`);
  return JSON.parse(raw);
}

/**
 * Fetch commits between two refs using the Compare API.
 * Returns [{sha, message, author}].
 */
function fetchCommitsBetween(repo, base, head) {
  let raw;
  try {
    raw = run(`gh api "repos/${repo}/compare/${base}...${head}" --jq '.commits'`);
  } catch (err) {
    const stderr = err.stderr?.trim() || "";
    if (stderr.includes("404")) {
      return null; // base tag doesn't exist
    }
    throw err;
  }

  const commits = JSON.parse(raw);
  return commits.map((c) => ({
    sha: c.sha.slice(0, 7),
    message: c.commit.message.split("\n")[0], // first line only
    author: c.commit.author?.name || "",
  }));
}

/**
 * Fallback: GitHub's generate-notes API (v1 behavior).
 */
function generateNotesViaGitHub(repo, tagName, previousTagName) {
  let cmd = `gh api "repos/${repo}/releases/generate-notes" -X POST -f tag_name="${tagName}"`;
  if (previousTagName) {
    cmd += ` -f previous_tag_name="${previousTagName}"`;
  }
  const raw = run(cmd);
  return JSON.parse(raw).body;
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

// ---------------------------------------------------------------------------
// Conventional-commit categorization
// ---------------------------------------------------------------------------

const CONVENTIONAL_RE = /^(?<type>[a-z]+)(?:\((?<scope>[^)]*)\))?(?<breaking>!)?:\s+(?<description>.+)$/;
const MERGE_RE = /^Merge (pull request|branch)/;
const BUMP_RE = /^Bump version/;

function categorizeCommits(commits, excludeAuthors) {
  const excludeSet = new Set(excludeAuthors.map((a) => a.toLowerCase()));

  const categories = {
    breaking: [],
    features: [],
    fixes: [],
    improvements: [],
    docs: [],
    other: [],
  };

  for (const { sha, message, author } of commits) {
    // Skip merge commits, version bumps, excluded authors
    if (MERGE_RE.test(message)) continue;
    if (BUMP_RE.test(message)) continue;
    if (excludeSet.has(author.toLowerCase())) continue;

    const match = message.match(CONVENTIONAL_RE);

    if (match) {
      const { type, description, breaking } = match.groups;

      if (breaking) {
        categories.breaking.push({ description, sha });
      } else if (type === "feat") {
        categories.features.push({ description, sha });
      } else if (type === "fix") {
        categories.fixes.push({ description, sha });
      } else if (type === "docs") {
        categories.docs.push({ description, sha });
      } else if (["perf", "refactor", "chore", "ci", "build", "style", "test", "revert"].includes(type)) {
        categories.improvements.push({ description, sha });
      } else {
        // Unknown conventional type → other
        categories.other.push({ description: message, sha });
      }
    } else {
      // Non-conventional commit
      categories.other.push({ description: message, sha });
    }
  }

  return categories;
}

function buildReleaseNotes(tag, prevTag, categories, repo) {
  const host = process.env.GH_HOST || "github.com";
  const totalCommits =
    categories.breaking.length +
    categories.features.length +
    categories.fixes.length +
    categories.improvements.length +
    categories.docs.length +
    categories.other.length;

  if (totalCommits === 0) {
    return `Release ${tag} -- no notable changes since ${prevTag}`;
  }

  const sections = [];
  sections.push("## What's Changed\n");

  const sectionDefs = [
    { key: "breaking", title: "### \u26a0\ufe0f Breaking Changes" },
    { key: "features", title: "### \ud83d\ude80 New Features" },
    { key: "fixes", title: "### \ud83d\udc1b Bug Fixes" },
    { key: "improvements", title: "### \ud83d\udd27 Improvements" },
    { key: "docs", title: "### \ud83d\udcc4 Documentation" },
    { key: "other", title: "### Other Changes" },
  ];

  for (const { key, title } of sectionDefs) {
    const items = categories[key];
    if (items.length === 0) continue;
    sections.push(title);
    for (const { description, sha } of items) {
      sections.push(`- ${description} (${sha})`);
    }
    sections.push(""); // blank line after section
  }

  sections.push(`**Full Changelog**: https://${host}/${repo}/compare/${prevTag}...${tag}`);

  return sections.join("\n");
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main() {
  const { repo, apply, force, excludePrefix, excludeAuthors, verbose, renameOnly, mode } = parseArgs();

  // Verify gh CLI is available
  try {
    run("gh --version");
  } catch {
    console.error("Error: gh CLI is not installed or not on PATH.");
    process.exit(1);
  }

  const host = process.env.GH_HOST;
  const modeLabel = renameOnly
    ? (apply ? "RENAME (will rename releases)" : "RENAME DRY-RUN (preview only)")
    : (apply ? "APPLY (will update releases)" : "DRY-RUN (preview only)");

  console.log(`Repository:        ${repo}${host ? ` (${host})` : ""}`);
  console.log(`Exclude prefix:    ${excludePrefix}*`);
  if (excludeAuthors.length > 0) {
    console.log(`Exclude authors:   ${excludeAuthors.join(", ")}`);
  }
  console.log(`Notes engine:      ${mode}`);
  console.log(`Mode:              ${modeLabel}`);
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

  // Identify releases to process
  const missing = force
    ? included // --force: overwrite all
    : included.filter((r) => !r.body || r.body.trim() === "");
  const withNotes = included.filter((r) => r.body && r.body.trim() !== "");
  const skipped = force ? 0 : withNotes.length;
  console.log(`  ${withNotes.length} release(s) already have notes${force ? " (will overwrite)" : ""}`);
  console.log(`  ${missing.length} release(s) ${force ? "to process" : "need notes"}`);
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
      let body;

      if (mode === "github") {
        // Fallback: v1 behavior using GitHub's generate-notes API
        body = generateNotesViaGitHub(repo, release.tag_name, prevTag);
      } else {
        // Conventional commit mode
        if (!prevTag) {
          body = `## Initial Release ${release.tag_name}`;
        } else {
          const commits = fetchCommitsBetween(repo, prevTag, release.tag_name);
          if (commits === null) {
            // Previous tag not found — treat as initial release
            body = `## Initial Release ${release.tag_name}`;
          } else {
            const categories = categorizeCommits(commits, excludeAuthors);
            body = buildReleaseNotes(release.tag_name, prevTag, categories, repo);
          }
        }
      }

      if (apply) {
        updateRelease(repo, release.id, release.tag_name, body);
        console.log(`  [updated]  ${label}`);
        if (verbose) {
          console.log();
          console.log(body);
          console.log();
        }
      } else {
        console.log(`  [dry-run]  would update ${label}`);
        if (verbose) {
          console.log();
          console.log(body);
          console.log();
        } else {
          const preview = body.split("\n").find((l) => l.trim()) || "(empty)";
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
  if (!force) {
    console.log(`  Already have notes:  ${withNotes.length}`);
  }
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
