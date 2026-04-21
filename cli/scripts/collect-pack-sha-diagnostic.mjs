#!/usr/bin/env node
/**
 * Collect pack-SHA diagnostic evidence from `publish-npm-on-tag.yml` runs.
 *
 * Purpose:
 *   Turn 129 (`DEC-PUBLISH-WORKFLOW-PACK-SHA-DIAGNOSTIC-ONLY-001`) added
 *   runner-local `npm pack` SHA capture + registry `dist.shasum`/`dist.integrity`
 *   comparison to the publish workflow as diagnostic-only evidence. Each
 *   published tag now emits `PACK_SHA_DIAGNOSTIC:` and `PACK_INTEGRITY_DIAGNOSTIC:`
 *   log lines with MATCH/MISMATCH verdicts.
 *
 *   A real reproducible-publish gate cannot be designed until we have ≥3 release
 *   cycles of evidence. This script turns the per-run log lines into a
 *   multi-release evidence view so the threshold can be evaluated at a glance.
 *
 * Behavior:
 *   Default: uses `gh run list` to fetch the last N `publish-npm-on-tag.yml`
 *   runs, then `gh run view <id> --log` to scrape the two diagnostic tags from
 *   each run's logs, and prints a table summary plus aggregate MATCH/MISMATCH
 *   counts.
 *
 *   Test / offline mode: `--log-file <path>` parses a single saved log instead
 *   of calling `gh`. Useful for unit tests and local debugging without GH auth.
 *
 * Usage:
 *   cd cli && npm run collect:pack-sha-diagnostic --                  # last 10 runs
 *   cd cli && npm run collect:pack-sha-diagnostic -- --limit 20
 *   node cli/scripts/collect-pack-sha-diagnostic.mjs                    # direct path
 *   node cli/scripts/collect-pack-sha-diagnostic.mjs --limit 20
 *   node cli/scripts/collect-pack-sha-diagnostic.mjs --format json
 *   node cli/scripts/collect-pack-sha-diagnostic.mjs --workflow publish-npm-on-tag.yml
 *   node cli/scripts/collect-pack-sha-diagnostic.mjs --log-file /tmp/run.log
 *
 * How to read the output:
 *   - `MATCH` means the workflow's runner-local pack value matched the npm
 *     registry value for that release run.
 *   - `MISMATCH` means the runner-local pack value differed from registry
 *     truth. Treat it as investigation evidence, not an automatic release
 *     failure.
 *   - `unavailable` means the diagnostic ran but could not form a comparison
 *     (for example, registry metadata was not ready).
 *   - `missing` means the diagnostic tag was absent, usually because the run
 *     was an already-published rerun and skipped local packing.
 *   - Only non-rerun `MATCH` verdicts count toward the "≥3 MATCH" evidence
 *     threshold from `DEC-PUBLISH-WORKFLOW-PACK-SHA-DIAGNOSTIC-ONLY-001`.
 *     That threshold only permits designing a future gate; it is not a gate
 *     by itself.
 *
 * Diagnostic-only. This script does not gate releases, mutate state, or fail
 * on MISMATCH. It prints evidence; a gate is a future decision.
 */

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const DEFAULT_WORKFLOW = 'publish-npm-on-tag.yml';
const DEFAULT_LIMIT = 10;

/**
 * Parse a publish workflow log for the Turn 129 diagnostic tags.
 *
 * Returns a plain object with:
 *   - shaVerdict:       'MATCH' | 'MISMATCH' | 'unavailable' | 'missing'
 *   - shaDetail:        the line body after the ':' (MATCH/MISMATCH reason) or null
 *   - integrityVerdict: 'MATCH' | 'MISMATCH' | 'unavailable' | 'missing'
 *   - integrityDetail:  the line body after the ':' or null
 *   - version:          the `agentxchain@X.Y.Z` version extracted from the SHA tag, or null
 *
 * A log with no `PACK_SHA_DIAGNOSTIC:` tag returns shaVerdict = 'missing'
 * (the diagnostic step did not run — e.g. `already_published` rerun).
 *
 * A log whose SHA tag says "unavailable" (registry dist missing, runner pack
 * failed) returns shaVerdict = 'unavailable' — distinct from MATCH/MISMATCH
 * because the diagnostic could not form a verdict.
 */
