#!/usr/bin/env node

/**
 * Create a GitHub issue from a markdown file.
 *
 * Usage:
 *   node create-issue.js <org> <repo> --source=issue.md [--assignee=user] [--label=bug,urgent] [--apply]
 *
 * Example:
 *   GH_HOST=github.tools.sap node create-issue.js cs-devops my-repo --source=issue.md --apply
 */

const { execSync } = require("child_process");
const { readFileSync } = require("fs");
const { resolve } = require("path");

function run(cmd, opts = {}) {
  return execSync(cmd, { encoding: "utf-8", stdio: "pipe", ...opts }).trim();
}

function parseArgs() {
  const argv = process.argv.slice(2);
  const positional = [];
  const flags = { source: null, assignee: null, labels: [], apply: false };

  for (const arg of argv) {
    if (arg.startsWith("--source=")) {
      flags.source = arg.split("=").slice(1).join("=");
    } else if (arg.startsWith("--assignee=")) {
      flags.assignee = arg.split("=").slice(1).join("=");
    } else if (arg.startsWith("--label=")) {
      flags.labels = arg.split("=")[1].split(",").map((l) => l.trim()).filter(Boolean);
    } else if (arg === "--apply") {
      flags.apply = true;
    } else if (arg.startsWith("-")) {
      console.error(`Unknown flag: ${arg}`);
      process.exit(1);
    } else {
      positional.push(arg);
    }
  }

  const org = positional[0];
  const repo = positional[1];

  if (!org || !repo || !flags.source) {
    console.error(
      "Usage: node create-issue.js <org> <repo> --source=FILE [--assignee=USER] [--label=LABELS] [--apply]\n\n" +
      "  <org>              GitHub organization name\n" +
      "  <repo>             Repository name\n" +
      "  --source=FILE      Path to .md file with issue content (required)\n" +
      "  --assignee=USER    GitHub username to assign (default: current gh user)\n" +
      "  --label=LABELS     Comma-separated labels (e.g. bug,urgent)\n" +
      "  --apply            Actually create the issue (default: dry-run preview)\n\n" +
      "Options (via environment):\n" +
      "  GH_HOST            GHES hostname (e.g. github.tools.sap). Omit for github.com\n"
    );
    process.exit(1);
  }

  return { org, repo, ...flags };
}

function parseMarkdown(filePath) {
  const absPath = resolve(filePath);
  let content;
  try {
    content = readFileSync(absPath, "utf-8");
  } catch (err) {
    console.error(`Error: Cannot read file "${absPath}": ${err.message}`);
    process.exit(1);
  }

  const lines = content.split("\n");

  // Find the first # heading
  const headingIdx = lines.findIndex((line) => /^# .+/.test(line));
  if (headingIdx === -1) {
    console.error(`Error: No "# Title" heading found in ${filePath}`);
    console.error("  The first H1 heading (# ...) is used as the issue title.");
    process.exit(1);
  }

  const title = lines[headingIdx].replace(/^# /, "").trim();

  // Body is everything after the heading line, with leading blank lines trimmed
  const body = lines
    .slice(headingIdx + 1)
    .join("\n")
    .replace(/^\n+/, "")
    .trimEnd();

  if (!title) {
    console.error(`Error: Empty title in heading at line ${headingIdx + 1} of ${filePath}`);
    process.exit(1);
  }

  return { title, body };
}

function getCurrentUser() {
  return run("gh api user --jq .login");
}

function previewIssue(org, repo, title, body, assignee, labels) {
  const host = process.env.GH_HOST;
  console.log("--- Issue Preview ---");
  console.log();
  console.log(`  Repository:  ${org}/${repo}${host ? ` (${host})` : ""}`);
  console.log(`  Title:       ${title}`);
  console.log(`  Assignee:    ${assignee}`);
  if (labels.length) {
    console.log(`  Labels:      ${labels.join(", ")}`);
  }
  console.log();
  console.log("  Body:");

  const bodyLines = body.split("\n");
  const previewLines = bodyLines.slice(0, 20);
  for (const line of previewLines) {
    console.log(`    ${line}`);
  }
  if (bodyLines.length > 20) {
    console.log(`    ... (${bodyLines.length - 20} more lines)`);
  }
  console.log();
  console.log("Pass --apply to create this issue.");
}

function createIssue(org, repo, title, body, assignee, labels) {
  const fullRepo = `${org}/${repo}`;
  let cmd = `gh api "repos/${fullRepo}/issues" --method POST -f title="${title.replace(/"/g, '\\"')}" -f assignee="${assignee}"`;

  for (const label of labels) {
    cmd += ` -f "labels[]=${label.replace(/"/g, '\\"')}"`;
  }

  cmd += " --input -";

  // Pipe the body via stdin to avoid shell escaping issues
  const bodyJson = JSON.stringify({ body });
  // We need to send just the body field — but --input - reads the entire JSON body.
  // Since we already have -f flags for other fields, pipe only the body as a field too.
  // Simplest approach: build all fields via -f and pass body via stdin with -F.
  // Actually, the cleanest pattern: use -F body=@- to read body from stdin.
  cmd = `gh api "repos/${fullRepo}/issues" --method POST -f title="${title.replace(/"/g, '\\"')}"`;
  cmd += ` -f "assignee=${assignee}"`;
  for (const label of labels) {
    cmd += ` -f "labels[]=${label.replace(/"/g, '\\"')}"`;
  }
  cmd += " -F body=@-";

  const result = run(cmd, { input: body });
  return JSON.parse(result);
}

function main() {
  const { org, repo, source, assignee: assigneeArg, labels, apply } = parseArgs();

  // Verify gh CLI
  try {
    run("gh --version");
  } catch {
    console.error("Error: gh CLI is not installed or not on PATH.");
    process.exit(1);
  }

  // Parse markdown
  const { title, body } = parseMarkdown(source);

  // Resolve assignee
  const assignee = assigneeArg || getCurrentUser();

  const host = process.env.GH_HOST;
  console.log(`Organization:  ${org}${host ? ` (${host})` : ""}`);
  console.log(`Repository:    ${org}/${repo}`);
  console.log(`Source:        ${resolve(source)}`);
  console.log();

  if (!apply) {
    previewIssue(org, repo, title, body, assignee, labels);
    return;
  }

  // Create the issue
  console.log("Creating issue...");
  try {
    const result = createIssue(org, repo, title, body, assignee, labels);
    console.log();
    console.log(`  Issue created: #${result.number}`);
    console.log(`  URL:           ${result.html_url}`);
  } catch (err) {
    console.error(`Error creating issue: ${err.message}`);
    process.exit(1);
  }
}

main();
