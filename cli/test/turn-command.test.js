import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..');
const CLI_BIN = join(ROOT, 'cli', 'bin', 'agentxchain.js');

function runCli(cwd, args) {
  return spawnSync(process.execPath, [CLI_BIN, ...args], {
    cwd,
    encoding: 'utf8',
    timeout: 15000,
  });
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function createGovernedProjectWithActiveTurn() {
  const dir = mkdtempSync(join(tmpdir(), 'agentxchain-turn-'));
  const init = runCli(ROOT, ['init', '--governed', '--dir', dir, '-y']);
  assert.equal(init.status, 0, init.stderr || init.stdout);

  const resume = runCli(dir, ['resume']);
  assert.equal(resume.status, 0, resume.stderr || resume.stdout);

  const statePath = join(dir, '.agentxchain', 'state.json');
  const state = readJson(statePath);
  const turnId = Object.keys(state.active_turns)[0];
  assert.ok(turnId, 'active turn must exist after resume');
  return { dir, turnId, statePath };
}

describe('agentxchain turn show command', () => {
  it('AT-TURN-001: turn show defaults to the single active turn and prints dispatch artifact paths', () => {
    const { dir, turnId } = createGovernedProjectWithActiveTurn();
    try {
      const result = runCli(dir, ['turn', 'show']);
      assert.equal(result.status, 0, result.stderr || result.stdout);
      assert.match(result.stdout, new RegExp(`Turn: .*${turnId}`));
      assert.match(result.stdout, /ASSIGNMENT\.json/);
      assert.match(result.stdout, /PROMPT\.md/);
      assert.match(result.stdout, /CONTEXT\.md/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('AT-TURN-002: turn show --json returns structured turn metadata and artifact existence', () => {
    const { dir, turnId } = createGovernedProjectWithActiveTurn();
    try {
      const result = runCli(dir, ['turn', 'show', '--json']);
      assert.equal(result.status, 0, result.stderr || result.stdout);
      const payload = JSON.parse(result.stdout);
      assert.equal(payload.turn_id, turnId);
      assert.equal(payload.role, 'pm');
      assert.equal(payload.artifacts.assignment.exists, true);
      assert.equal(payload.artifacts.prompt.exists, true);
      assert.equal(payload.artifacts.context.exists, true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('AT-TURN-003: turn show --artifact prompt prints the generated prompt', () => {
    const { dir } = createGovernedProjectWithActiveTurn();
    try {
      const result = runCli(dir, ['turn', 'show', '--artifact', 'prompt']);
      assert.equal(result.status, 0, result.stderr || result.stdout);
      assert.match(result.stdout, /# Turn Assignment:/);
      assert.match(result.stdout, /## Your Mandate/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('AT-TURN-004: turn show --artifact assignment --json returns parsed assignment content', () => {
    const { dir, turnId } = createGovernedProjectWithActiveTurn();
    try {
      const result = runCli(dir, ['turn', 'show', '--artifact', 'assignment', '--json']);
      assert.equal(result.status, 0, result.stderr || result.stdout);
      const payload = JSON.parse(result.stdout);
      assert.equal(payload.turn_id, turnId);
      assert.equal(payload.artifact.id, 'assignment');
      assert.equal(payload.artifact.content.turn_id, turnId);
      assert.equal(payload.artifact.content.role, 'pm');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('AT-TURN-005: turn show fails closed when multiple active turns exist and no turn id was provided', () => {
    const { dir, turnId, statePath } = createGovernedProjectWithActiveTurn();
    try {
      const state = readJson(statePath);
      const duplicateId = 'turn_duplicate';
      state.active_turns[duplicateId] = {
        ...state.active_turns[turnId],
        turn_id: duplicateId,
        assigned_role: 'qa',
        runtime_id: 'manual-qa',
      };
      writeFileSync(statePath, JSON.stringify(state, null, 2) + '\n');

      const result = runCli(dir, ['turn', 'show']);
      assert.equal(result.status, 1);
      assert.match(result.stdout, /Multiple active turns are present/);
      assert.match(result.stdout, /Available:/);
      assert.match(result.stdout, new RegExp(turnId));
      assert.match(result.stdout, /turn_duplicate/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('AT-TURN-006: turn show fails closed when no active turn exists', () => {
    const dir = mkdtempSync(join(tmpdir(), 'agentxchain-turn-empty-'));
    try {
      const init = runCli(ROOT, ['init', '--governed', '--dir', dir, '-y']);
      assert.equal(init.status, 0, init.stderr || init.stdout);

      const result = runCli(dir, ['turn', 'show']);
      assert.equal(result.status, 1);
      assert.match(result.stdout, /No active turn found/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
