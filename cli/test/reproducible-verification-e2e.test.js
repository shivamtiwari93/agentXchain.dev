/**
 * AT-RVP-E2E-001, AT-RVP-E2E-002
 *
 * Subprocess E2E tests for `require_reproducible_verification` policy.
 * These invoke `agentxchain run` as a real child process with the policy
 * active, proving that replay enforcement works through the CLI surface —
 * not just library-level calls.
 *
 * Spec: .planning/REPRODUCIBLE_VERIFICATION_E2E_SPEC.md
 * Decision: DEC-RVP-E2E-001
 */

import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtempSync, readFileSync, rmSync, writeFileSync,
} from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { scaffoldGoverned } from '../src/commands/init.js';

const cliRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const binPath = join(cliRoot, 'bin', 'agentxchain.js');
const mockAgentPath = join(cliRoot, 'test-support', 'mock-agent.mjs');
const mockAgentBadEvidencePath = join(cliRoot, 'test-support', 'mock-agent-bad-evidence.mjs');

const tempDirs = [];

/**
 * Scaffold a governed project and configure all runtimes to use a given
 * mock agent script via local_cli. Adds the require_reproducible_verification
 * policy to the config.
 */
function makeProject(agentScript) {
  const root = mkdtempSync(join(tmpdir(), 'axc-rvp-e2e-'));
  tempDirs.push(root);
  scaffoldGoverned(root, 'RVP E2E Test', `rvp-e2e-${Date.now()}`);

  const configPath = join(root, 'agentxchain.json');
  const config = JSON.parse(readFileSync(configPath, 'utf8'));

  // Configure local_cli runtimes with the provided mock agent
  const mockRuntime = {
    type: 'local_cli',
    command: process.execPath,
    args: [agentScript],
    prompt_transport: 'dispatch_bundle_only',
  };

  for (const key of Object.keys(config.runtimes)) {
    config.runtimes[key] = { ...mockRuntime };
  }
  for (const role of Object.values(config.roles)) {
    role.write_authority = 'authoritative';
  }

  // Add the require_reproducible_verification policy
  config.policies = [
    {
      id: 'replay-proof',
      rule: 'require_reproducible_verification',
      action: 'block',
    },
  ];

  writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n');
  return root;
}

function runCli(root, args, opts = {}) {
  return spawnSync(process.execPath, [binPath, ...args], {
    cwd: root,
    encoding: 'utf8',
    timeout: opts.timeout || 30000,
  });
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('require_reproducible_verification — subprocess E2E', () => {

  // ──────────────────────────────────────────────────────────────────────────
  // AT-RVP-E2E-001: Correct evidence → replay matches → run proceeds
  // ──────────────────────────────────────────────────────────────────────────
  it('AT-RVP-E2E-001: run completes when machine evidence replay matches', () => {
    const root = makeProject(mockAgentPath);

    // mock-agent.mjs writes: { command: 'echo ok', exit_code: 0 }
    // 'echo ok' actually exits 0, so replay should match.
    const result = runCli(root, ['run', '--auto-approve', '--max-turns', '5']);

    // Must exit 0 — the run should complete (or at least not fail due to policy)
    assert.equal(result.status, 0,
      `Expected exit 0, got ${result.status}.\nstdout: ${result.stdout}\nstderr: ${result.stderr}`);

    // Should show turn acceptance (not policy block)
    assert.match(result.stdout, /Turn accepted/i,
      'Expected at least one turn to be accepted');

    // Should show Run completed (3-turn lifecycle)
    assert.match(result.stdout, /Run completed/,
      'Expected run to complete with matching evidence');

    // Verify the history records replay data
    const historyPath = join(root, '.agentxchain/history.jsonl');
    const history = readFileSync(historyPath, 'utf8')
      .trim().split('\n').filter(Boolean).map(l => JSON.parse(l));

    assert.ok(history.length >= 1, 'Expected at least 1 history entry');

    // At least one entry should have verification_replay with 'match'
    const hasReplay = history.some(h =>
      h.verification_replay?.overall === 'match'
    );
    assert.ok(hasReplay,
      'Expected at least one history entry with verification_replay.overall === "match"');
  });

  // ──────────────────────────────────────────────────────────────────────────
  // AT-RVP-E2E-002: Mismatched evidence → replay fails → policy blocks
  // ──────────────────────────────────────────────────────────────────────────
  it('AT-RVP-E2E-002: run stops when machine evidence replay mismatches', () => {
    const root = makeProject(mockAgentBadEvidencePath);

    // mock-agent-bad-evidence.mjs writes:
    //   { command: 'node -e "process.exit(1)"', exit_code: 0 }
    // The command actually exits 1, but evidence claims 0 → mismatch → block.
    const result = runCli(root, ['run', '--auto-approve', '--max-turns', '5']);

    // Should NOT exit 0 — the policy block should cause a non-zero exit
    assert.notEqual(result.status, 0,
      `Expected non-zero exit for policy block, got 0.\nstdout: ${result.stdout}`);

    // Output should mention policy violation or blocked
    const combined = result.stdout + result.stderr;
    assert.match(combined, /policy|blocked|violation|mismatch/i,
      'Expected policy violation or mismatch message in output');
  });
});