export function parseDiagnosticLines(logText) {
  const shaRegex = /PACK_SHA_DIAGNOSTIC:\s*([^\n]+)/;
  const integrityRegex = /PACK_INTEGRITY_DIAGNOSTIC:\s*([^\n]+)/;

  const classifyVerdict = (detail) => {
    if (!detail) return 'missing';
    const head = detail.trim().split(/\s+/)[0] ?? '';
    if (head === 'MATCH') return 'MATCH';
    if (head === 'MISMATCH') return 'MISMATCH';
    return 'unavailable';
  };

  const shaMatch = logText.match(shaRegex);
  const integrityMatch = logText.match(integrityRegex);

  const shaDetail = shaMatch ? shaMatch[1].trim() : null;
  const integrityDetail = integrityMatch ? integrityMatch[1].trim() : null;

  const shaVerdict = shaMatch ? classifyVerdict(shaDetail) : 'missing';
  const integrityVerdict = integrityMatch
    ? classifyVerdict(integrityDetail)
    : 'missing';

  // Try to pull `agentxchain@X.Y.Z` from either diagnostic line.
  let version = null;
  const versionSource = `${shaDetail ?? ''} ${integrityDetail ?? ''}`;
  const versionMatch = versionSource.match(/agentxchain@(\d+\.\d+\.\d+)/);
  if (versionMatch) version = versionMatch[1];

  return { shaVerdict, shaDetail, integrityVerdict, integrityDetail, version };
}

/**
 * Render an array of run records as a fixed-width text table.
 * Pure function, no side effects — safe to call from tests.
 */
export function renderTable(rows) {
  if (rows.length === 0) {
    return 'No publish-npm-on-tag.yml runs found.';
  }
  const header = ['version', 'run_id', 'sha', 'integrity', 'created_at', 'url'];
  const body = rows.map((r) => [
    r.version ?? '-',
    String(r.runId ?? '-'),
    r.shaVerdict,
    r.integrityVerdict,
    r.createdAt ?? '-',
    r.url ?? '-',
  ]);
  const widths = header.map((h, i) =>
    Math.max(h.length, ...body.map((row) => row[i].length)),
  );
  const pad = (cells) =>
    cells.map((c, i) => c.padEnd(widths[i])).join('  ');
  const lines = [pad(header), pad(widths.map((w) => '-'.repeat(w)))];
  for (const row of body) lines.push(pad(row));
  return lines.join('\n');
}

/**
 * Summarize MATCH/MISMATCH/unavailable/missing counts across rows.
 * Used by `renderTable` callers to emit the "≥3 releases of MATCH" threshold
 * status described in DEC-PUBLISH-WORKFLOW-PACK-SHA-DIAGNOSTIC-ONLY-001.
 */
export function summarize(rows) {
  const count = (field) => {
    const tally = { MATCH: 0, MISMATCH: 0, unavailable: 0, missing: 0 };
    for (const r of rows) {
      const verdict = r[field];
      if (verdict in tally) tally[verdict] += 1;
    }
    return tally;
  };
  const sha = count('shaVerdict');
  const integrity = count('integrityVerdict');
  return { totalRuns: rows.length, sha, integrity };
}

function parseArgs(argv) {
  const args = {
    limit: DEFAULT_LIMIT,
    workflow: DEFAULT_WORKFLOW,
    format: 'table',
    logFile: null,
    repo: null,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--limit') {
      args.limit = Number(argv[i + 1]);
      i += 1;
    } else if (arg === '--workflow') {
      args.workflow = argv[i + 1];
      i += 1;
    } else if (arg === '--format') {
      args.format = argv[i + 1];
      i += 1;
    } else if (arg === '--log-file') {
      args.logFile = argv[i + 1];
      i += 1;
    } else if (arg === '--repo') {
      args.repo = argv[i + 1];
      i += 1;
    } else if (arg === '--help' || arg === '-h') {
      args.help = true;
    } else {
      throw new Error(`unknown argument: ${arg}`);
    }
  }
  if (!Number.isInteger(args.limit) || args.limit <= 0) {
    throw new Error(`--limit must be a positive integer, got: ${args.limit}`);
  }
  if (!['table', 'json'].includes(args.format)) {
    throw new Error(`--format must be "table" or "json", got: ${args.format}`);
  }
  return args;
}

function printHelp() {
  process.stdout.write(
    [
      'Usage: node cli/scripts/collect-pack-sha-diagnostic.mjs [options]',
      '',
      'Options:',
      '  --limit <N>         Number of recent runs to inspect (default: 10)',
      '  --workflow <name>   Workflow filename (default: publish-npm-on-tag.yml)',
      '  --format table|json Output format (default: table)',
      '  --log-file <path>   Parse a single saved log file instead of calling gh',
      '  --repo <owner/name> Override repo (defaults to gh current repo)',
      '  -h, --help          Show this help',
      '',
      'Emits MATCH/MISMATCH/unavailable/missing counts for PACK_SHA_DIAGNOSTIC',
      'and PACK_INTEGRITY_DIAGNOSTIC tags. Diagnostic-only; never fails.',
      '',
    ].join('\n'),
  );
}

