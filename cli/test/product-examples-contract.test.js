import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const REPO_ROOT = join(__dirname, '..', '..');
const CLI_BIN = join(REPO_ROOT, 'cli', 'bin', 'agentxchain.js');
const SPEC_PATH = join(REPO_ROOT, '.planning', 'PRODUCT_EXAMPLES_SPEC.md');
const EXAMPLE_DIR = join(REPO_ROOT, 'examples', 'decision-log-linter');
const README_PATH = join(REPO_ROOT, 'README.md');

function runNode(args, cwd) {
  return spawnSync(process.execPath, args, {
    cwd,
    encoding: 'utf8',
    timeout: 20_000,
  });
}

describe('product examples contract', () => {
  it('records all five target example categories in the product examples spec', () => {
    const spec = readFileSync(SPEC_PATH, 'utf8');
    for (const required of [
      'consumer SaaS',
      'mobile app',
      'B2B SaaS',
      'developer tool',
      'open source library',
      'examples/decision-log-linter',
    ]) {
      assert.ok(spec.includes(required), `${required} must appear in PRODUCT_EXAMPLES_SPEC.md`);
    }
  });

  it('ships the decision-log-linter example with governed and product files', () => {
    for (const relPath of [
      'README.md',
      'package.json',
      'agentxchain.json',
      'TALK.md',
      '.planning/SYSTEM_SPEC.md',
      '.planning/ARCHITECTURE.md',
      '.planning/distribution-checklist.md',
      'src/index.js',
      'src/lint.js',
      'test/cli.test.js',
    ]) {
      assert.ok(existsSync(join(EXAMPLE_DIR, relPath)), `${relPath} must exist in decision-log-linter example`);
    }
  });

  it('proves the example test suite passes', () => {
    const result = runNode(['--test'], EXAMPLE_DIR);
    assert.equal(result.status, 0, result.stderr || result.stdout);
  });

  it('proves the example workflow-kit contract passes template validate', () => {
    const result = runNode([CLI_BIN, 'template', 'validate', '--json'], EXAMPLE_DIR);
    assert.equal(result.status, 0, result.stderr || result.stdout);

    const payload = JSON.parse(result.stdout.trim());
    assert.equal(payload.workflow_kit.ok, true);
    assert.ok(
      payload.workflow_kit.required_files.includes('.planning/distribution-checklist.md'),
      'release-phase workflow artifact must be part of the validated contract',
    );
  });

  it('documents the new example on the root README examples table', () => {
    const readme = readFileSync(README_PATH, 'utf8');
    assert.ok(
      readme.includes('[decision-log-linter](examples/decision-log-linter/)'),
      'root README examples table must list the new decision-log-linter example',
    );
  });
});
