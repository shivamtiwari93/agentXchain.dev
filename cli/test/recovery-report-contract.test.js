import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import {
  evaluateRecoveryReport,
  scaffoldRecoveryReport,
  RECOVERY_REPORT_PATH,
} from '../src/lib/workflow-gate-semantics.js';
import { initializeCoordinatorRun, loadCoordinatorState, saveCoordinatorState } from '../src/lib/coordinator-state.js';
import { resumeCoordinatorFromBlockedState } from '../src/lib/coordinator-recovery.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..', '..');

function writeJson(path, value) {
  writeFileSync(path, JSON.stringify(value, null, 2) + '\n');
}

function makeWorkspace() {
  return mkdtempSync(join(tmpdir(), 'axc-recovery-report-'));
}

function makeCoordinatorWorkspace() {
  const ws = makeWorkspace();
  mkdirSync(join(ws, '.agentxchain', 'multirepo'), { recursive: true });
  return ws;
}

function writeRecoveryReport(ws, content) {
  writeFileSync(join(ws, RECOVERY_REPORT_PATH), content);
}

const SCAFFOLD_CONTENT = `# Recovery Report

## Trigger

(Operator fills this before running multi resume)

## Impact

(Operator fills this before running multi resume)

## Mitigation

(Operator fills this before running multi resume)
`;

const REAL_CONTENT = `# Recovery Report

## Trigger

Post-acceptance hook detected tampered artifact checksums in repo-frontend after turn 3 acceptance.

## Impact

Coordinator blocked. repo-frontend work from turn 3 preserved but unverified. repo-backend unaffected.

## Mitigation

Operator re-ran artifact verification on repo-frontend, confirmed checksums valid after cache clear. Root cause was stale build cache, not actual tamper.

## Owner

ops-team
`;

const PARTIAL_CONTENT = `# Recovery Report

## Trigger

Post-acceptance hook violation in repo-frontend.

## Impact

(Operator fills this before running multi resume)

## Mitigation

Cleared stale cache and re-verified.
`;

// ── Evaluator unit tests ──────────────────────────────────────────────────

describe('Recovery Report Evaluator', () => {
  it('AT-RECOVERY-REPORT-001: returns null when file is absent', () => {
    const ws = makeCoordinatorWorkspace();
    const result = evaluateRecoveryReport(ws);
    assert.equal(result, null);
  });

  it('AT-RECOVERY-REPORT-002: scaffold placeholders fail validation', () => {
    const ws = makeCoordinatorWorkspace();
    writeRecoveryReport(ws, SCAFFOLD_CONTENT);
    const result = evaluateRecoveryReport(ws);
    assert.equal(result.ok, false);
    assert.ok(result.reason.includes('placeholder'));
    assert.ok(result.reason.includes('## Trigger'));
    assert.ok(result.reason.includes('## Impact'));
    assert.ok(result.reason.includes('## Mitigation'));
  });

  it('AT-RECOVERY-REPORT-003: real content in all gated sections passes', () => {
    const ws = makeCoordinatorWorkspace();
    writeRecoveryReport(ws, REAL_CONTENT);
    const result = evaluateRecoveryReport(ws);
    assert.deepStrictEqual(result, { ok: true });
  });

  it('AT-RECOVERY-REPORT-004: mixed real/placeholder content fails with specific sections', () => {
    const ws = makeCoordinatorWorkspace();
    writeRecoveryReport(ws, PARTIAL_CONTENT);
    const result = evaluateRecoveryReport(ws);
    assert.equal(result.ok, false);
    assert.ok(result.reason.includes('## Impact'));
    assert.ok(!result.reason.includes('## Trigger'), 'should not mention sections with real content');
    assert.ok(!result.reason.includes('## Mitigation'), 'should not mention sections with real content');
  });

  it('missing sections fail with section names', () => {
    const ws = makeCoordinatorWorkspace();
    writeRecoveryReport(ws, '# Recovery Report\n\n## Trigger\n\nReal trigger info.\n');
    const result = evaluateRecoveryReport(ws);
    assert.equal(result.ok, false);
    assert.ok(result.reason.includes('## Impact'));
    assert.ok(result.reason.includes('## Mitigation'));
  });

  it('empty sections fail validation', () => {
    const ws = makeCoordinatorWorkspace();
    writeRecoveryReport(ws, '# Recovery Report\n\n## Trigger\n\n## Impact\n\n## Mitigation\n');
    const result = evaluateRecoveryReport(ws);
    assert.equal(result.ok, false);
    assert.ok(result.reason.includes('placeholder'));
  });
});

// ── Scaffold unit tests ───────────────────────────────────────────────────

