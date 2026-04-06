import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..', '..');

function read(relPath) {
  return readFileSync(resolve(ROOT, relPath), 'utf8');
}

describe('coordinator hooks E2E contract', () => {
  const spec = read('.planning/COORDINATOR_HOOKS_ACCEPTANCE_TRUTH_SPEC.md');
  const testSource = read('cli/test/e2e-coordinator-hooks.test.js');

  it('declares the acceptance-truth spec and decisions', () => {
    assert.match(spec, /DEC-COORD-HOOKS-E2E-001/);
    assert.match(spec, /AT-CHT-004/);
  });

  it('uses staged-result plus real accept-turn instead of fake repo-state writes', () => {
    assert.match(testSource, /getTurnStagingResultPath/);
    assert.match(testSource, /runCli\(repoRoot, \['accept-turn'\]\)/);
    assert.match(testSource, /function stageAndAcceptTurn/);
    assert.doesNotMatch(testSource, /function simulateAcceptedTurn/);
    assert.doesNotMatch(testSource, /appendFileSync/);
  });

  it('drives planning acceptances through a real implementation phase transition', () => {
    assert.match(testSource, /phaseTransition: 'implementation'/);
  });
});
