import { describe, it } from 'vitest';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { spawnSync } from 'child_process';

const CLI_ROOT = join(import.meta.dirname, '..');
const REPO_ROOT = join(CLI_ROOT, '..');
const PROOF_SCRIPT = join(REPO_ROOT, 'examples', 'governed-todo-app', 'run-chain-proof.mjs');
const SPEC_PATH = join(REPO_ROOT, '.planning', 'GOVERNED_TODO_APP_RUN_CHAIN_PROOF_SPEC.md');
const source = readFileSync(PROOF_SCRIPT, 'utf8');

describe('Governed todo app run-chain proof: operator boundary', () => {
  it('AT-TODO-CHAIN-001: shells out to the real CLI binary with run --chain', () => {
    assert.ok(source.includes("join(cliRoot, 'bin', 'agentxchain.js')"), 'must target cli/bin/agentxchain.js');
    assert.ok(source.includes('spawnSync'), 'must shell out via spawnSync');
    assert.ok(source.includes("'run'"), 'must invoke the run command');
    assert.ok(source.includes("'--chain'"), 'must invoke run --chain');
  });

  it('AT-TODO-CHAIN-002: uses explicit chain bounds and cooldown', () => {
    assert.ok(source.includes('MAX_CHAINS = 2'), 'must bound continuation depth to 2');
    assert.ok(source.includes("'--max-chains'"), 'must pass --max-chains');
    assert.ok(source.includes("'--chain-cooldown'"), 'must pass --chain-cooldown');
    assert.ok(source.includes("'0'"), 'must use zero cooldown in the proof');
    assert.ok(source.includes('MAX_TURNS = 5'), 'must bound per-run turns');
  });

  it('AT-TODO-CHAIN-003: validates a continuation-bearing chain report', () => {
    assert.ok(source.includes('chain report does not contain an initial run plus a continuation'), 'must require at least one continuation');
    assert.ok(source.includes('CLI output did not report at least 2 total runs'), 'must require at least 2 total runs in output');
    assert.ok(source.includes('Chain Summary'), 'must validate chain summary output');
  });

  it('AT-TODO-CHAIN-004: validates continuation lineage and inherited-context summaries', () => {
    assert.ok(source.includes('second run must point to first run as parent'), 'must validate second-run parent linkage');
    assert.ok(source.includes('third run must point to second run as parent'), 'must validate third-run parent linkage');
    assert.ok(source.includes('inherited_context_summary'), 'must inspect inherited-context summaries');
    assert.ok(source.includes('recent_accepted_turns_count'), 'must validate inherited accepted-turn summaries');
  });

  it('AT-TODO-CHAIN-005: validates per-run governance reports and exports', () => {
    assert.ok(source.includes('missing export for'), 'must validate exports for each chained run');
    assert.ok(source.includes('missing report for'), 'must validate reports for each chained run');
  });

  it('AT-TODO-CHAIN-006: cleans up the temp workspace', () => {
    assert.ok(source.includes('rmSync(root, { recursive: true, force: true })'), 'must clean up temp workspace');
  });
});

describe('Governed todo app run-chain proof: structure', () => {
  it('proof script exists', () => {
    assert.ok(existsSync(PROOF_SCRIPT), 'run-chain-proof.mjs must exist');
  });

  it('spec exists', () => {
    assert.ok(existsSync(SPEC_PATH), 'GOVERNED_TODO_APP_RUN_CHAIN_PROOF_SPEC.md must exist');
  });

  it('uses ANTHROPIC_API_KEY-backed api_proxy runtimes', () => {
    assert.ok(source.includes('ANTHROPIC_API_KEY'), 'must require ANTHROPIC_API_KEY');
    assert.ok(source.includes('claude-haiku-4-5-20251001'), 'must use cost-controlled Haiku model');
  });

  it('--json emits a non-zero exit on missing auth', () => {
    const result = spawnSync(process.execPath, [PROOF_SCRIPT, '--json'], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      env: { ...process.env, ANTHROPIC_API_KEY: '' },
      timeout: 10000,
    });

    assert.equal(result.status, 1, 'missing auth should fail');
  });
});
