import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  evaluateShipStatus,
  evaluateCoordinatorShipStatus,
  buildShipStatusSummary,
  aggregateShipStatus,
  SHIP_STATUS_DIMENSIONS,
} from '../src/lib/ship-status.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const BIN = join(__dirname, '..', 'bin', 'agentxchain.js');

// ── fixtures ────────────────────────────────────────────────────────────────

// Minimal valid governed v4 config with the planning→implementation→qa routing.
const GOVERNED_CONFIG = {
  schema_version: 4,
  protocol_mode: 'governed',
  template: 'generic',
  project: { id: 'p1', name: 'P1' },
  roles: {
    dev: { title: 'Dev', mandate: 'build', write_authority: 'authoritative', runtime: 'local' },
  },
  runtimes: { local: { type: 'local_cli' } },
  routing: {
    planning: { entry_role: 'dev', allowed_next_roles: ['dev'], exit_gate: 'planning_signoff' },
    implementation: { entry_role: 'dev', allowed_next_roles: ['dev'], exit_gate: 'implementation_complete' },
    qa: { entry_role: 'dev', allowed_next_roles: ['dev'], exit_gate: 'qa_ship_verdict' },
  },
  gates: { planning_signoff: {}, implementation_complete: {}, qa_ship_verdict: {} },
};

const ALL_PASSED_GATES = {
  planning_signoff: 'passed',
  implementation_complete: 'passed',
  qa_ship_verdict: 'passed',
};

const PASS_RELEASE = () => ({ ok: true, checkedSurfaceCount: 3 });
const FAIL_RELEASE = () => ({ ok: false, errors: [{ message: 'changelog missing target version section' }] });

let tmpDirs = [];
function tmp(prefix = 'ship-status-') {
  const d = mkdtempSync(join(tmpdir(), prefix));
  tmpDirs.push(d);
  return d;
}

function writeGovernedRepo({ state, history, verdict, config = GOVERNED_CONFIG } = {}) {
  const dir = tmp();
  writeFileSync(join(dir, 'agentxchain.json'), JSON.stringify(config));
  mkdirSync(join(dir, '.agentxchain'), { recursive: true });
  if (state) writeFileSync(join(dir, '.agentxchain', 'state.json'), JSON.stringify(state));
  if (history) {
    writeFileSync(
      join(dir, '.agentxchain', 'history.jsonl'),
      history.map((h) => JSON.stringify(h)).join('\n'),
    );
  }
  if (verdict != null) {
    mkdirSync(join(dir, '.planning'), { recursive: true });
    writeFileSync(join(dir, '.planning', 'ship-verdict.md'), verdict);
  }
  return dir;
}

function verifications(...statuses) {
  return statuses.map((s, i) => ({ turn_id: `t${i}`, verification: { status: s } }));
}

function completedState(gateOverrides = {}) {
  return {
    status: 'completed',
    phase: 'qa',
    phase_gate_status: { ...ALL_PASSED_GATES, ...gateOverrides },
  };
}

function dim(report, name) {
  return report.dimensions.find((d) => d.name === name);
}

afterEach(() => {
  for (const d of tmpDirs) {
    try { rmSync(d, { recursive: true, force: true }); } catch { /* ignore */ }
  }
  tmpDirs = [];
});

// ── single-repo acceptance tests ──────────────────────────────────────────────