describe('Recovery Report Scaffold', () => {
  it('AT-RECOVERY-REPORT-008: scaffolds RECOVERY_REPORT.md with blocked reason', () => {
    const ws = makeCoordinatorWorkspace();
    const created = scaffoldRecoveryReport(ws, 'hook violation in after_acceptance');
    assert.equal(created, true);
    const content = readFileSync(join(ws, RECOVERY_REPORT_PATH), 'utf8');
    assert.ok(content.includes('## Trigger'));
    assert.ok(content.includes('## Impact'));
    assert.ok(content.includes('## Mitigation'));
    assert.ok(content.includes('hook violation in after_acceptance'));
  });

  it('scaffold is idempotent — does not overwrite existing report', () => {
    const ws = makeCoordinatorWorkspace();
    writeRecoveryReport(ws, REAL_CONTENT);
    const created = scaffoldRecoveryReport(ws, 'new reason');
    assert.equal(created, false);
    const content = readFileSync(join(ws, RECOVERY_REPORT_PATH), 'utf8');
    assert.ok(content.includes('tampered artifact checksums'));
  });
});

// ── Resume integration tests ──────────────────────────────────────────────

describe('multi resume requires recovery report', () => {
  function setupBlockedCoordinator() {
    const ws = makeCoordinatorWorkspace();

    // Minimal coordinator config
    writeJson(join(ws, 'agentxchain-coordinator.json'), {
      schema_version: '1.0',
      coordinator: {
        workspace: ws,
        repos: {
          'repo-a': {
            path: join(ws, 'repos', 'repo-a'),
            workstream: 'ws-a',
          },
        },
      },
      phases: ['implementation'],
    });

    // Set up a repo-a with governed state
    const repoPath = join(ws, 'repos', 'repo-a');
    mkdirSync(join(repoPath, '.agentxchain'), { recursive: true });
    writeJson(join(repoPath, 'agentxchain.json'), {
      schema_version: '1.0',
      template: 'generic',
      project: { id: 'repo-a', name: 'repo-a', default_branch: 'main' },
      roles: { dev: { title: 'Dev', mandate: 'Build', write_authority: 'authoritative', runtime: 'local-dev' } },
      runtimes: { 'local-dev': { type: 'local_cli', command: ['echo', 'hi'], prompt_transport: 'argv' } },
      routing: { implementation: { entry_role: 'dev', allowed_next_roles: ['dev'] } },
      gates: {},
    });
    writeJson(join(repoPath, '.agentxchain', 'state.json'), {
      run_id: 'run-a-001',
      phase: 'implementation',
      status: 'active',
      turn_count: 0,
    });

    // Set coordinator state to blocked
    const coordState = {
      super_run_id: 'super-001',
      status: 'blocked',
      blocked_reason: 'hook violation in after_acceptance',
      phase: 'implementation',
      repo_runs: {
        'repo-a': {
          run_id: 'run-a-001',
          status: 'active',
          phase: 'implementation',
          turn_count: 0,
        },
      },
    };
    saveCoordinatorState(ws, coordState);

    // Write coordinator history for resync
    const historyFile = join(ws, '.agentxchain', 'multirepo', 'history.jsonl');
    writeFileSync(historyFile, '');

    return { ws, coordState };
  }

  it('AT-RECOVERY-REPORT-005: rejects resume when report is absent', () => {
    const { ws, coordState } = setupBlockedCoordinator();
    const result = resumeCoordinatorFromBlockedState(ws, coordState, {});
    assert.equal(result.ok, false);
    assert.ok(result.error.includes('Recovery report required'));
    assert.ok(result.error.includes('RECOVERY_REPORT.md'));
  });

  it('AT-RECOVERY-REPORT-006: rejects resume when report has placeholders', () => {
    const { ws, coordState } = setupBlockedCoordinator();
    writeRecoveryReport(ws, SCAFFOLD_CONTENT);
    const result = resumeCoordinatorFromBlockedState(ws, coordState, {});
    assert.equal(result.ok, false);
    assert.ok(result.error.includes('placeholder'));
  });

  it('AT-RECOVERY-REPORT-007: succeeds resume when report has real content', () => {
    const { ws, coordState } = setupBlockedCoordinator();
    writeRecoveryReport(ws, REAL_CONTENT);

    // Write barriers.json so resync doesn't crash
    writeJson(join(ws, '.agentxchain', 'multirepo', 'barriers.json'), {});

    const result = resumeCoordinatorFromBlockedState(ws, coordState, {});
    assert.equal(result.ok, true);
    assert.equal(result.resumed_status, 'active');
  });
});

// ── Spec guard ────────────────────────────────────────────────────────────

describe('Recovery report spec guard', () => {
  it('AT-RECOVERY-REPORT-009: spec file exists', () => {
    assert.ok(existsSync(join(REPO_ROOT, '.planning', 'RECOVERY_REPORT_CONTRACT_SPEC.md')));
  });
});