function ghJson(args) {
  const out = execFileSync('gh', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  return JSON.parse(out);
}

function ghText(args) {
  return execFileSync('gh', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

function collectFromGh({ limit, workflow, repo }) {
  const listArgs = [
    'run', 'list',
    '--workflow', workflow,
    '--limit', String(limit),
    '--json', 'databaseId,displayTitle,conclusion,createdAt,url,headBranch,headSha',
  ];
  if (repo) listArgs.push('--repo', repo);

  let runs;
  try {
    runs = ghJson(listArgs);
  } catch (err) {
    throw new Error(
      `Failed to list workflow runs via gh. Is the GitHub CLI installed and authenticated? (${err.message})`,
    );
  }

  const rows = [];
  for (const run of runs) {
    const viewArgs = ['run', 'view', String(run.databaseId), '--log'];
    if (repo) viewArgs.push('--repo', repo);
    let log = '';
    try {
      log = ghText(viewArgs);
    } catch (err) {
      // gh run view --log fails when logs are expired (>90d) or mid-run.
      // Record the run with missing verdicts rather than aborting the whole sweep.
      rows.push({
        runId: run.databaseId,
        displayTitle: run.displayTitle,
        conclusion: run.conclusion,
        createdAt: run.createdAt,
        url: run.url,
        headBranch: run.headBranch,
        headSha: run.headSha,
        shaVerdict: 'missing',
        integrityVerdict: 'missing',
        shaDetail: null,
        integrityDetail: null,
        version: null,
        logError: err.message,
      });
      continue;
    }
    const parsed = parseDiagnosticLines(log);
    rows.push({
      runId: run.databaseId,
      displayTitle: run.displayTitle,
      conclusion: run.conclusion,
      createdAt: run.createdAt,
      url: run.url,
      headBranch: run.headBranch,
      headSha: run.headSha,
      ...parsed,
    });
  }
  return rows;
}

async function main(argv) {
  let args;
  try {
    args = parseArgs(argv);
  } catch (err) {
    process.stderr.write(`collect-pack-sha-diagnostic: ${err.message}\n`);
    printHelp();
    process.exit(2);
  }
  if (args.help) {
    printHelp();
    return;
  }

  let rows;
  if (args.logFile) {
    const log = readFileSync(args.logFile, 'utf8');
    rows = [{ runId: null, createdAt: null, url: args.logFile, ...parseDiagnosticLines(log) }];
  } else {
    rows = collectFromGh({ limit: args.limit, workflow: args.workflow, repo: args.repo });
  }

  if (args.format === 'json') {
    process.stdout.write(JSON.stringify({ rows, summary: summarize(rows) }, null, 2));
    process.stdout.write('\n');
    return;
  }

  const table = renderTable(rows);
  const summary = summarize(rows);
  process.stdout.write(`${table}\n\n`);
  process.stdout.write(
    [
      `Runs inspected:        ${summary.totalRuns}`,
      `SHA MATCH:             ${summary.sha.MATCH}`,
      `SHA MISMATCH:          ${summary.sha.MISMATCH}`,
      `SHA unavailable:       ${summary.sha.unavailable}`,
      `SHA missing:           ${summary.sha.missing}  (rerun / no diagnostic)`,
      `INTEGRITY MATCH:       ${summary.integrity.MATCH}`,
      `INTEGRITY MISMATCH:    ${summary.integrity.MISMATCH}`,
      `INTEGRITY unavailable: ${summary.integrity.unavailable}`,
      `INTEGRITY missing:     ${summary.integrity.missing}`,
      '',
      'Diagnostic-only. ≥3 MATCH on both SHA + INTEGRITY is the threshold',
      'named in DEC-PUBLISH-WORKFLOW-PACK-SHA-DIAGNOSTIC-ONLY-001 before any',
      'reproducible-publish gate can be designed.',
      '',
    ].join('\n'),
  );
}

// Only run main when invoked directly (not when imported by tests).
const invokedDirectly =
  import.meta.url === `file://${process.argv[1]}` ||
  (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/^.*\//, '')));

if (invokedDirectly) {
  main(process.argv.slice(2)).catch((err) => {
    process.stderr.write(`collect-pack-sha-diagnostic: ${err.stack || err.message}\n`);
    process.exit(1);
  });
}