describe('ship-status — single repo', () => {
  it('AT-SS-001: all 5 dimensions pass → overall pass, 0 blocking reasons', () => {
    const dir = writeGovernedRepo({
      state: completedState(),
      history: verifications('pass', 'pass', 'pass'),
      verdict: '## Verdict: YES',
    });
    const report = evaluateShipStatus(dir, { releaseAlignmentEvaluator: PASS_RELEASE });
    expect(report.overall).toBe('pass');
    expect(report.dimensions).toHaveLength(5);
    expect(report.dimensions.every((d) => d.status === 'pass')).toBe(true);
    expect(report.blocking_reasons).toHaveLength(0);
    expect(report.evidence_summary).toContain('5/5');
  });

  it('AT-SS-002: run still running → overall pending, run dimension blocks', () => {
    const dir = writeGovernedRepo({
      state: {
        status: 'active',
        phase: 'implementation',
        phase_gate_status: { planning_signoff: 'passed', implementation_complete: 'pending', qa_ship_verdict: 'pending' },
      },
      history: verifications('pass'),
      verdict: null,
    });
    const report = evaluateShipStatus(dir, { releaseAlignmentEvaluator: PASS_RELEASE });
    expect(report.overall).toBe('pending');
    const runDim = dim(report, 'run_completion');
    expect(runDim.status).toBe('pending');
    expect(runDim.blocking_reason).toContain('active');
    expect(report.blocking_reasons.some((r) => r.includes('completion'))).toBe(true);
  });

  it('AT-SS-003: run failed → overall fail, run dimension cites failure', () => {
    const dir = writeGovernedRepo({
      state: { status: 'failed', phase: 'implementation', phase_gate_status: {} },
      history: verifications('pass'),
    });
    const report = evaluateShipStatus(dir, { releaseAlignmentEvaluator: PASS_RELEASE });
    expect(report.overall).toBe('fail');
    expect(dim(report, 'run_completion').status).toBe('fail');
    expect(report.blocking_reasons.some((r) => r.includes('failed'))).toBe(true);
  });

  it('AT-SS-004: QA ship verdict missing after QA phase → overall fail', () => {
    const dir = writeGovernedRepo({
      state: completedState(),
      history: verifications('pass'),
      verdict: null, // no ship-verdict.md
    });
    const report = evaluateShipStatus(dir, { releaseAlignmentEvaluator: PASS_RELEASE });
    expect(report.overall).toBe('fail');
    const qa = dim(report, 'qa_ship_verdict');
    expect(qa.status).toBe('fail');
    expect(qa.blocking_reason).toContain('missing');
  });

  it('AT-SS-005: QA ship verdict says NO → overall fail', () => {
    const dir = writeGovernedRepo({
      state: completedState(),
      history: verifications('pass'),
      verdict: '## Verdict: NO',
    });
    const report = evaluateShipStatus(dir, { releaseAlignmentEvaluator: PASS_RELEASE });
    expect(report.overall).toBe('fail');
    expect(dim(report, 'qa_ship_verdict').status).toBe('fail');
  });

  it('AT-SS-006: a phase gate failed → overall fail, gate dimension cites gate', () => {
    const dir = writeGovernedRepo({
      state: completedState({ planning_signoff: 'failed' }),
      history: verifications('pass'),
      verdict: '## Verdict: YES',
    });
    const report = evaluateShipStatus(dir, { releaseAlignmentEvaluator: PASS_RELEASE });
    expect(report.overall).toBe('fail');
    const gate = dim(report, 'gate_clearance');
    expect(gate.status).toBe('fail');
    expect(gate.blocking_reason).toContain('planning_signoff');
  });

  it('AT-SS-007: release alignment fails → overall fail, alignment dimension cites it', () => {
    const dir = writeGovernedRepo({
      state: completedState(),
      history: verifications('pass'),
      verdict: '## Verdict: YES',
    });
    const report = evaluateShipStatus(dir, { releaseAlignmentEvaluator: FAIL_RELEASE });
    expect(report.overall).toBe('fail');
    const rel = dim(report, 'release_alignment');
    expect(rel.status).toBe('fail');
    expect(rel.blocking_reason).toContain('changelog');
  });

  it('AT-SS-008: a turn failed verification → overall fail', () => {
    const dir = writeGovernedRepo({
      state: completedState(),
      history: verifications('pass', 'fail'),
      verdict: '## Verdict: YES',
    });
    const report = evaluateShipStatus(dir, { releaseAlignmentEvaluator: PASS_RELEASE });
    expect(report.overall).toBe('fail');
    expect(dim(report, 'test_verification').status).toBe('fail');
  });

  it('release alignment defaults to pending pre-release (no injection, no package/changelog)', () => {
    const dir = writeGovernedRepo({
      state: completedState(),
      history: verifications('pass'),
      verdict: '## Verdict: YES',
    });
    // No releaseAlignmentEvaluator → real validateReleaseAlignment throws (ENOENT) → pending.
    const report = evaluateShipStatus(dir);
    expect(dim(report, 'release_alignment').status).toBe('pending');
  });

  it('is read-only: never mutates the governed state file', () => {
    const dir = writeGovernedRepo({
      state: completedState(),
      history: verifications('pass'),
      verdict: '## Verdict: YES',
    });
    const before = readFileSync(join(dir, '.agentxchain', 'state.json'), 'utf8');
    evaluateShipStatus(dir, { releaseAlignmentEvaluator: PASS_RELEASE });
    const after = readFileSync(join(dir, '.agentxchain', 'state.json'), 'utf8');
    expect(after).toBe(before);
  });

  it('returns fail when not a governed project', () => {
    const dir = tmp();
    const report = evaluateShipStatus(dir);
    expect(report.overall).toBe('fail');
    expect(report.dimensions).toHaveLength(0);
    expect(report.blocking_reasons[0]).toContain('Not a governed');
  });
});

