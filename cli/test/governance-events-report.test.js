import { strict as assert } from 'node:assert';
import { describe, it, afterEach } from 'vitest';
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  rmSync,
} from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI_BIN = join(__dirname, '..', 'bin', 'agentxchain.js');

function writeJson(filePath, value) {
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, JSON.stringify(value, null, 2) + '\n');
}

function writeJsonl(filePath, entries) {
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, entries.map((entry) => JSON.stringify(entry)).join('\n') + '\n');
}

function runCli(cwd, args, extra = {}) {
  return spawnSync(process.execPath, [CLI_BIN, ...args], {
    cwd,
    encoding: 'utf8',
    timeout: 15000,
    env: { ...process.env, NODE_NO_WARNINGS: '1' },
    ...extra,
  });
}

function createGovernedProject(ledgerEntries = []) {
  const root = mkdtempSync(join(tmpdir(), 'axc-gov-events-'));
  mkdirSync(join(root, '.agentxchain', 'dispatch', 'turns', 'turn_001'), { recursive: true });
  mkdirSync(join(root, '.agentxchain', 'staging', 'turn_001'), { recursive: true });
  mkdirSync(join(root, '.agentxchain', 'transactions', 'accept', 'txn_001'), { recursive: true });
  mkdirSync(join(root, '.agentxchain', 'intake', 'events'), { recursive: true });

  writeJson(join(root, 'agentxchain.json'), {
    schema_version: '1.0',
    template: 'generic',
    project: { id: 'gov-events-test', name: 'Governance Events Test', default_branch: 'main' },
    roles: {
      dev: {
        title: 'Developer',
        mandate: 'Implement safely.',
        write_authority: 'authoritative',
        runtime: 'local-dev',
      },
    },
    runtimes: { 'local-dev': { type: 'local_cli', adapter: 'claude' } },
    routing: { planning: { entry_role: 'dev' } },
  });

  writeJson(join(root, '.agentxchain', 'state.json'), {
    schema_version: '1.1',
    project_id: 'gov-events-test',
    run_id: 'run_gov_events_001',
    status: 'completed',
    phase: 'planning',
    turn_sequence: 2,
    active_turns: {},
    retained_turns: {},
    protocol_mode: 'governed',
    created_at: '2026-04-12T08:00:00.000Z',
    completed_at: '2026-04-12T10:00:00.000Z',
  });

  writeJsonl(join(root, '.agentxchain', 'history.jsonl'), [{
    turn_id: 'turn_001',
    role: 'dev',
    phase: 'planning',
    status: 'accepted',
    accepted_sequence: 1,
    accepted_at: '2026-04-12T09:00:00.000Z',
    started_at: '2026-04-12T08:55:00.000Z',
    duration_ms: 300000,
    summary: 'Initial planning turn',
    decisions: [],
    objections: [],
    files_changed: [],
    cost: { total_usd: 0.05 },
  }]);

  writeJsonl(join(root, '.agentxchain', 'decision-ledger.jsonl'), ledgerEntries);

  return root;
}

function exportAndReport(root, format = 'json') {
  const artifactPath = join(root, 'artifact.json');
  const exp = runCli(root, ['export', '--output', 'artifact.json']);
  assert.equal(exp.status, 0, `export failed: ${exp.stderr}\n${exp.stdout}`);
  const result = runCli(root, ['report', '--input', artifactPath, '--format', format]);
  assert.equal(result.status, 0, `report (${format}) failed: stderr=${result.stderr}\nstdout=${result.stdout.substring(0, 500)}`);
  return result;
}

const roots = [];
afterEach(() => {
  for (const root of roots) {
    try { rmSync(root, { recursive: true, force: true }); } catch { /* ignore */ }
  }
  roots.length = 0;
});

