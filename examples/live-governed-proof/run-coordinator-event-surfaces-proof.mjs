#!/usr/bin/env node

/**
 * Coordinator Event Surfaces — Proof Script
 *
 * Proves that coordinator exports and governance reports include
 * aggregated child-repo lifecycle events as a durable snapshot.
 *
 * This proof:
 * 1. Scaffolds a coordinator workspace with 2 child repos + events
 * 2. Runs `agentxchain export --format json` and verifies aggregated_events
 * 3. Runs `agentxchain report --format json` and verifies aggregated_event_timeline
 * 4. Runs `agentxchain report --format text` and verifies section header
 * 5. Runs `agentxchain report --format markdown` and verifies table
 * 6. Runs `agentxchain report --format html` and verifies section
 *
 * Usage:
 *   node examples/live-governed-proof/run-coordinator-event-surfaces-proof.mjs [--json]
 *
 * Exit codes:
 *   0 — proof passed
 *   1 — proof failed
 */

import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, '..', '..');
const CLI_BIN = join(repoRoot, 'cli', 'bin', 'agentxchain.js');
const jsonMode = process.argv.includes('--json');

function writeJson(path, value) {
  writeFileSync(path, JSON.stringify(value, null, 2) + '\n');
}

function writeJsonl(path, entries) {
  writeFileSync(path, entries.map((e) => JSON.stringify(e)).join('\n') + '\n');
}

function runCli(cwd, args) {
  return spawnSync(process.execPath, [CLI_BIN, ...args], {
    cwd,
    encoding: 'utf8',
    timeout: 15000,
    env: { ...process.env, NODE_NO_WARNINGS: '1' },
  });
}

const checks = [];
function check(name, passed, detail) {
  checks.push({ name, passed, detail });
  if (!jsonMode) {
    console.log(`${passed ? '✓' : '✗'} ${name}${detail ? ': ' + detail : ''}`);
  }
}

// Scaffold coordinator workspace
const root = join(tmpdir(), `axc-coord-evt-surf-proof-${Date.now()}`);
mkdirSync(root, { recursive: true });

function createChildRepo(repoDir, repoId) {
  mkdirSync(join(repoDir, '.agentxchain', 'dispatch'), { recursive: true });
  writeJson(join(repoDir, 'agentxchain.json'), {
    schema_version: '1.0',
    template: 'generic',
    project: { id: repoId, name: `Repo ${repoId}`, default_branch: 'main' },
    roles: { dev: { title: 'Dev', mandate: 'Build', write_authority: 'authoritative', runtime: 'r1' } },
    runtimes: { r1: { type: 'local_cli', command: ['echo'], prompt_transport: 'argv' } },
    routing: { implementation: { entry_role: 'dev' } },
    gates: {},
    hooks: {},
  });
  writeJson(join(repoDir, '.agentxchain', 'state.json'), {
    schema_version: '1.1',
    project_id: repoId,
    run_id: `run_${repoId}_001`,
    status: 'active',
    phase: 'implementation',
    active_turns: {},
    retained_turns: {},
    turn_sequence: 0,
    blocked_on: null,
    phase_gate_status: {},
    budget_status: { spent_usd: 0, remaining_usd: 10 },
    protocol_mode: 'governed',
  });
}

