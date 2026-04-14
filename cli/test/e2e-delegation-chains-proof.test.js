import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, '..', '..');
const proofScript = join(repoRoot, 'examples', 'governed-todo-app', 'run-delegation-proof.mjs');
const specPath = join(repoRoot, '.planning', 'DELEGATION_CHAINS_PROOF_SPEC.md');

describe('delegation chains CLI proof', () => {
  it('AT-DEL-PROOF-001..007: proof script passes through the real local_cli step loop', () => {
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
    assert.equal(payload.runner, 'delegation-chains-cli-proof');
    assert.deepEqual(payload.artifacts.role_order, ['director', 'dev', 'qa', 'director']);
    assert.equal(payload.artifacts.final_status, 'completed');
    assert.match(payload.artifacts.review_artifact, /review-turn\.json$/);
    assert.deepEqual(
      payload.artifacts.delegate_artifacts,
      [
        '.agentxchain/proof/delegation/del-001.json',
        '.agentxchain/proof/delegation/del-002.json',
      ],
    );
  });

  it('AT-DEL-PROOF-008: spec names the proof surfaces', () => {
    const spec = readFileSync(specPath, 'utf8');
    assert.match(spec, /run-delegation-proof\.mjs/);
    assert.match(spec, /e2e-delegation-chains-proof\.test\.js/);
    assert.match(spec, /website-v2\/docs\/delegation-chains\.mdx/);
  });
});
