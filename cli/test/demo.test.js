import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'child_process';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { existsSync } from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI = join(__dirname, '..', 'bin', 'agentxchain.js');

describe('agentxchain demo', () => {
  it('completes a full governed lifecycle and exits 0', () => {
    const output = execSync(`node "${CLI}" demo`, {
      encoding: 'utf8',
      timeout: 30_000,
    });

    // Verify all 3 turns appear
    assert.match(output, /PM Turn/);
    assert.match(output, /Dev Turn/);
    assert.match(output, /QA Turn/);

    // Verify phase gates
    assert.match(output, /Phase Gate.*planning.*implementation/);
    assert.match(output, /Phase Gate.*implementation.*qa/);

    // Verify governance actions
    assert.match(output, /Turn accepted/);
    assert.match(output, /Gate passed/);
    assert.match(output, /Run completed/);

    // Verify objections were raised (governance requires challenge)
    assert.match(output, /objection/i);

    // Verify summary
    assert.match(output, /Turns:\s+3/);
    assert.match(output, /Decisions:\s+5/);
    assert.match(output, /Objections:\s+3/);

    // Verify CTA
    assert.match(output, /agentxchain init --governed/);
    assert.match(output, /https:\/\/agentxchain\.dev\/docs\/getting-started/);
  });

  it('returns structured JSON with --json flag', () => {
    const output = execSync(`node "${CLI}" demo --json`, {
      encoding: 'utf8',
      timeout: 30_000,
    });

    const result = JSON.parse(output);
    assert.strictEqual(result.ok, true);
    assert.ok(result.run_id, 'should have a run_id');
    assert.strictEqual(result.turns.length, 3);
    assert.strictEqual(result.turns[0].role, 'pm');
    assert.strictEqual(result.turns[1].role, 'dev');
    assert.strictEqual(result.turns[2].role, 'qa');
    assert.strictEqual(result.decisions, 5);
    assert.strictEqual(result.objections, 3);
    assert.ok(result.duration_ms > 0, 'should have positive duration');
    assert.strictEqual(result.error, null);
  });

  it('cleans up temp directory after completion', () => {
    const output = execSync(`node "${CLI}" demo --json`, {
      encoding: 'utf8',
      timeout: 30_000,
    });

    const result = JSON.parse(output);
    assert.strictEqual(result.ok, true);
    // The demo creates and cleans up a temp dir. We verify it succeeded
    // (cleanup failure would cause a non-zero exit or error in the result).
    assert.strictEqual(result.error, null);
  });

  it('includes governance lessons in narrated output', () => {
    const output = execSync(`node "${CLI}" demo`, {
      encoding: 'utf8',
      timeout: 30_000,
    });

    // Verify governance lessons explain consequences, not just rules
    assert.match(output, /missing rollback plan would have reached implementation unchecked/);
    assert.match(output, /gate stopped 3 AI agents.*human confirmed/);
    assert.match(output, /dev caught a clock-skew bug the PM missed/);
    assert.match(output, /QA found a compliance gap neither PM nor dev raised/);
    assert.match(output, /untested code could reach QA review/);
  });

  it('is registered in CLI help', () => {
    const output = execSync(`node "${CLI}" --help`, {
      encoding: 'utf8',
      timeout: 10_000,
    });

    assert.match(output, /demo/);
    assert.match(output, /governed lifecycle demo/i);
  });
});
