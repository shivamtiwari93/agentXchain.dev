/**
 * BUG-36 beta-tester scenario: turn validator must reject a phase transition
 * request when the gated file was not modified by the turn.
 *
 * Tester sequence:
 *   1. Create governed project with implementation_complete gate requiring
 *      IMPLEMENTATION_NOTES.md with ## Changes section
 *   2. Dispatch dev turn
 *   3. Dev submits result proposing 'qa' phase transition WITHOUT editing
 *      the gated file (files_changed has no gate-required files)
 *   4. Verify: acceptance rejects with gate_semantic_coverage error naming
 *      the file and the gate
 *
 * This test must FAIL on pre-fix HEAD and PASS after the fix.
 */

import { describe, it, afterEach } from 'vitest';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execSync } from 'node:child_process';

import {
  initializeGovernedRun,
  assignGovernedTurn,
  acceptGovernedTurn,
  normalizeGovernedStateShape,
} from '../../src/lib/governed-state.js';
import { writeDispatchBundle } from '../../src/lib/dispatch-bundle.js';
import { evaluatePhaseExit } from '../../src/lib/gate-evaluator.js';

const tempDirs = [];

function makeRawConfig() {
  return {
    schema_version: '1.0',
    protocol_mode: 'governed',
    template: 'generic',
    project: { id: 'bug36-test', name: 'BUG-36 Test', default_branch: 'main' },
    roles: {
      dev: {
        title: 'Developer',
        mandate: 'Implement features and fix bugs.',
        write_authority: 'authoritative',
        runtime: 'local-dev',
      },
      qa: {
        title: 'QA',
        mandate: 'Verify quality.',
        write_authority: 'review_only',
        runtime: 'manual-qa',
      },
    },
    runtimes: {
      'local-dev': { type: 'local_cli', command: 'echo done' },
      'manual-qa': { type: 'manual' },
    },
    routing: {
      implementation: {
        entry_role: 'dev',
        allowed_next_roles: ['dev', 'qa'],
        exit_gate: 'implementation_complete',
      },
      qa: {
        entry_role: 'qa',
        allowed_next_roles: ['qa'],
      },
    },
    gates: {
      implementation_complete: {
        requires_files: ['.planning/IMPLEMENTATION_NOTES.md'],
        semantics: [{
          file: '.planning/IMPLEMENTATION_NOTES.md',
          rule: 'section_exists',
          config: { heading: '## Changes' },
        }],
      },
    },
  };
}

function makeConfig() {
  return {
    schema_version: 4,
    protocol_mode: 'governed',
    project: { id: 'bug36-test', name: 'BUG-36 Test', default_branch: 'main' },
    roles: {
      dev: {
        title: 'Developer',
        mandate: 'Implement features and fix bugs.',
        write_authority: 'authoritative',
        runtime_class: 'local_cli',
        runtime_id: 'local-dev',
      },
      qa: {
        title: 'QA',
        mandate: 'Verify quality.',
        write_authority: 'review_only',
        runtime_class: 'manual',
        runtime_id: 'manual-qa',
      },
    },
    runtimes: {
      'local-dev': { type: 'local_cli', command: 'echo done' },
      'manual-qa': { type: 'manual' },
    },
    phases: [
      { id: 'implementation', name: 'Implementation' },
      { id: 'qa', name: 'QA' },
    ],
    routing: {
      implementation: {
        entry_role: 'dev',
        allowed_next_roles: ['dev', 'qa'],
        exit_gate: 'implementation_complete',
      },
      qa: {
        entry_role: 'qa',
        allowed_next_roles: ['qa'],
      },
    },
    gates: {
      implementation_complete: {
        requires_files: ['.planning/IMPLEMENTATION_NOTES.md'],
        semantics: [{
          file: '.planning/IMPLEMENTATION_NOTES.md',
          rule: 'section_exists',
          config: { heading: '## Changes' },
        }],
      },
    },
  };
}

