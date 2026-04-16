import { strict as assert } from 'node:assert';
import { spawnSync } from 'node:child_process';
import { describe, it } from 'node:test';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI_BIN = join(__dirname, '..', 'bin', 'agentxchain.js');
const SPEC = readFileSync(join(__dirname, '..', '..', '.planning', 'CLI_HELP_INSPECTION_BOUNDARY_SPEC.md'), 'utf8');

function runCli(args) {
  return spawnSync(process.execPath, [CLI_BIN, ...args], {
    encoding: 'utf8',
    timeout: 10000,
    env: { ...process.env, NODE_NO_WARNINGS: '1' },
  });
}

describe('CLI help inspection boundary', () => {
  it('AT-CLI-HELP-001/002/003/004: top-level help keeps export, audit, report, and dashboard boundaries explicit', () => {
    const result = runCli(['--help']);
    assert.equal(result.status, 0, result.stderr);

    assert.match(result.stdout, /export \[options\]\s+Write a portable governed\/coordinator export artifact from the current repo\/workspace/);
    assert.match(result.stdout, /audit \[options\]\s+Render a governance audit from the live current repo\/workspace/);
    assert.match(result.stdout, /report \[options\]\s+Render a governance summary from an existing verified export artifact/);
    assert.match(result.stdout, /dashboard \[options\]\s+Open the live governance dashboard for the current repo\/workspace/);
    assert.doesNotMatch(result.stdout, /dashboard\s+Open the read-only governance dashboard/i);
  });

  it('AT-CLI-HELP-005: replay help keeps replay export artifact-backed and read-only', () => {
    const result = runCli(['replay', '--help']);
    assert.equal(result.status, 0, result.stderr);

    assert.ok(
      result.stdout.includes('export [options] <export-file>  Open an existing export artifact in the')
      && result.stdout.includes('read-only dashboard'),
      `replay help must keep export artifact-backed and read-only:\n${result.stdout}`,
    );
  });

  it('spec records all acceptance ids for this guard', () => {
    for (const id of [
      'AT-CLI-HELP-001',
      'AT-CLI-HELP-002',
      'AT-CLI-HELP-003',
      'AT-CLI-HELP-004',
      'AT-CLI-HELP-005',
    ]) {
      assert.match(SPEC, new RegExp(id));
    }
  });
});
