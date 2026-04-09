import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const ROOT = join(__dirname, '..');
const BIN = join(ROOT, 'bin', 'decision-log-linter.js');

function run(args) {
  return spawnSync(process.execPath, [BIN, ...args], {
    cwd: ROOT,
    encoding: 'utf8',
  });
}

describe('decision-log-linter CLI', () => {
  it('returns 0 for a valid decision log', () => {
    const result = run(['lint', './test/fixtures/good.md']);
    assert.equal(result.status, 0);
    assert.match(result.stdout, /PASS/);
  });

  it('returns 1 and JSON output for lint failures', () => {
    const result = run(['lint', './test/fixtures/bad.md', '--json']);
    assert.equal(result.status, 1);
    const parsed = JSON.parse(result.stdout);
    assert.equal(parsed.ok, false);
    assert.ok(parsed.errors.length >= 2);
  });

  it('returns 2 for invalid CLI usage', () => {
    const result = run([]);
    assert.equal(result.status, 2);
    assert.match(result.stderr, /Usage:/);
  });
});
