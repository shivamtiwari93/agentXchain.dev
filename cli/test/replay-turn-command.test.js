import { strict as assert } from 'node:assert';
import { describe, it } from 'vitest';
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

function initGovernedProject() {
  const dir = mkdtempSync(join(tmpdir(), 'agentxchain-replay-turn-'));
  const init = runCli(ROOT, ['init', '--governed', '--dir', dir, '-y']);
  assert.equal(init.status, 0, init.stderr || init.stdout);
  return dir;
}

function writeHistory(dir, entries) {
  writeFileSync(
    join(dir, '.agentxchain', 'history.jsonl'),
    entries.map((entry) => JSON.stringify(entry)).join('\n') + '\n',
  );
}

function readJson(stdout) {
  return JSON.parse(stdout);
}

function makeEntry(overrides = {}) {
  const turnId = overrides.turn_id || 'turn_hist_default_001';
  return {
    turn_id: turnId,
    run_id: overrides.run_id || 'run_hist_default_001',
    role: overrides.role || 'dev',
    phase: overrides.phase || 'implementation',
    runtime_id: overrides.runtime_id || 'claude-code',
    status: overrides.status || 'completed',
    summary: overrides.summary || 'Accepted a governed turn fixture.',
    verification: overrides.verification || {
      status: 'pass',
      machine_evidence: [
        {
          command: 'node -e "process.exit(0)"',
          exit_code: 0,
        },
      ],
      evidence_summary: 'Fixture command exits 0.',
    },
    verification_replay: overrides.verification_replay,
    accepted_at: overrides.accepted_at || '2026-04-13T00:00:00.000Z',
  };
}

describe('agentxchain replay turn command', () => {
  it('AT-RTURN-001: replay turn defaults to the most recent accepted turn', () => {
    const dir = initGovernedProject();
    try {
      writeHistory(dir, [
        makeEntry({ turn_id: 'turn_hist_old_001', accepted_at: '2026-04-13T00:00:00.000Z' }),
        makeEntry({ turn_id: 'turn_hist_new_002', accepted_at: '2026-04-13T01:00:00.000Z' }),
      ]);

      const result = runCli(dir, ['replay', 'turn', '--json']);
      assert.equal(result.status, 0, result.stderr || result.stdout);

      const payload = readJson(result.stdout);
      assert.equal(payload.turn_id, 'turn_hist_new_002');
      assert.equal(payload.match_kind, 'latest');
      assert.equal(payload.overall, 'match');
      assert.equal(payload.replayed_commands, 1);
      assert.equal(payload.matched_commands, 1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('AT-RTURN-002: unique prefix resolution prints accepted-turn metadata in text mode', () => {
    const dir = initGovernedProject();
    try {
      writeHistory(dir, [
        makeEntry({ turn_id: 'turn_alpha_111111', role: 'pm', phase: 'planning' }),
        makeEntry({ turn_id: 'turn_beta_222222', role: 'qa', phase: 'verification' }),
      ]);

      const result = runCli(dir, ['replay', 'turn', 'turn_beta', '--timeout', '4000']);
      assert.equal(result.status, 0, result.stderr || result.stdout);
      assert.match(result.stdout, /Replay Turn: turn_beta_222222/);
      assert.match(result.stdout, /Source:\s+accepted history \(prefix\)/);
      assert.match(result.stdout, /Role:\s+qa/);
      assert.match(result.stdout, /Phase:\s+verification/);
      assert.match(result.stdout, /Outcome:.*match/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('AT-RTURN-003: ambiguous accepted-turn prefixes fail closed', () => {
    const dir = initGovernedProject();
    try {
      writeHistory(dir, [
        makeEntry({ turn_id: 'turn_sameprefix_111111' }),
        makeEntry({ turn_id: 'turn_sameprefix_222222' }),
      ]);

      const result = runCli(dir, ['replay', 'turn', 'turn_sameprefix']);
      assert.equal(result.status, 2);
      assert.match(result.stdout, /ambiguous/i);
      assert.match(result.stdout, /turn_sameprefix_111111/);
      assert.match(result.stdout, /turn_sameprefix_222222/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('AT-RTURN-004: no machine evidence fails closed as not_reproducible', () => {
    const dir = initGovernedProject();
    try {
      writeHistory(dir, [
        makeEntry({
          turn_id: 'turn_no_evidence_001',
          verification: {
            status: 'pass',
            machine_evidence: [],
            commands: ['npm test'],
            evidence_summary: 'No replayable machine evidence.',
          },
        }),
      ]);

      const result = runCli(dir, ['replay', 'turn', '--json']);
      assert.equal(result.status, 1);
      const payload = readJson(result.stdout);
      assert.equal(payload.overall, 'not_reproducible');
      assert.match(payload.reason, /machine_evidence/i);
      assert.equal(payload.replayed_commands, 0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('AT-RTURN-005: historical replay drift exits 1 with mismatch', () => {
    const dir = initGovernedProject();
    try {
      writeHistory(dir, [
        makeEntry({
          turn_id: 'turn_drift_001',
          verification: {
            status: 'pass',
            machine_evidence: [
              {
                command: 'node -e "process.exit(1)"',
                exit_code: 0,
              },
            ],
            evidence_summary: 'Historical fixture now drifts.',
          },
        }),
      ]);

      const result = runCli(dir, ['replay', 'turn', 'turn_drift_001', '--json']);
      assert.equal(result.status, 1);
      const payload = readJson(result.stdout);
      assert.equal(payload.overall, 'mismatch');
      assert.equal(payload.commands[0].declared_exit_code, 0);
      assert.equal(payload.commands[0].actual_exit_code, 1);
      assert.equal(payload.commands[0].matched, false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('AT-RTURN-006/007: missing history fails closed and json output surfaces accepted-turn metadata plus prior replay summary', () => {
    const missingDir = initGovernedProject();
    try {
      const missing = runCli(missingDir, ['replay', 'turn']);
      assert.equal(missing.status, 2);
      assert.match(missing.stdout, /No accepted turn history found/);
    } finally {
      rmSync(missingDir, { recursive: true, force: true });
    }

    const dir = initGovernedProject();
    try {
      writeHistory(dir, [
        makeEntry({
          turn_id: 'turn_prior_replay_001',
          run_id: 'run_prior_replay_001',
          role: 'security',
          phase: 'verification',
          accepted_at: '2026-04-13T02:00:00.000Z',
          verification_replay: {
            overall: 'match',
            matched_commands: 1,
            replayed_commands: 1,
            verified_at: '2026-04-13T02:00:05.000Z',
          },
        }),
      ]);

      const result = runCli(dir, ['replay', 'turn', 'turn_prior_replay_001', '--json']);
      assert.equal(result.status, 0, result.stderr || result.stdout);
      const payload = readJson(result.stdout);
      assert.equal(payload.run_id, 'run_prior_replay_001');
      assert.equal(payload.role, 'security');
      assert.equal(payload.phase, 'verification');
      assert.equal(payload.accepted_at, '2026-04-13T02:00:00.000Z');
      assert.equal(payload.prior_verification_replay.overall, 'match');
      assert.equal(payload.prior_verification_replay.verified_at, '2026-04-13T02:00:05.000Z');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
