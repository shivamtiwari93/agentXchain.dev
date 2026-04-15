import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI_BIN = join(__dirname, '..', 'bin', 'agentxchain.js');

function runCli(cwd, args) {
  return spawnSync(process.execPath, [CLI_BIN, ...args], {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, NO_COLOR: '1' },
    timeout: 15000,
  });
}

/**
 * Create a minimal governed project with a dead-end gate config:
 * - all roles are review_only on api_proxy
 * - routing exits through a gate with requires_files
 */
function createDeadEndGateProject() {
  const tempRoot = mkdtempSync(join(tmpdir(), 'axc-validate-cfg-warn-'));
  const config = {
    schema_version: 4,
    protocol_mode: 'governed',
    project: { id: 'dead-end-test', name: 'Dead end gate test', default_branch: 'main' },
    roles: {
      pm: { title: 'PM', mandate: 'Plan.', write_authority: 'review_only', runtime: 'cloud' },
      dev: { title: 'Dev', mandate: 'Build.', write_authority: 'review_only', runtime: 'cloud' },
    },
    runtimes: {
      cloud: { type: 'api_proxy', provider: 'anthropic', model: 'claude-haiku-4-5-20251001', auth_env: 'ANTHROPIC_API_KEY' },
    },
    routing: {
      planning: {
        entry_role: 'pm',
        allowed_next_roles: ['pm', 'dev', 'human'],
        exit_gate: 'planning_gate',
      },
    },
    gates: {
      planning_gate: { requires_files: ['.planning/SPEC.md'] },
    },
    budget: { per_turn_max_usd: 2, per_run_max_usd: 10 },
    rules: { challenge_required: false, max_turn_retries: 2, max_deadlock_cycles: 2 },
    files: { talk: 'TALK.md', history: '.agentxchain/history.jsonl', state: '.agentxchain/state.json' },
  };

  writeFileSync(join(tempRoot, 'agentxchain.json'), JSON.stringify(config, null, 2));
  mkdirSync(join(tempRoot, '.agentxchain'), { recursive: true });
  writeFileSync(join(tempRoot, '.agentxchain', 'state.json'), JSON.stringify({ phase: 'planning', current_turn: null }));
  writeFileSync(join(tempRoot, '.agentxchain', 'history.jsonl'), '');
  writeFileSync(join(tempRoot, 'TALK.md'), '# Talk\n');

  return tempRoot;
}

/**
 * Create a governed project where roles CAN produce files (no dead end).
 */
function createHealthyProject() {
  const tempRoot = mkdtempSync(join(tmpdir(), 'axc-validate-cfg-warn-'));
  const config = {
    schema_version: 4,
    protocol_mode: 'governed',
    project: { id: 'healthy-test', name: 'Healthy config test', default_branch: 'main' },
    roles: {
      pm: { title: 'PM', mandate: 'Plan.', write_authority: 'review_only', runtime: 'cloud' },
      dev: { title: 'Dev', mandate: 'Build.', write_authority: 'proposed', runtime: 'cloud' },
    },
    runtimes: {
      cloud: { type: 'api_proxy', provider: 'anthropic', model: 'claude-haiku-4-5-20251001', auth_env: 'ANTHROPIC_API_KEY' },
    },
    routing: {
      planning: {
        entry_role: 'pm',
        allowed_next_roles: ['pm', 'dev', 'human'],
        exit_gate: 'planning_gate',
      },
    },
    gates: {
      planning_gate: { requires_files: ['.planning/SPEC.md'] },
    },
    budget: { per_turn_max_usd: 2, per_run_max_usd: 10 },
    rules: { challenge_required: false, max_turn_retries: 2, max_deadlock_cycles: 2 },
    files: { talk: 'TALK.md', history: '.agentxchain/history.jsonl', state: '.agentxchain/state.json' },
  };

  writeFileSync(join(tempRoot, 'agentxchain.json'), JSON.stringify(config, null, 2));
  mkdirSync(join(tempRoot, '.agentxchain'), { recursive: true });
  writeFileSync(join(tempRoot, '.agentxchain', 'state.json'), JSON.stringify({ phase: 'planning', current_turn: null }));
  writeFileSync(join(tempRoot, '.agentxchain', 'history.jsonl'), '');
  writeFileSync(join(tempRoot, 'TALK.md'), '# Talk\n');

  return tempRoot;
}

describe('validate surfaces admission control errors (subprocess)', () => {
  it('--json output includes ADM-001 error when all roles are review_only', () => {
    const tempRoot = createDeadEndGateProject();
    try {
      const result = runCli(tempRoot, ['validate', '--json']);
      const payload = JSON.parse(result.stdout);
      assert.ok(Array.isArray(payload.errors), 'validate --json must return errors array');
      assert.ok(
        payload.errors.some((e) => e.includes('ADM-001') && e.includes('review_only')),
        `Expected ADM-001 error in validate output, got: ${JSON.stringify(payload.errors)}`,
      );
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it('human-readable output prints ADM-001 error text', () => {
    const tempRoot = createDeadEndGateProject();
    try {
      const result = runCli(tempRoot, ['validate']);
      assert.ok(
        result.stdout.includes('ADM-001') && result.stdout.includes('review_only'),
        `Expected ADM-001 error in human output, got stdout:\n${result.stdout}`,
      );
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it('validate returns exit 1 for dead-end gate topology (ADM-001 is a hard error)', () => {
    const tempRoot = createDeadEndGateProject();
    try {
      const result = runCli(tempRoot, ['validate', '--json']);
      assert.equal(result.status, 1, 'Dead-end gate should cause exit 1');
      const payload = JSON.parse(result.stdout);
      assert.ok(payload.errors.length > 0, 'Should have errors');
      assert.ok(
        payload.errors.some((e) => e.includes('ADM-001')),
        `Should have ADM-001 error: ${JSON.stringify(payload.errors)}`,
      );
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it('--json output has no ADM-001 error when a proposed role exists', () => {
    const tempRoot = createHealthyProject();
    try {
      const result = runCli(tempRoot, ['validate', '--json']);
      const payload = JSON.parse(result.stdout);
      assert.ok(Array.isArray(payload.errors), 'validate --json must return errors array');
      assert.ok(
        !payload.errors.some((e) => e.includes('ADM-001')),
        `Should not have ADM-001 error when proposed role exists, got: ${JSON.stringify(payload.errors)}`,
      );
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });
});
