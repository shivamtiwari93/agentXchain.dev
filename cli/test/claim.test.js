import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI_BIN = join(__dirname, '..', 'bin', 'agentxchain.js');

function createProject(overrides = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'agentxchain-claim-test-'));
  mkdirSync(join(dir, '.planning', 'qa'), { recursive: true });
  mkdirSync(join(dir, '.planning', 'phases', 'phase-1'), { recursive: true });

  const config = {
    version: 3,
    project: 'Claim Test',
    agents: {
      pm: { name: 'PM', mandate: 'Plan work' },
      dev: { name: 'Dev', mandate: 'Build work' }
    },
    talk_file: 'TALK.md',
    state_file: 'state.md',
    history_file: 'history.jsonl',
    rules: {
      max_consecutive_claims: 2,
      ...(overrides.rules || {})
    },
    ...overrides
  };

  writeFileSync(join(dir, 'agentxchain.json'), JSON.stringify(config, null, 2));
  writeFileSync(join(dir, 'lock.json'), JSON.stringify({
    holder: null,
    last_released_by: null,
    turn_number: 0,
    claimed_at: null
  }, null, 2));
  writeFileSync(join(dir, 'state.json'), JSON.stringify({
    phase: 'build',
    blocked: false,
    blocked_on: null,
    project: 'Claim Test'
  }, null, 2));
  writeFileSync(join(dir, 'state.md'), '# state\n');
  writeFileSync(join(dir, 'history.jsonl'), '');
  writeFileSync(join(dir, 'TALK.md'), '## Turn 1\n- Next owner: pm\n');
  writeFileSync(join(dir, '.planning/PROJECT.md'), '# project\n');
  writeFileSync(join(dir, '.planning/REQUIREMENTS.md'), '# requirements\n');
  writeFileSync(join(dir, '.planning/ROADMAP.md'), '# Roadmap\n\n## Waves\nWave 1\n\n## Phases\nPhase 1\n');
  writeFileSync(join(dir, '.planning/PM_SIGNOFF.md'), 'Approved: YES\n');
  writeFileSync(join(dir, '.planning/qa/TEST-COVERAGE.md'), '# coverage\n');
  writeFileSync(join(dir, '.planning/qa/BUGS.md'), '# bugs\n');
  writeFileSync(join(dir, '.planning/qa/UX-AUDIT.md'), '# ux\n');
  writeFileSync(join(dir, '.planning/qa/ACCEPTANCE-MATRIX.md'), '# acceptance\n');
  writeFileSync(join(dir, '.planning/qa/REGRESSION-LOG.md'), '# regression\n');
  writeFileSync(join(dir, '.planning/phases/phase-1/PLAN.md'), '# plan\n');
  writeFileSync(join(dir, '.planning/phases/phase-1/TESTS.md'), '# tests\n');

  return dir;
}

function runCli(dir, args) {
  return spawnSync(process.execPath, [CLI_BIN, ...args], {
    cwd: dir,
    encoding: 'utf8'
  });
}

describe('claim and release command enforcement', () => {
  it('blocks an agent that exceeds max_consecutive_claims', () => {
    const dir = createProject();
    try {
      writeFileSync(join(dir, 'lock.json'), JSON.stringify({
        holder: null,
        last_released_by: 'pm',
        turn_number: 2,
        claimed_at: null
      }, null, 2));
      writeFileSync(
        join(dir, 'history.jsonl'),
        [
          JSON.stringify({ turn: 1, agent: 'pm', summary: 't1', files_changed: [], verify_result: 'pass', timestamp: '2026-01-01T00:00:00.000Z' }),
          JSON.stringify({ turn: 2, agent: 'pm', summary: 't2', files_changed: [], verify_result: 'pass', timestamp: '2026-01-01T00:01:00.000Z' })
        ].join('\n') + '\n'
      );

      const result = runCli(dir, ['claim', '--agent', 'pm']);
      assert.notEqual(result.status, 0);
      assert.match(result.stdout + result.stderr, /Consecutive-claim limit reached/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('blocks agent release when verify_command fails', () => {
    const dir = createProject({
      rules: {
        max_consecutive_claims: 2,
        verify_command: 'node -e "process.exit(1)"'
      }
    });
    try {
      writeFileSync(join(dir, 'lock.json'), JSON.stringify({
        holder: 'pm',
        last_released_by: 'dev',
        turn_number: 3,
        claimed_at: '2026-01-01T00:00:00.000Z'
      }, null, 2));

      const result = runCli(dir, ['release', '--agent', 'pm']);
      assert.notEqual(result.status, 0);
      assert.match(result.stdout + result.stderr, /Verification failed/);

      const lock = JSON.parse(readFileSync(join(dir, 'lock.json'), 'utf8'));
      assert.equal(lock.holder, 'pm');
      assert.equal(lock.turn_number, 3);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('releases agent lock when verify_command succeeds', () => {
    const dir = createProject({
      rules: {
        max_consecutive_claims: 2,
        verify_command: 'node -e "process.exit(0)"'
      }
    });
    try {
      writeFileSync(join(dir, 'lock.json'), JSON.stringify({
        holder: 'pm',
        last_released_by: 'dev',
        turn_number: 3,
        claimed_at: '2026-01-01T00:00:00.000Z'
      }, null, 2));

      const result = runCli(dir, ['release', '--agent', 'pm']);
      assert.equal(result.status, 0);

      const lock = JSON.parse(readFileSync(join(dir, 'lock.json'), 'utf8'));
      assert.equal(lock.holder, null);
      assert.equal(lock.last_released_by, 'pm');
      assert.equal(lock.turn_number, 4);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
