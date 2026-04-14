import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { join, dirname } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, '..', '..');
const proofScript = join(repoRoot, 'examples', 'governed-todo-app', 'run-delegation-failure-proof.mjs');

describe('delegation failure-path CLI proof', () => {
  it('AT-DEL-FAIL-001: proof script passes through the real local_cli step loop with mixed results', () => {
    const result = spawnSync(process.execPath, [proofScript, '--json'], {
      cwd: repoRoot,
      encoding: 'utf8',
      timeout: 120000,
      env: {
        ...process.env,
        NODE_NO_WARNINGS: '1',
        NO_COLOR: '1',
      },
    });

    assert.equal(result.status, 0, `proof script failed:\n${result.stdout}\n${result.stderr}`);
    const payload = JSON.parse(result.stdout);

    assert.equal(payload.result, 'pass');
    assert.equal(payload.runner, 'delegation-failure-path-cli-proof');
    assert.deepEqual(payload.artifacts.role_order, ['director', 'dev', 'qa', 'director']);
    assert.equal(payload.artifacts.final_status, 'completed');
    assert.equal(payload.artifacts.dev_delegation_status, 'completed');
    assert.equal(payload.artifacts.qa_delegation_status, 'failed');
    assert.equal(payload.artifacts.review_completed_count, 1);
    assert.equal(payload.artifacts.review_failed_count, 1);
    assert.match(payload.artifacts.review_artifact, /review-turn\.json$/);
  });

  it('AT-DEL-FAIL-002: proof traces show pending_delegation_review with mixed statuses after qa failure', () => {
    const result = spawnSync(process.execPath, [proofScript, '--json'], {
      cwd: repoRoot,
      encoding: 'utf8',
      timeout: 120000,
      env: {
        ...process.env,
        NODE_NO_WARNINGS: '1',
        NO_COLOR: '1',
      },
    });

    assert.equal(result.status, 0, `proof script failed:\n${result.stdout}\n${result.stderr}`);
    const payload = JSON.parse(result.stdout);

    // Step 3 trace (qa) should have pending_delegation_review with mixed statuses
    const qaTrace = payload.traces.find(t => t.step === 3);
    assert.ok(qaTrace, 'missing qa step trace');
    assert.ok(qaTrace.state.pending_delegation_review, 'missing pending_delegation_review after qa failure');

    const results = qaTrace.state.pending_delegation_review.delegation_results;
    assert.equal(results.length, 2);

    const statuses = results.map(r => r.status);
    assert.ok(statuses.includes('completed'), 'expected completed delegation in review');
    assert.ok(statuses.includes('failed'), 'expected failed delegation in review');

    // Verify the failed delegation has the right summary
    const failedResult = results.find(r => r.status === 'failed');
    assert.match(failedResult.summary, /failed/i);
  });
});