// ── coordinator acceptance tests ──────────────────────────────────────────────

describe('ship-status — coordinator', () => {
  function coordinatorConfig(paths) {
    return {
      project: { id: 'c', name: 'C' },
      repo_order: Object.keys(paths),
      repos: Object.fromEntries(Object.entries(paths).map(([id, path]) => [id, { path }])),
      routing: GOVERNED_CONFIG.routing,
      gates: GOVERNED_CONFIG.gates,
    };
  }

  it('AT-SS-009: all repos pass → overall pass', () => {
    const a = writeGovernedRepo({ state: completedState(), history: verifications('pass'), verdict: '## Verdict: YES' });
    const b = writeGovernedRepo({ state: completedState(), history: verifications('pass'), verdict: '## Verdict: YES' });
    const report = evaluateCoordinatorShipStatus('/', {
      coordinatorConfig: coordinatorConfig({ 'repo-a': a, 'repo-b': b }),
      releaseAlignmentEvaluator: PASS_RELEASE,
    });
    expect(report.overall).toBe('pass');
    expect(report.repos).toHaveLength(2);
    expect(report.blocking_repos).toHaveLength(0);
  });

  it('AT-SS-010: mixed states (2 pass, 1 fail) → overall fail, blocking_repos lists the failing repo', () => {
    const a = writeGovernedRepo({ state: completedState(), history: verifications('pass'), verdict: '## Verdict: YES' });
    const b = writeGovernedRepo({ state: completedState(), history: verifications('pass'), verdict: '## Verdict: YES' });
    const c = writeGovernedRepo({ state: { status: 'failed', phase: 'qa', phase_gate_status: {} }, history: verifications('pass'), verdict: '## Verdict: YES' });
    const report = evaluateCoordinatorShipStatus('/', {
      coordinatorConfig: coordinatorConfig({ 'repo-a': a, 'repo-b': b, 'repo-c': c }),
      releaseAlignmentEvaluator: PASS_RELEASE,
    });
    expect(report.overall).toBe('fail');
    expect(report.blocking_repos).toEqual(['repo-c']);
    const entryC = report.repos.find((r) => r.repo_id === 'repo-c');
    expect(entryC.ship_status.overall).toBe('fail');
  });

  it('reports fail when the coordinator config cannot be loaded', () => {
    const dir = tmp(); // no agentxchain-multi.json
    const report = evaluateCoordinatorShipStatus(dir);
    expect(report.overall).toBe('fail');
    expect(report.repos).toHaveLength(0);
    expect(report.evidence_summary).toContain('Cannot load coordinator config');
  });
});

// ── CLI acceptance tests ──────────────────────────────────────────────────────