try {
  createChildRepo(join(root, 'repos', 'web'), 'web');
  createChildRepo(join(root, 'repos', 'api'), 'api');

  // Write interleaved events
  writeJsonl(join(root, 'repos', 'web', '.agentxchain', 'events.jsonl'), [
    { event_id: 'evt_w1', event_type: 'run_started', timestamp: '2026-04-15T05:00:00Z', run_id: 'run_web_001' },
    { event_id: 'evt_w2', event_type: 'turn_dispatched', timestamp: '2026-04-15T05:01:00Z', run_id: 'run_web_001' },
    { event_id: 'evt_w3', event_type: 'turn_accepted', timestamp: '2026-04-15T05:02:00Z', run_id: 'run_web_001' },
  ]);
  writeJsonl(join(root, 'repos', 'api', '.agentxchain', 'events.jsonl'), [
    { event_id: 'evt_a1', event_type: 'run_started', timestamp: '2026-04-15T05:00:30Z', run_id: 'run_api_001' },
    { event_id: 'evt_a2', event_type: 'turn_dispatched', timestamp: '2026-04-15T05:01:30Z', run_id: 'run_api_001' },
  ]);

  // Coordinator config + state
  writeJson(join(root, 'agentxchain-multi.json'), {
    schema_version: '0.1',
    project: { id: 'surf-proof', name: 'Surfaces Proof' },
    repos: {
      web: { path: './repos/web', default_branch: 'main', required: true },
      api: { path: './repos/api', default_branch: 'main', required: true },
    },
    workstreams: { core: { phase: 'implementation', repos: ['web', 'api'], entry_repo: 'web', depends_on: [], completion_barrier: 'all_repos_accepted' } },
    routing: { implementation: { entry_workstream: 'core' } },
    gates: {},
    hooks: {},
  });
  mkdirSync(join(root, '.agentxchain', 'multirepo'), { recursive: true });
  writeJson(join(root, '.agentxchain', 'multirepo', 'state.json'), {
    schema_version: '0.1', super_run_id: 'srun_001', project_id: 'surf-proof', status: 'active', phase: 'implementation',
    repo_runs: { web: { run_id: 'run_web_001', status: 'linked', phase: 'implementation' }, api: { run_id: 'run_api_001', status: 'linked', phase: 'implementation' } },
    pending_gate: null, phase_gate_status: {}, created_at: '2026-04-15T05:00:00Z', updated_at: '2026-04-15T05:02:00Z',
  });
  writeJsonl(join(root, '.agentxchain', 'multirepo', 'history.jsonl'), [{ type: 'run_initialized', timestamp: '2026-04-15T05:00:00Z' }]);
  writeJson(join(root, '.agentxchain', 'multirepo', 'barriers.json'), {});
  writeJsonl(join(root, '.agentxchain', 'multirepo', 'decision-ledger.jsonl'), []);
  writeJsonl(join(root, '.agentxchain', 'multirepo', 'barrier-ledger.jsonl'), []);

  // 1. Export
  const exportResult = runCli(root, ['export', '--format', 'json']);
  check('export exits 0', exportResult.status === 0, `status=${exportResult.status}`);

  let exported;
  try { exported = JSON.parse(exportResult.stdout); } catch { exported = null; }

  check('export has aggregated_events', exported?.summary?.aggregated_events != null);
  const agg = exported?.summary?.aggregated_events;
  check('total_events is 5', agg?.total_events === 5, `got ${agg?.total_events}`);
  check('repos_with_events sorted', JSON.stringify(agg?.repos_with_events) === '["api","web"]');
  check('events sorted by timestamp', agg?.events?.length === 5 && agg.events[0].event_id === 'evt_w1' && agg.events[1].event_id === 'evt_a1');
  check('event_type_counts correct', agg?.event_type_counts?.run_started === 2 && agg?.event_type_counts?.turn_dispatched === 2 && agg?.event_type_counts?.turn_accepted === 1);

  // Save export for report input
  const artifactPath = join(root, 'export.json');
  writeFileSync(artifactPath, exportResult.stdout);

  // 2. Report JSON
  const jsonReport = runCli(root, ['report', '--input', artifactPath, '--format', 'json']);
  check('json report exits 0', jsonReport.status === 0);
  let report;
  try { report = JSON.parse(jsonReport.stdout); } catch { report = null; }
  check('json report has aggregated_event_timeline', Array.isArray(report?.subject?.aggregated_event_timeline));
  check('aggregated_event_timeline has 5 entries', report?.subject?.aggregated_event_timeline?.length === 5);
  const firstEvt = report?.subject?.aggregated_event_timeline?.[0];
  check('first event has repo_id', firstEvt?.repo_id === 'web');
  check('first event has summary', firstEvt?.summary?.includes('[web]'));

  // 3. Report text
  const textReport = runCli(root, ['report', '--input', artifactPath, '--format', 'text']);
  check('text report has section header', textReport.stdout.includes('Aggregated Child Repo Events:'));
  check('text report has web events', textReport.stdout.includes('[web] run_started'));
  check('text report has api events', textReport.stdout.includes('[api] run_started'));

  // 4. Report markdown
  const mdReport = runCli(root, ['report', '--input', artifactPath, '--format', 'markdown']);
  check('md report has heading', mdReport.stdout.includes('## Aggregated Child Repo Events'));
  check('md report has table header', mdReport.stdout.includes('| Timestamp | Repo | Event Type | Summary |'));

  // 5. Report HTML
  const htmlReport = runCli(root, ['report', '--input', artifactPath, '--format', 'html']);
  check('html report has section', htmlReport.stdout.includes('Aggregated Child Repo Events'));
  check('html report has web badge', htmlReport.stdout.includes('web'));

  // Summary
  const passed = checks.filter((c) => c.passed).length;
  const total = checks.length;
  const allPassed = passed === total;

  if (jsonMode) {
    console.log(JSON.stringify({ passed, total, all_passed: allPassed, checks }, null, 2));
  } else {
    console.log(`\n${allPassed ? 'PASS' : 'FAIL'}: ${passed}/${total} checks passed`);
  }

  process.exitCode = allPassed ? 0 : 1;
} finally {
  rmSync(root, { recursive: true, force: true });
}