function createProject() {
  const root = mkdtempSync(join(tmpdir(), 'axc-bug36-'));
  tempDirs.push(root);
  mkdirSync(join(root, '.agentxchain', 'staging'), { recursive: true });
  mkdirSync(join(root, '.planning'), { recursive: true });
  writeFileSync(join(root, 'agentxchain.json'), JSON.stringify(makeRawConfig(), null, 2));
  writeFileSync(
    join(root, '.planning', 'IMPLEMENTATION_NOTES.md'),
    '# Implementation Notes\n\n## Verification\n\n- Existing build is green.\n'
  );
  writeFileSync(join(root, 'README.md'), '# Test\n');
  execSync('git init && git config user.email "test@test.com" && git config user.name "Test"', { cwd: root, stdio: 'ignore' });
  execSync('git add -A && git commit -m "init"', { cwd: root, stdio: 'ignore' });
  return root;
}

function readState(root) {
  return normalizeGovernedStateShape(JSON.parse(readFileSync(join(root, '.agentxchain/state.json'), 'utf8'))).state;
}

afterEach(() => {
  while (tempDirs.length > 0) { try { rmSync(tempDirs.pop(), { recursive: true, force: true }); } catch {} }
});

describe('BUG-36: gate_semantic_coverage rejects phase transition when gated file not modified', () => {
  it('rejects dev turn proposing qa transition when gated file is not in files_changed', () => {
    const config = makeConfig();
    const root = createProject();

    // 1. Initialize run
    initializeGovernedRun(root, config);

    // 2. Dispatch dev turn
    const assign = assignGovernedTurn(root, config, 'dev', {
      runtime_id: 'local-dev',
    });
    assert.ok(assign.ok, `assign failed: ${assign.error}`);
    const turnId = assign.turn.turn_id;

    writeDispatchBundle(root, readState(root), config, { turnId });

    // 3. Dev submits result proposing qa transition WITHOUT editing the gated
    //    file. The real gate failure is semantic, not "missing file":
    //    IMPLEMENTATION_NOTES.md exists but still lacks ## Changes.
    const turnResultPath = join(root, '.agentxchain', 'staging', 'turn-result.json');
    writeFileSync(turnResultPath, JSON.stringify({
      schema_version: '1.0',
      run_id: readState(root).run_id,
      turn_id: turnId,
      role: 'dev',
      runtime_id: 'local-dev',
      status: 'completed',
      summary: 'Ready for QA handoff.',
      decisions: [],
      objections: [],
      files_changed: ['src/index.js'], // Does NOT include the gated file
      verification: { status: 'pass' },
      artifact: { type: 'workspace', ref: null },
      proposed_next_role: 'qa',
      phase_transition_request: 'qa',
    }, null, 2));

    // Create the file that was "changed" (so observation doesn't fail)
    mkdirSync(join(root, 'src'), { recursive: true });
    writeFileSync(join(root, 'src', 'index.js'), 'console.log("hello");\n'.padEnd(100));
    execSync('git add -A && git commit -m "dev turn"', { cwd: root, stdio: 'ignore' });

    const preGate = evaluatePhaseExit({
      state: readState(root),
      config,
      acceptedTurn: JSON.parse(readFileSync(turnResultPath, 'utf8')),
      root,
    });
    assert.equal(preGate.action, 'gate_failed');
    assert.deepEqual(preGate.failing_files, ['.planning/IMPLEMENTATION_NOTES.md']);
    assert.deepEqual(
      preGate.reasons,
      ['.planning/IMPLEMENTATION_NOTES.md must define ## Changes before implementation can exit.'],
      'BUG-37 regression: test must use the exact semantic gate reason emitted by evaluatePhaseExit'
    );

    // 4. Accept should reject with gate_semantic_coverage error
    const accept = acceptGovernedTurn(root, config, {
      turnId,
      resultPath: turnResultPath,
    });

    // BUG-36: on pre-fix HEAD, this turn is accepted (ok: true) because no
    // validator checks whether the gated file was actually modified.
    // After the fix, it should be rejected.
    assert.equal(accept.ok, false, 'BUG-36: turn proposing phase transition without modifying gated file should be rejected');
    assert.match(
      accept.error,
      /gate_semantic_coverage|IMPLEMENTATION_NOTES/i,
      'rejection error must reference the gated file or gate_semantic_coverage'
    );
  });
});
