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
const GOVERNED_PROOF_PATH = join(REPO_ROOT, '.planning', 'PRODUCT_EXAMPLES_GOVERNED_PROOF.md');
const DECISION_LOG_DIR = join(REPO_ROOT, 'examples', 'decision-log-linter');
const HABIT_BOARD_DIR = join(REPO_ROOT, 'examples', 'habit-board');
const ASYNC_STANDUP_BOT_DIR = join(REPO_ROOT, 'examples', 'async-standup-bot');
const TRAIL_MEALS_DIR = join(REPO_ROOT, 'examples', 'trail-meals-mobile');
const SCHEMA_GUARD_DIR = join(REPO_ROOT, 'examples', 'schema-guard');
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
      'examples/async-standup-bot',
      'repo git history',
    ]) {
      assert.ok(spec.includes(required), `${required} must appear in PRODUCT_EXAMPLES_SPEC.md`);
    }
  });

  it('records the governed provenance contract for product examples', () => {
    const proofDoc = readFileSync(GOVERNED_PROOF_PATH, 'utf8');
    for (const required of ['Repo git history', 'TALK.md', 'workflow-kit artifacts', 'git log --oneline -- examples/schema-guard']) {
      assert.ok(proofDoc.includes(required), `${required} must appear in PRODUCT_EXAMPLES_GOVERNED_PROOF.md`);
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
      assert.ok(existsSync(join(DECISION_LOG_DIR, relPath)), `${relPath} must exist in decision-log-linter example`);
    }
  });

  it('ships the habit-board example with governed and product files', () => {
    for (const relPath of [
      'README.md',
      'package.json',
      'agentxchain.json',
      'TALK.md',
      '.planning/ROADMAP.md',
      '.planning/user-stories.md',
      '.planning/ux-flows.md',
      '.planning/design-decisions.md',
      '.planning/API_CONTRACT.md',
      '.planning/acceptance-matrix.md',
      '.planning/ship-verdict.md',
      'src/server.js',
      'src/store.js',
      'src/api.js',
      'src/public/index.html',
      'test/store.test.js',
      'test/api.test.js',
    ]) {
      assert.ok(existsSync(join(HABIT_BOARD_DIR, relPath)), `${relPath} must exist in habit-board example`);
    }
  });

  it('ships the async-standup-bot example with governed and product files', () => {
    for (const relPath of [
      'README.md',
      'package.json',
      'agentxchain.json',
      'TALK.md',
      '.planning/ROADMAP.md',
      '.planning/operator-jobs.md',
      '.planning/integration-contract.md',
      '.planning/reminder-policy.md',
      '.planning/API_CONTRACT.md',
      '.planning/operations-runbook.md',
      '.planning/data-retention.md',
      '.planning/acceptance-matrix.md',
      '.planning/ship-verdict.md',
      'src/server.js',
      'src/store.js',
      'src/api.js',
      'src/public/index.html',
      'test/store.test.js',
      'test/api.test.js',
    ]) {
      assert.ok(existsSync(join(ASYNC_STANDUP_BOT_DIR, relPath)), `${relPath} must exist in async-standup-bot example`);
    }
  });

  it('proves the decision-log-linter test suite passes', () => {
    const result = runNode(['--test'], DECISION_LOG_DIR);
    assert.equal(result.status, 0, result.stderr || result.stdout);
  });

  it('proves the habit-board test suite passes', () => {
    const result = runNode(['--test', 'test/'], HABIT_BOARD_DIR);
    assert.equal(result.status, 0, result.stderr || result.stdout);
  });

  it('proves the async-standup-bot test suite passes', () => {
    const result = runNode(['--test', 'test/'], ASYNC_STANDUP_BOT_DIR);
    assert.equal(result.status, 0, result.stderr || result.stdout);
  });

  it('proves the decision-log-linter workflow-kit contract passes template validate', () => {
    const result = runNode([CLI_BIN, 'template', 'validate', '--json'], DECISION_LOG_DIR);
    assert.equal(result.status, 0, result.stderr || result.stdout);

    const payload = JSON.parse(result.stdout.trim());
    assert.equal(payload.workflow_kit.ok, true);
    assert.ok(
      payload.workflow_kit.required_files.includes('.planning/distribution-checklist.md'),
      'release-phase workflow artifact must be part of the validated contract',
    );
  });

  it('proves the habit-board workflow-kit contract passes template validate', () => {
    const result = runNode([CLI_BIN, 'template', 'validate', '--json'], HABIT_BOARD_DIR);
    assert.equal(result.status, 0, result.stderr || result.stdout);

    const payload = JSON.parse(result.stdout.trim());
    assert.equal(payload.workflow_kit.ok, true);
    assert.ok(
      payload.workflow_kit.required_files.includes('.planning/user-stories.md'),
      'planning-phase workflow artifact must be part of the validated contract',
    );
  });

  it('proves the async-standup-bot workflow-kit contract passes template validate', () => {
    const result = runNode([CLI_BIN, 'template', 'validate', '--json'], ASYNC_STANDUP_BOT_DIR);
    assert.equal(result.status, 0, result.stderr || result.stdout);

    const payload = JSON.parse(result.stdout.trim());
    assert.equal(payload.workflow_kit.ok, true);
    assert.ok(
      payload.workflow_kit.required_files.includes('.planning/operations-runbook.md'),
      'operations-phase workflow artifact must be part of the validated contract',
    );
  });

  it('documents the decision-log-linter example on the root README examples table', () => {
    const readme = readFileSync(README_PATH, 'utf8');
    assert.ok(
      readme.includes('[decision-log-linter](examples/decision-log-linter/)'),
      'root README examples table must list the decision-log-linter example',
    );
  });

  it('documents the habit-board example on the root README examples table', () => {
    const readme = readFileSync(README_PATH, 'utf8');
    assert.ok(
      readme.includes('[habit-board](examples/habit-board/)'),
      'root README examples table must list the habit-board example',
    );
  });

  it('documents the async-standup-bot example on the root README examples table', () => {
    const readme = readFileSync(README_PATH, 'utf8');
    assert.ok(
      readme.includes('[async-standup-bot](examples/async-standup-bot/)'),
      'root README examples table must list the async-standup-bot example',
    );
  });

  it('ships the trail-meals-mobile example with governed and product files', () => {
    for (const relPath of [
      'README.md',
      'package.json',
      'agentxchain.json',
      'TALK.md',
      'app.json',
      'App.js',
      '.planning/ROADMAP.md',
      '.planning/platform-matrix.md',
      '.planning/offline-strategy.md',
      '.planning/ux-patterns.md',
      '.planning/nutrition-model.md',
      '.planning/API_CONTRACT.md',
      '.planning/acceptance-matrix.md',
      '.planning/ship-verdict.md',
      'src/model/trip.js',
      'src/model/meal.js',
      'src/model/ingredient.js',
      'src/model/planner.js',
      'src/storage/offline-store.js',
      'src/screens/TripsScreen.js',
      'src/navigation/AppNavigator.js',
      'test/planner.test.js',
      'test/model.test.js',
      'test/storage.test.js',
    ]) {
      assert.ok(existsSync(join(TRAIL_MEALS_DIR, relPath)), `${relPath} must exist in trail-meals-mobile example`);
    }
  });

  it('proves the trail-meals-mobile test suite passes', () => {
    const result = runNode(['--test', 'test/'], TRAIL_MEALS_DIR);
    assert.equal(result.status, 0, result.stderr || result.stdout);
  });

  it('proves the trail-meals-mobile workflow-kit contract passes template validate', () => {
    const result = runNode([CLI_BIN, 'template', 'validate', '--json'], TRAIL_MEALS_DIR);
    assert.equal(result.status, 0, result.stderr || result.stdout);

    const payload = JSON.parse(result.stdout.trim());
    assert.equal(payload.workflow_kit.ok, true);
    assert.ok(
      payload.workflow_kit.required_files.includes('.planning/platform-matrix.md'),
      'architecture-phase workflow artifact must be part of the validated contract',
    );
  });

  it('documents the trail-meals-mobile example on the root README examples table', () => {
    const readme = readFileSync(README_PATH, 'utf8');
    assert.ok(
      readme.includes('[trail-meals-mobile](examples/trail-meals-mobile/)'),
      'root README examples table must list the trail-meals-mobile example',
    );
  });

  it('ships the schema-guard example with governed and product files', () => {
    for (const relPath of [
      'README.md',
      'package.json',
      'agentxchain.json',
      'TALK.md',
      '.planning/ROADMAP.md',
      '.planning/public-api.md',
      '.planning/compatibility-policy.md',
      '.planning/API_REVIEW.md',
      '.planning/IMPLEMENTATION_NOTES.md',
      '.planning/release-adoption.md',
      '.planning/package-readiness.md',
      '.planning/acceptance-matrix.md',
      '.planning/ship-verdict.md',
      'src/index.js',
      'src/schema.js',
      'src/index.d.ts',
      'test/schema.test.js',
      'test/object.test.js',
      'test/composition.test.js',
    ]) {
      assert.ok(existsSync(join(SCHEMA_GUARD_DIR, relPath)), `${relPath} must exist in schema-guard example`);
    }
  });

  it('proves the schema-guard test suite passes', () => {
    const result = runNode(['--test', 'test/'], SCHEMA_GUARD_DIR);
    assert.equal(result.status, 0, result.stderr || result.stdout);
  });

  it('proves the schema-guard workflow-kit contract passes template validate', () => {
    const result = runNode([CLI_BIN, 'template', 'validate', '--json'], SCHEMA_GUARD_DIR);
    assert.equal(result.status, 0, result.stderr || result.stdout);

    const payload = JSON.parse(result.stdout.trim());
    assert.equal(payload.workflow_kit.ok, true);
    assert.ok(
      payload.workflow_kit.required_files.includes('.planning/package-readiness.md'),
      'release-phase workflow artifact must be part of the validated contract',
    );
  });

  it('documents the schema-guard example on the root README examples table', () => {
    const readme = readFileSync(README_PATH, 'utf8');
    assert.ok(
      readme.includes('[schema-guard](examples/schema-guard/)'),
      'root README examples table must list the schema-guard example',
    );
  });
});
