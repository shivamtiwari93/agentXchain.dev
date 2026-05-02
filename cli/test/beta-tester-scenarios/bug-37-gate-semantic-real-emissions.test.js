/**
 * BUG-37 beta-tester scenario: gate_semantic_coverage must reject turns based
 * on the real gate evaluator output, not regex parsing of prose reasons.
 *
 * The reopened BUG-36 fix only covered the "Required file missing:" branch.
 * This file exercises all real file-emission shapes from gate evaluation:
 *   1. "Required file missing: <path>"
 *   2. "<path> must define ..."
 *   3. "<path>: Document must contain sections ..."
 */

import { afterEach, describe, it } from 'vitest';
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

function makeRawConfig(overrides = {}) {
  return {
    schema_version: '1.0',
    protocol_mode: 'governed',
    template: 'generic',
    project: { id: 'bug37-test', name: 'BUG-37 Test', default_branch: 'main' },
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
      implementation_complete: {},
    },
    ...overrides,
  };
}

function makeConfig(overrides = {}) {
  return {
    schema_version: 4,
    protocol_mode: 'governed',
    project: { id: 'bug37-test', name: 'BUG-37 Test', default_branch: 'main' },
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
      implementation_complete: {},
    },
    ...overrides,
  };
}

function createProject({ rawConfig, setupFiles }) {
  const root = mkdtempSync(join(tmpdir(), 'axc-bug37-'));
  tempDirs.push(root);
  mkdirSync(join(root, '.agentxchain', 'staging'), { recursive: true });
  mkdirSync(join(root, '.planning'), { recursive: true });
  writeFileSync(join(root, 'agentxchain.json'), JSON.stringify(rawConfig, null, 2));
  writeFileSync(join(root, 'README.md'), '# Test\n');
  setupFiles(root);
  execSync('git init && git config user.email "test@test.com" && git config user.name "Test"', { cwd: root, stdio: 'ignore' });
  execSync('git add -A && git commit -m "init"', { cwd: root, stdio: 'ignore' });
  return root;
}

function readState(root) {
  return normalizeGovernedStateShape(JSON.parse(readFileSync(join(root, '.agentxchain/state.json'), 'utf8'))).state;
}

function runScenario({ rawConfig, config, setupFiles, expectedReason, expectedFailingFile }) {
  const root = createProject({ rawConfig, setupFiles });

  initializeGovernedRun(root, config);
  const assign = assignGovernedTurn(root, config, 'dev', {
    runtime_id: 'local-dev',
  });
  assert.ok(assign.ok, `assign failed: ${assign.error}`);

  const state = readState(root);
  const turnId = assign.turn.turn_id;
  writeDispatchBundle(root, state, config, { turnId });

  const turnResult = {
    schema_version: '1.0',
    run_id: state.run_id,
    turn_id: turnId,
    role: 'dev',
    runtime_id: 'local-dev',
    status: 'completed',
    summary: 'Ready for QA handoff.',
    decisions: [],
    objections: [],
    files_changed: ['src/index.js'],
    verification: { status: 'pass' },
    artifact: { type: 'workspace', ref: null },
    proposed_next_role: 'qa',
    phase_transition_request: 'qa',
  };

  const turnResultPath = join(root, '.agentxchain', 'staging', 'turn-result.json');
  writeFileSync(turnResultPath, JSON.stringify(turnResult, null, 2));

  mkdirSync(join(root, 'src'), { recursive: true });
  writeFileSync(join(root, 'src', 'index.js'), 'console.log("hello");\n');
  execSync('git add -A && git commit -m "dev turn"', { cwd: root, stdio: 'ignore' });

  const preGate = evaluatePhaseExit({
    state: readState(root),
    config,
    acceptedTurn: turnResult,
    root,
  });
  assert.equal(preGate.action, 'gate_failed');
  assert.deepEqual(preGate.failing_files, [expectedFailingFile]);
  assert.deepEqual(preGate.reasons, [expectedReason]);

  const accept = acceptGovernedTurn(root, config, {
    turnId,
    resultPath: turnResultPath,
  });
  assert.equal(accept.ok, false);
  assert.match(accept.error, /gate_semantic_coverage|did not modify that file|did not modify those files/i);
  assert.match(accept.error, new RegExp(expectedFailingFile.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
}

afterEach(() => {
  while (tempDirs.length > 0) {
    try {
      rmSync(tempDirs.pop(), { recursive: true, force: true });
    } catch {}
  }
});

describe('BUG-37: gate_semantic_coverage uses real gate evaluator failing_files', () => {
  it('covers required-file-missing emission format', () => {
    const path = '.planning/IMPLEMENTATION_NOTES.md';
    const rawConfig = makeRawConfig({
      gates: {
        implementation_complete: {
          requires_files: [path],
        },
      },
    });
    const config = makeConfig({
      gates: {
        implementation_complete: {
          requires_files: [path],
        },
      },
    });

    runScenario({
      rawConfig,
      config,
      setupFiles(root) {
        void root;
      },
      expectedReason: `Required file missing: ${path}`,
      expectedFailingFile: path,
    });
  });

  it('covers legacy semantic emission with file followed by whitespace', () => {
    const path = '.planning/IMPLEMENTATION_NOTES.md';
    const rawConfig = makeRawConfig({
      gates: {
        implementation_complete: {
          requires_files: [path],
          semantics: [{
            file: path,
            rule: 'section_exists',
            config: { heading: '## Changes' },
          }],
        },
      },
    });
    const config = makeConfig({
      gates: {
        implementation_complete: {
          requires_files: [path],
          semantics: [{
            file: path,
            rule: 'section_exists',
            config: { heading: '## Changes' },
          }],
        },
      },
    });

    runScenario({
      rawConfig,
      config,
      setupFiles(root) {
        writeFileSync(
          join(root, path),
          '# Implementation Notes\n\n## Verification\n\n- Existing build is green.\n'
        );
      },
      expectedReason: `${path} must define ## Changes before implementation can exit.`,
      expectedFailingFile: path,
    });
  });

  it('covers prefixed workflow_kit semantic emission with file followed by colon', () => {
    const path = '.planning/CUSTOM_CHECK.md';
    const workflowKit = {
      phases: {
        implementation: {
          artifacts: [{
            path,
            required: true,
            semantics: 'section_check',
            semantics_config: {
              required_sections: ['## Done'],
            },
          }],
        },
      },
    };

    runScenario({
      rawConfig: makeRawConfig({ workflow_kit: workflowKit }),
      config: makeConfig({ workflow_kit: workflowKit }),
      setupFiles(root) {
        writeFileSync(join(root, path), '# Custom Check\n\n## Todo\n\n- still missing the required section\n');
      },
      expectedReason: `${path}: Document must contain sections: ## Done`,
      expectedFailingFile: path,
    });
  });
});
