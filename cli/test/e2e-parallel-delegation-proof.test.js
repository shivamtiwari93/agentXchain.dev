import { describe, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, '..', '..');
const proofScript = join(repoRoot, 'examples', 'governed-todo-app', 'run-parallel-delegation-proof.mjs');

describe('E2E: Parallel Delegation Proof', () => {
  it('AT-PARDEL-001: parallel delegation proof passes through real step + run loop', { timeout: 120_000 }, () => {
    const stdout = execFileSync(process.execPath, [proofScript, '--json'], {
      encoding: 'utf8',
      timeout: 120_000,
      env: { ...process.env, NODE_NO_WARNINGS: '1', NO_COLOR: '1' },
    });
    const payload = JSON.parse(stdout);
    assert.equal(payload.result, 'pass', `proof failed: ${JSON.stringify(payload.errors)}`);
    assert.equal(payload.artifacts.final_status, 'completed');
  });

  it('AT-PARDEL-002: delegation children dispatched concurrently', { timeout: 120_000 }, () => {
    const stdout = execFileSync(process.execPath, [proofScript, '--json'], {
      encoding: 'utf8',
      timeout: 120_000,
      env: { ...process.env, NODE_NO_WARNINGS: '1', NO_COLOR: '1' },
    });
    const payload = JSON.parse(stdout);
    assert.equal(payload.result, 'pass', `proof failed: ${JSON.stringify(payload.errors)}`);
    assert.equal(payload.artifacts.concurrent_dispatch, true, 'expected concurrent_dispatch to be true');

    // Both children should have different AGENTXCHAIN_TURN_IDs
    const { dev, qa } = payload.artifacts.env_turn_ids;
    assert.ok(dev, 'dev should have AGENTXCHAIN_TURN_ID');
    assert.ok(qa, 'qa should have AGENTXCHAIN_TURN_ID');
    assert.notEqual(dev, qa, 'dev and qa should have different turn IDs');
  });

  it('AT-PARDEL-003: review turn references both delegations', { timeout: 120_000 }, () => {
    const stdout = execFileSync(process.execPath, [proofScript, '--json'], {
      encoding: 'utf8',
      timeout: 120_000,
      env: { ...process.env, NODE_NO_WARNINGS: '1', NO_COLOR: '1' },
    });
    const payload = JSON.parse(stdout);
    assert.equal(payload.result, 'pass', `proof failed: ${JSON.stringify(payload.errors)}`);
    assert.equal(payload.artifacts.review_references_both_delegations, true);
  });

  it('AT-PARDEL-004: role order is director → dev+qa → director', { timeout: 120_000 }, () => {
    const stdout = execFileSync(process.execPath, [proofScript, '--json'], {
      encoding: 'utf8',
      timeout: 120_000,
      env: { ...process.env, NODE_NO_WARNINGS: '1', NO_COLOR: '1' },
    });
    const payload = JSON.parse(stdout);
    assert.equal(payload.result, 'pass', `proof failed: ${JSON.stringify(payload.errors)}`);
    const roles = payload.artifacts.role_order;
    assert.equal(roles.length, 4);
    assert.equal(roles[0], 'director');
    assert.deepEqual(roles.slice(1, 3).sort(), ['dev', 'qa']);
    assert.equal(roles[3], 'director');
  });
});