describe('ship-status — CLI', () => {
  function cliFixture() {
    return writeGovernedRepo({
      state: completedState(),
      history: verifications('pass'),
      verdict: '## Verdict: YES',
    });
  }

  it('AT-SS-011: --json output matches the ShipStatusReport schema', () => {
    const dir = cliFixture();
    const res = spawnSync('node', [BIN, 'ship-status', '--dir', dir, '--json'], { encoding: 'utf8' });
    const report = JSON.parse(res.stdout);
    expect(report).toHaveProperty('overall');
    expect(report).toHaveProperty('blocking_reasons');
    expect(report).toHaveProperty('evidence_summary');
    expect(Array.isArray(report.dimensions)).toBe(true);
    expect(report.dimensions.map((d) => d.name)).toEqual(SHIP_STATUS_DIMENSIONS);
    for (const d of report.dimensions) {
      expect(d).toHaveProperty('name');
      expect(d).toHaveProperty('status');
      expect(d).toHaveProperty('detail');
      expect(d).toHaveProperty('blocking_reason');
    }
  });

  it('AT-SS-012: --verbose shows all five dimension names', () => {
    const dir = cliFixture();
    const res = spawnSync('node', [BIN, 'ship-status', '--dir', dir, '--verbose'], { encoding: 'utf8' });
    for (const name of SHIP_STATUS_DIMENSIONS) {
      expect(res.stdout).toContain(name);
    }
    expect(res.stdout).toContain('Ship Status:');
  });
});

// ── governance-report integration (AC-4) ──────────────────────────────────────

describe('ship-status — governance report integration', () => {
  const config = { gates: GOVERNED_CONFIG.gates, routing: GOVERNED_CONFIG.routing };

  it('buildShipStatusSummary derives the compact summary from an export artifact', () => {
    const artifact = {
      state: completedState(),
      config,
      files: {
        '.agentxchain/history.jsonl': { data: verifications('pass', 'pass').map((h) => JSON.stringify(h)).join('\n') },
      },
    };
    const summary = buildShipStatusSummary(artifact);
    expect(summary.dimensions_total).toBe(5);
    // run_completion, qa (gate passed), gate_clearance, test_verification pass; release pending from artifact.
    expect(summary.dimensions_passed).toBe(4);
    expect(summary.overall).toBe('pending');
    expect(summary.blocking_reasons.some((r) => r.includes('Release alignment'))).toBe(true);
  });

  it('buildShipStatusSummary reads a base64 history file and a verdict file', () => {
    const artifact = {
      state: { status: 'completed', phase: 'qa', phase_gate_status: {} },
      config,
      files: {
        '.agentxchain/history.jsonl': { content_base64: Buffer.from(verifications('pass').map((h) => JSON.stringify(h)).join('\n')).toString('base64') },
        '.planning/ship-verdict.md': { data: '## Verdict: YES' },
      },
    };
    const summary = buildShipStatusSummary(artifact);
    expect(summary.overall).toBeDefined();
    // verdict file affirmative → qa dimension passes even though gate status absent.
    expect(summary.dimensions_total).toBe(5);
  });

  it('buildShipStatusSummary returns null for a null artifact', () => {
    expect(buildShipStatusSummary(null)).toBeNull();
  });
});

// ── aggregation unit ──────────────────────────────────────────────────────────

describe('ship-status — aggregation', () => {
  it('uses worst-case semantics: any fail → fail', () => {
    const r = aggregateShipStatus([
      { name: 'a', status: 'pass', detail: '', blocking_reason: null },
      { name: 'b', status: 'pending', detail: '', blocking_reason: 'b pending' },
      { name: 'c', status: 'fail', detail: '', blocking_reason: 'c failed' },
    ]);
    expect(r.overall).toBe('fail');
    expect(r.blocking_reasons).toEqual(['b pending', 'c failed']);
  });

  it('pending dominates pass when no failures', () => {
    const r = aggregateShipStatus([
      { name: 'a', status: 'pass', detail: '', blocking_reason: null },
      { name: 'b', status: 'pending', detail: '', blocking_reason: 'b pending' },
    ]);
    expect(r.overall).toBe('pending');
  });
});
