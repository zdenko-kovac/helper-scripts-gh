#!/usr/bin/env node

/**
 * Report failed GitHub Actions workflow runs across an organization.
 *
 * Usage:
 *   node report-failed-workflows.js <org> [--hours=24] [--output=failed-workflows.md]
 *
 * Example:
 *   GH_HOST=github.tools.sap node report-failed-workflows.js cs-devops
 *   node report-failed-workflows.js my-org --hours=48
 *   GH_HOST=github.tools.sap node report-failed-workflows.js cs-devops --output=~/report.md
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
  const flags = { hours: 24, output: "failed-workflows.md" };

  for (const arg of argv) {
    if (arg.startsWith("--hours=")) {
      flags.hours = parseInt(arg.split("=")[1], 10);
      if (isNaN(flags.hours) || flags.hours < 1) {
        console.error("Error: --hours must be a positive integer");
        process.exit(1);
      }
    } else if (arg.startsWith("--output=")) {
      flags.output = arg.split("=")[1];
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
      "Usage: node report-failed-workflows.js <org> [--hours=24] [--output=failed-workflows.md]\n\n" +
        "  <org>              GitHub organization name\n" +
        "  --hours=N          Lookback window in hours (default: 24)\n" +
        "  --output=FILE      Output markdown file path (default: failed-workflows.md)\n\n" +
        "Options (via environment):\n" +
        "  GH_HOST            GHES hostname (e.g. github.tools.sap). Omit for github.com\n"
    );
    process.exit(1);
  }

  return { org, ...flags };
}

function fetchOrgRepos(org) {
  const raw = run(
    `gh api "orgs/${org}/repos" --paginate --jq ".[] | {full_name, name, archived}"`
  );
  if (!raw) return [];

  const repos = [];
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    try {
      const repo = JSON.parse(line);
      if (!repo.archived) repos.push(repo);
    } catch {
      // skip malformed lines
    }
  }
  return repos;
}

function fetchFailedRuns(repo, since) {
  const sinceDate = new Date(since);
  const allRuns = [];
  let page = 1;

  while (true) {
    let raw;
    try {
      raw = run(
        `gh api "repos/${repo}/actions/runs?status=failure&per_page=100&page=${page}"`
      );
    } catch (e) {
      // Actions not enabled or API error — treat as empty
      if (page === 1) return [];
      break;
    }

    const data = JSON.parse(raw);
    for (const r of data.workflow_runs) {
      if (new Date(r.created_at) >= sinceDate) {
        allRuns.push(r);
      } else {
        // Runs are returned newest-first; once we pass the cutoff, stop
        return allRuns;
      }
    }
    if (data.workflow_runs.length < 100) break;
    page++;
  }

  return allRuns;
}

function fetchLatestSuccessDate(repo, workflowId) {
  try {
    const raw = run(
      `gh api "repos/${repo}/actions/workflows/${workflowId}/runs?status=success&per_page=1" --jq ".workflow_runs[0].created_at"`
    );
    return raw || null;
  } catch {
    return null;
  }
}

function filterStillBroken(repo, failedRuns) {
  // Group by workflow file path
  const byWorkflow = new Map();
  for (const r of failedRuns) {
    const key = r.path;
    if (!byWorkflow.has(key)) byWorkflow.set(key, []);
    byWorkflow.get(key).push(r);
  }

  const stillBroken = [];

  for (const [, runs] of byWorkflow) {
    // Most recent failure first
    runs.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    const latestFailure = runs[0];

    const latestSuccessDate = fetchLatestSuccessDate(repo, latestFailure.workflow_id);

    if (!latestSuccessDate || new Date(latestSuccessDate) < new Date(latestFailure.created_at)) {
      stillBroken.push(latestFailure);
    }
  }

  return stillBroken;
}

function analyzeFailure(repo, runId) {
  try {
    const raw = run(`gh api "repos/${repo}/actions/runs/${runId}/jobs" --jq ".jobs"`);
    const jobs = JSON.parse(raw);
    const analyses = [];

    for (const job of jobs) {
      if (job.conclusion !== "failure") continue;
      const failedSteps = (job.steps || [])
        .filter((s) => s.conclusion === "failure")
        .map((s) => s.name);

      if (failedSteps.length > 0) {
        analyses.push(`Job "${job.name}" failed at step: ${failedSteps.join(", ")}`);
      } else {
        analyses.push(`Job "${job.name}" failed (no step-level detail)`);
      }
    }

    return analyses.length > 0 ? analyses.join("; ") : "No job-level failure details available";
  } catch {
    return "Unable to fetch failure details";
  }
}

function generateMarkdown(org, host, results, since, hours, summary) {
  const now = new Date().toISOString();
  const lines = [];

  lines.push(`# Failed Workflows Report — ${org}`);
  lines.push("");
  lines.push(`> Generated on ${now.slice(0, 10)} at ${now.slice(11, 19)} UTC${host ? ` from ${host}` : ""}`);
  lines.push(`> Lookback: ${hours}h (since ${since})`);
  lines.push(`> ${summary.broken} still-broken workflow(s) across ${summary.reposWithFailures} repo(s)`);
  lines.push("");

  if (results.length === 0) {
    lines.push("No still-broken workflows found.");
    lines.push("");
    return lines.join("\n");
  }

  // Group by repo
  const byRepo = new Map();
  for (const entry of results) {
    if (!byRepo.has(entry.repo)) byRepo.set(entry.repo, []);
    byRepo.get(entry.repo).push(entry);
  }

  for (const [repo, entries] of byRepo) {
    lines.push(`## ${repo}`);
    lines.push("");

    for (const entry of entries) {
      lines.push(`### ${entry.path}`);
      lines.push("");
      lines.push("| Field | Value |");
      lines.push("|---|---|");
      lines.push(`| **Run** | [#${entry.id}](${entry.url}) |`);
      lines.push(`| **Branch** | ${entry.branch} |`);
      lines.push(`| **Failed at** | ${entry.created_at} |`);
      lines.push(`| **Analysis** | ${entry.analysis} |`);
      lines.push("");
    }

    lines.push("---");
    lines.push("");
  }

  lines.push("## Summary");
  lines.push("");
  lines.push("| Metric | Count |");
  lines.push("|---|---|");
  lines.push(`| Repos scanned | ${summary.scanned} |`);
  lines.push(`| Repos with still-broken workflows | ${summary.reposWithFailures} |`);
  lines.push(`| Total still-broken workflows | ${summary.broken} |`);
  lines.push(`| Repos skipped (errors) | ${summary.errors} |`);
  lines.push("");

  return lines.join("\n");
}

function main() {
  const { org, hours, output } = parseArgs();

  // Verify gh CLI is available
  try {
    run("gh --version");
  } catch {
    console.error("Error: gh CLI is not installed or not on PATH.");
    process.exit(1);
  }

  const host = process.env.GH_HOST;
  const since = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();

  console.log(`Organization:    ${org}${host ? ` (${host})` : ""}`);
  console.log(`Lookback:        ${hours} hours (since ${since})`);
  console.log();

  // Fetch repos
  console.log("[repos]  Fetching repositories...");
  const repos = fetchOrgRepos(org);
  console.log(`[repos]  Found ${repos.length} non-archived repos`);
  console.log();

  const results = [];
  const summary = { scanned: repos.length, reposWithFailures: 0, broken: 0, errors: 0 };

  for (const repo of repos) {
    const fullName = repo.full_name;

    try {
      const failedRuns = fetchFailedRuns(fullName, since);

      if (failedRuns.length === 0) {
        console.log(`[scan]   ${fullName} — no failed runs`);
        continue;
      }

      const stillBroken = filterStillBroken(fullName, failedRuns);

      if (stillBroken.length === 0) {
        console.log(`[scan]   ${fullName} — ${failedRuns.length} failed run(s), all recovered`);
        continue;
      }

      console.log(
        `[scan]   ${fullName} — ${failedRuns.length} failed run(s), ${stillBroken.length} still broken`
      );

      summary.reposWithFailures++;

      for (const r of stillBroken) {
        const analysis = analyzeFailure(fullName, r.id);
        results.push({
          repo: fullName,
          id: r.id,
          path: r.path,
          url: r.html_url,
          branch: r.head_branch,
          created_at: r.created_at,
          analysis,
        });
        summary.broken++;
      }
    } catch (e) {
      console.log(`[skip]   ${fullName} — ${e.message || "unknown error"}`);
      summary.errors++;
    }
  }

  console.log();
  console.log("--- Summary ---");
  console.log(`  Repos scanned:          ${summary.scanned}`);
  console.log(`  Repos with failures:    ${summary.reposWithFailures}`);
  console.log(`  Still-broken workflows: ${summary.broken}`);
  console.log(`  Errors:                 ${summary.errors}`);

  // Write report
  const md = generateMarkdown(org, host, results, since, hours, summary);
  const filePath = resolve(output);
  writeFileSync(filePath, md);
  console.log();
  console.log(`Report written to ${filePath}`);

  if (summary.errors > 0) process.exit(1);
}

main();