describe('governance events in report', () => {
  it('report JSON includes governance_events when policy_escalation exists', () => {
    const root = createGovernedProject([
      {
        timestamp: '2026-04-12T09:01:00.000Z',
        decision: 'policy_escalation',
        turn_id: 'turn_002',
        role: 'dev',
        phase: 'planning',
        violations: [
          { policy_id: 'budget-guard', rule: 'per_turn_max', message: 'Turn cost exceeded $5.00 limit' },
        ],
      },
    ]);
    roots.push(root);

    const result = exportAndReport(root, 'json');
    const report = JSON.parse(result.stdout);
    const govEvents = report.subject.run.governance_events;
    assert.ok(Array.isArray(govEvents), 'governance_events should be an array');
    assert.equal(govEvents.length, 1);
    assert.equal(govEvents[0].type, 'policy_escalation');
    assert.equal(govEvents[0].role, 'dev');
    assert.equal(govEvents[0].phase, 'planning');
    assert.ok(Array.isArray(govEvents[0].violations));
    assert.equal(govEvents[0].violations[0].policy_id, 'budget-guard');
    assert.equal(govEvents[0].violations[0].message, 'Turn cost exceeded $5.00 limit');
  });

  it('report JSON includes governance_events when conflict_detected exists', () => {
    const root = createGovernedProject([
      {
        timestamp: '2026-04-12T09:02:00.000Z',
        decision: 'conflict_detected',
        turn_id: 'turn_003',
        role: 'dev',
        phase: 'planning',
        attempt: 1,
        conflict: {
          conflicting_files: ['src/index.js', 'src/lib.js'],
          accepted_since_turn_ids: ['turn_001', 'turn_002'],
          overlap_ratio: 0.75,
        },
      },
    ]);
    roots.push(root);

    const result = exportAndReport(root, 'json');
    const report = JSON.parse(result.stdout);
    const govEvents = report.subject.run.governance_events;
    assert.equal(govEvents.length, 1);
    assert.equal(govEvents[0].type, 'conflict_detected');
    assert.deepStrictEqual(govEvents[0].conflicting_files, ['src/index.js', 'src/lib.js']);
    assert.deepStrictEqual(govEvents[0].accepted_since_turn_ids, ['turn_001', 'turn_002']);
    assert.equal(govEvents[0].overlap_ratio, 0.75);
  });

  it('report text output shows real conflict ledger details', () => {
    const root = createGovernedProject([
      {
        timestamp: '2026-04-12T09:02:00.000Z',
        decision: 'conflict_detected',
        turn_id: 'turn_003',
        role: 'dev',
        phase: 'planning',
        attempt: 1,
        conflict: {
          conflicting_files: ['src/index.js', 'src/lib.js'],
          accepted_since_turn_ids: ['turn_001'],
          overlap_ratio: 0.75,
        },
      },
    ]);
    roots.push(root);

    const result = exportAndReport(root, 'text');
    assert.ok(result.stdout.includes('Governance Events:'), 'text output should contain Governance Events section');
    assert.ok(result.stdout.includes('files: src/index.js, src/lib.js'), 'text output should contain conflict files');
    assert.ok(result.stdout.includes('accepted since: turn_001'), 'text output should contain accepted-since turn ids');
    assert.ok(result.stdout.includes('overlap: 75%'), 'text output should contain overlap percentage');
  });

  it('report text output shows Governance Events section when events exist', () => {
    const root = createGovernedProject([
      {
        timestamp: '2026-04-12T09:01:00.000Z',
        decision: 'operator_escalated',
        run_id: 'run_gov_events_001',
        phase: 'planning',
        blocked_on: 'human_review',
        escalation: { reason: 'Needs architecture review' },
      },
      {
        timestamp: '2026-04-12T09:05:00.000Z',
        decision: 'escalation_resolved',
        run_id: 'run_gov_events_001',
        phase: 'planning',
        resolved_via: 'operator_unblock',
        blocked_on: 'human_review',
      },
    ]);
    roots.push(root);

    const result = exportAndReport(root, 'text');
    assert.ok(result.stdout.includes('Governance Events:'), 'text output should contain Governance Events section');
    assert.ok(result.stdout.includes('operator_escalated'), 'text output should contain event type');
    assert.ok(result.stdout.includes('escalation_resolved'), 'text output should contain event type');
    assert.ok(result.stdout.includes('Needs architecture review'), 'text output should contain reason');
    assert.ok(result.stdout.includes('operator_unblock'), 'text output should contain resolution');
  });

  it('report omits governance events section when no governance events exist', () => {
    const root = createGovernedProject([
      {
        id: 'DEC-001',
        turn_id: 'turn_001',
        role: 'dev',
        phase: 'planning',
        category: 'architecture',
        statement: 'Use ESM modules',
        rationale: 'Modern standard',
        status: 'active',
        created_at: '2026-04-12T09:00:00.000Z',
      },
    ]);
    roots.push(root);

    const result = exportAndReport(root, 'text');
    assert.ok(!result.stdout.includes('Governance Events:'), 'text output should not contain Governance Events section');
  });

  it('governance events are sorted chronologically', () => {
    const root = createGovernedProject([
      {
        timestamp: '2026-04-12T09:05:00.000Z',
        decision: 'escalation_resolved',
        run_id: 'run_gov_events_001',
        phase: 'planning',
        resolved_via: 'operator_unblock',
        blocked_on: 'human_review',
      },
      {
        timestamp: '2026-04-12T09:01:00.000Z',
        decision: 'operator_escalated',
        run_id: 'run_gov_events_001',
        phase: 'planning',
        blocked_on: 'human_review',
        escalation: { reason: 'Needs review' },
      },
    ]);
    roots.push(root);

    const result = exportAndReport(root, 'json');
    const report = JSON.parse(result.stdout);
    const govEvents = report.subject.run.governance_events;
    assert.equal(govEvents.length, 2);
    assert.equal(govEvents[0].type, 'operator_escalated', 'earlier event should come first');
    assert.equal(govEvents[1].type, 'escalation_resolved', 'later event should come second');
  });

  it('report markdown output includes Governance Events heading', () => {
    const root = createGovernedProject([
      {
        timestamp: '2026-04-12T09:01:00.000Z',
        decision: 'conflict_rejected',
        turn_id: 'turn_002',
        role: 'dev',
        phase: 'planning',
        attempt: 1,
        conflict: {
          conflicting_files: ['README.md'],
          accepted_since_turn_ids: ['turn_001'],
        },
        operator_reason: 'Rejected until the README branch is rebased.',
      },
    ]);
    roots.push(root);

    const result = exportAndReport(root, 'markdown');
    assert.ok(result.stdout.includes('## Governance Events'), 'markdown output should contain Governance Events heading');
    assert.ok(result.stdout.includes('conflict_rejected'), 'markdown output should contain event type');
    assert.ok(result.stdout.includes('`README.md`'), 'markdown output should contain file reference');
    assert.ok(result.stdout.includes('`turn_001`'), 'markdown output should contain accepted-since turn id');
    assert.ok(result.stdout.includes('Rejected until the README branch is rebased.'), 'markdown output should contain operator reason');
  });

  it('report HTML output includes conflict resolution details from the real ledger shape', () => {
    const root = createGovernedProject([
      {
        timestamp: '2026-04-12T09:03:00.000Z',
        decision: 'conflict_resolution_selected',
        turn_id: 'turn_004',
        role: 'dev',
        phase: 'planning',
        conflict: {
          conflicting_files: ['src/conflict.js'],
          accepted_since_turn_ids: ['turn_002'],
          overlap_ratio: 0.5,
        },
        resolution_chosen: 'human_merge',
      },
    ]);
    roots.push(root);

    const result = exportAndReport(root, 'html');
    assert.ok(result.stdout.includes('Governance Events'), 'html output should contain Governance Events heading');
    assert.ok(result.stdout.includes('src/conflict.js'), 'html output should contain conflict file');
    assert.ok(result.stdout.includes('turn_002'), 'html output should contain accepted-since turn id');
    assert.ok(result.stdout.includes('Resolution: <code>human_merge</code>'), 'html output should contain chosen resolution');
  });
});
