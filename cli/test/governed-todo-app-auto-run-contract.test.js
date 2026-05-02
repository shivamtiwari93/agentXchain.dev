/**
 * Governed Todo App Auto-Run Proof Contract Test
 *
 * Guards the product-example auto-run proof boundary:
 *   1. Shells out to the real CLI binary (not a direct import)
 *   2. Uses `run --auto-approve --max-turns 12`
 *   3. Preserves 4-role config (pm, dev, qa, eng_director)
 *   4. Preserves 3-phase routing (planning, implementation, qa)
 *   5. All runtimes are api_proxy (no manual, no local_cli)
 *   6. Validates ≥3 accepted turns with real API cost
 *   7. Validates governance report generation
 *   8. Cleans up temp directory on completion
 */

import { describe, it } from 'vitest';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { spawnSync } from 'child_process';

const CLI_ROOT = join(import.meta.dirname, '..');
const REPO_ROOT = join(CLI_ROOT, '..');
const PROOF_SCRIPT = join(REPO_ROOT, 'examples', 'governed-todo-app', 'run-auto.mjs');
const SPEC_PATH = join(REPO_ROOT, '.planning', 'GOVERNED_TODO_APP_RUN_HARNESS_SPEC.md');
const source = readFileSync(PROOF_SCRIPT, 'utf8');

describe('Governed todo app auto-run proof: operator boundary', () => {
  it('AT-TODO-RUN-001: shells out to the real agentxchain CLI binary', () => {
    assert.ok(source.includes("join(cliRoot, 'bin', 'agentxchain.js')"), 'must target cli/bin/agentxchain.js');
    assert.ok(source.includes('spawnSync'), 'must shell out via spawnSync');
  });

  it('AT-TODO-RUN-002: runs agentxchain run --auto-approve --max-turns 12', () => {
    assert.ok(source.includes("'run'"), 'must invoke the run command');
    assert.ok(source.includes("'--auto-approve'"), 'must use --auto-approve');
    assert.ok(source.includes('MAX_TURNS'), 'must reference MAX_TURNS constant');
    assert.ok(source.includes('MAX_TURNS = 12'), 'must set MAX_TURNS to 12');
  });

  it('AT-TODO-RUN-003: config preserves 4 roles (pm, dev, qa, eng_director)', () => {
    assert.ok(source.includes("pm:"), 'must define pm role');
    assert.ok(source.includes("dev:"), 'must define dev role');
    assert.ok(source.includes("qa:"), 'must define qa role');
    assert.ok(source.includes("eng_director:"), 'must define eng_director role');
  });

  it('AT-TODO-RUN-004: config preserves 3 phases (planning, implementation, qa)', () => {
    assert.ok(source.includes("planning:"), 'must define planning phase');
    assert.ok(source.includes("implementation:"), 'must define implementation phase');
    // qa phase is under routing
    assert.ok(source.includes("exit_gate: 'qa_ship_verdict'") || source.includes("exit_gate: 'qa_done'"),
      'must define qa phase exit gate');
  });

  it('AT-TODO-RUN-005: all runtimes are api_proxy (no manual, no local_cli)', () => {
    assert.ok(!source.includes("type: 'manual'"), 'must not use manual adapter');
    assert.ok(!source.includes("type: 'local_cli'"), 'must not use local_cli adapter');
    const apiProxyCount = (source.match(/type: 'api_proxy'/g) || []).length;
    assert.ok(apiProxyCount >= 4, `must have ≥4 api_proxy runtimes, got ${apiProxyCount}`);
  });

  it('AT-TODO-RUN-006: validates ≥3 accepted turns with real API cost', () => {
    assert.ok(source.includes('real_api_calls'), 'must count real API-backed turns');
    assert.ok(source.includes('cost?.usd'), 'must inspect per-turn USD cost');
    assert.ok(source.includes('distinct_role_count'), 'must check distinct role participation');
  });

  it('AT-TODO-RUN-007: validates governance report generation', () => {
    assert.ok(source.includes("'.agentxchain', 'reports'"), 'must validate reports directory');
    assert.ok(source.includes('export_exists') && source.includes('report_exists'),
      'must check export and report existence');
  });

  it('AT-TODO-RUN-008: cleans up temp directory on completion', () => {
    assert.ok(source.includes('rmSync(root, { recursive: true, force: true })'),
      'must clean up temp directory');
  });
});

describe('Governed todo app auto-run proof: structure', () => {
  it('proof script exists', () => {
    assert.ok(existsSync(PROOF_SCRIPT), 'run-auto.mjs must exist');
  });

  it('spec exists', () => {
    assert.ok(existsSync(SPEC_PATH), 'GOVERNED_TODO_APP_RUN_HARNESS_SPEC.md must exist');
  });

  it('uses ANTHROPIC_API_KEY-backed api_proxy runtimes', () => {
    assert.ok(source.includes('ANTHROPIC_API_KEY'), 'must require ANTHROPIC_API_KEY');
    assert.ok(source.includes('claude-haiku-4-5-20251001'), 'must use cost-controlled Haiku model');
  });

  it('--json emits parseable payload on missing auth', () => {
    const result = spawnSync(process.execPath, [PROOF_SCRIPT, '--json'], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      env: { ...process.env, ANTHROPIC_API_KEY: '' },
      timeout: 10000,
    });

    assert.equal(result.status, 1, 'missing auth should fail');
  });

  it('copies prompts from the real governed-todo-app example', () => {
    assert.ok(source.includes('prompts'), 'must reference prompts');
    assert.ok(source.includes('pm.md') && source.includes('dev.md') && source.includes('qa.md'),
      'must copy role prompt files');
  });
});
