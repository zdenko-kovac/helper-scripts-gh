#!/usr/bin/env node

/**
 * Search for open issues assigned to a user across a GitHub organization.
 *
 * Usage:
 *   node search-assigned-issues.js <org> [assignee] [--exclude-label=done,completed,archived]
 *
 * Example:
 *   GH_HOST=github.tools.sap node search-assigned-issues.js cs-devops
 *   GH_HOST=github.tools.sap node search-assigned-issues.js cs-devops I340602
 *   GH_HOST=github.tools.sap node search-assigned-issues.js cs-devops --exclude-label=wontfix,stale
 */

const { execSync } = require("child_process");
const { writeFileSync } = require("fs");
const { resolve } = require("path");

function run(cmd, opts = {}) {
  return execSync(cmd, { encoding: "utf-8", stdio: "pipe", ...opts }).trim();
}

function parseArgs() {
  const argv = process.argv.slice(2);
  const positional = [];
  const flags = { excludeLabels: ["done", "completed", "archived"], output: null };

  for (const arg of argv) {
    if (arg.startsWith("--exclude-label=")) {
      flags.excludeLabels = arg.split("=")[1].split(",").map((l) => l.trim()).filter(Boolean);
    } else if (arg.startsWith("--output=")) {
      flags.output = arg.split("=")[1];
    } else if (arg === "--output" || arg === "-o") {
      flags.output = "assigned-issues.md";
    } else if (arg.startsWith("-")) {
      console.error(`Unknown flag: ${arg}`);
      process.exit(1);
    } else {
      positional.push(arg);
    }
  }

  const org = positional[0];
  if (!org) {
    console.error(
      "Usage: node search-assigned-issues.js <org> [assignee] [--exclude-label=done,completed,archived]\n\n" +
      "  <org>                   GitHub organization name\n" +
      "  [assignee]              GitHub username (default: current gh user)\n" +
      "  --exclude-label=LABELS  Comma-separated labels to exclude (default: done,completed,archived)\n" +
      "  --output, -o [FILE]     Write results to a markdown file (default: assigned-issues.md)\n\n" +
      "Options (via environment):\n" +
      "  GH_HOST                 GHES hostname (e.g. github.tools.sap). Omit for github.com\n"
    );
    process.exit(1);
  }

  const assignee = positional[1] || null;
  return { org, assignee, ...flags };
}

function getCurrentUser() {
  const raw = run("gh api user --jq .login");
  return raw;
}

function searchIssues(org, assignee, excludeLabels) {
  // Build the search query
  let query = `org:${org} assignee:${assignee} is:issue state:open`;

  // Exclude labels
  for (const label of excludeLabels) {
    query += ` -label:${label}`;
  }

  // The search API returns max 100 per page; paginate to get all results
  // gh api handles pagination with --paginate and merges the items arrays
  const cmd = `gh api "search/issues" --method GET -f q="${query}" -f per_page=100 --paginate --jq ".items"`;
  const raw = run(cmd);

  // --paginate with --jq ".items" outputs one JSON array per page; concatenate them
  // Each page outputs a separate JSON array, so we need to parse them individually
  if (!raw) return [];

  const issues = [];
  // gh --paginate --jq outputs newline-separated JSON values
  // Try parsing as a single array first, fall back to line-by-line
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed;
    issues.push(parsed);
  } catch {
    // Multiple pages: each line is a JSON object or array
    for (const line of raw.split("\n")) {
      if (!line.trim()) continue;
      try {
        const parsed = JSON.parse(line);
        if (Array.isArray(parsed)) issues.push(...parsed);
        else issues.push(parsed);
      } catch {
        // skip malformed lines
      }
    }
  }
  return issues;
}

function formatIssue(issue) {
  // Extract repo name from repository_url: .../repos/org/repo
  const repoMatch = issue.repository_url.match(/repos\/(.+)$/);
  const repo = repoMatch ? repoMatch[1] : "unknown";
  const labels = issue.labels.map((l) => l.name).join(", ");
  return { repo, number: issue.number, title: issue.title, labels, url: issue.html_url, updated: issue.updated_at.slice(0, 10) };
}

function generateMarkdown(org, assignee, host, byRepo, total) {
  const date = new Date().toISOString().slice(0, 10);
  const lines = [];

  lines.push(`# Open Issues — ${assignee} @ ${org}`);
  lines.push("");
  lines.push(`> Generated on ${date}${host ? ` from ${host}` : ""}`);
  lines.push(`> ${total} issue(s) across ${byRepo.size} repo(s)`);
  lines.push("");

  for (const [repo, repoIssues] of byRepo) {
    lines.push(`## ${repo} (${repoIssues.length})`);
    lines.push("");
    for (const issue of repoIssues) {
      const labels = issue.labels ? ` \`${issue.labels}\`` : "";
      lines.push(`- [#${issue.number}](${issue.url}) ${issue.title}${labels}`);
      lines.push(`  - Updated: ${issue.updated}`);
    }
    lines.push("");
  }

  return lines.join("\n");
}

function main() {
  const { org, assignee: assigneeArg, excludeLabels, output } = parseArgs();

  // Verify gh CLI is available
  try {
    run("gh --version");
  } catch {
    console.error("Error: gh CLI is not installed or not on PATH.");
    process.exit(1);
  }

  // Resolve assignee
  const assignee = assigneeArg || getCurrentUser();

  const host = process.env.GH_HOST;
  console.log(`Organization:    ${org}${host ? ` (${host})` : ""}`);
  console.log(`Assignee:        ${assignee}`);
  console.log(`Exclude labels:  ${excludeLabels.join(", ") || "(none)"}`);
  console.log();

  // Search
  console.log("Searching...");
  const issues = searchIssues(org, assignee, excludeLabels);

  if (issues.length === 0) {
    console.log("  No open issues found.");
    return;
  }

  // Format and group by repo
  const formatted = issues.map(formatIssue);
  formatted.sort((a, b) => a.repo.localeCompare(b.repo) || a.number - b.number);

  const byRepo = new Map();
  for (const issue of formatted) {
    if (!byRepo.has(issue.repo)) byRepo.set(issue.repo, []);
    byRepo.get(issue.repo).push(issue);
  }

  // Print grouped results
  console.log(`  Found ${issues.length} open issue(s) across ${byRepo.size} repo(s)`);
  console.log();

  for (const [repo, repoIssues] of byRepo) {
    console.log(`${repo} (${repoIssues.length})`);
    for (const issue of repoIssues) {
      const labels = issue.labels ? `  [${issue.labels}]` : "";
      console.log(`  #${issue.number}  ${issue.title}${labels}`);
      console.log(`        ${issue.url}  (updated: ${issue.updated})`);
    }
    console.log();
  }

  // Summary
  console.log("--- Summary ---");
  console.log(`  Total issues:  ${issues.length}`);
  console.log(`  Repositories:  ${byRepo.size}`);

  // Write markdown file
  if (output) {
    const md = generateMarkdown(org, assignee, host, byRepo, issues.length);
    const filePath = resolve(output);
    writeFileSync(filePath, md);
    console.log();
    console.log(`Markdown written to ${filePath}`);
  }
}

main();
