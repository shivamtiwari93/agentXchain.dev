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

describe('validate surfaces config-shape warnings (subprocess)', () => {
  it('--json output includes dead-end gate warning when all roles are review_only remote', () => {
    const tempRoot = createDeadEndGateProject();
    try {
      const result = runCli(tempRoot, ['validate', '--json']);
      const payload = JSON.parse(result.stdout);
      assert.ok(Array.isArray(payload.warnings), 'validate --json must return warnings array');
      assert.ok(
        payload.warnings.some((w) => w.includes('requires_files') && w.includes('review_only remote runtimes')),
        `Expected dead-end gate warning in validate output, got: ${JSON.stringify(payload.warnings)}`,
      );
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it('human-readable output prints dead-end gate warning text', () => {
    const tempRoot = createDeadEndGateProject();
    try {
      const result = runCli(tempRoot, ['validate']);
      assert.ok(
        result.stdout.includes('requires_files') && result.stdout.includes('review_only remote runtimes'),
        `Expected dead-end gate warning in human output, got stdout:\n${result.stdout}`,
      );
      assert.ok(result.stdout.includes('Warnings:'), 'Expected Warnings: header in human output');
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it('validate distinguishes warnings from errors — warnings do not cause exit 1', () => {
    const tempRoot = createDeadEndGateProject();
    try {
      const result = runCli(tempRoot, ['validate', '--json']);
      const payload = JSON.parse(result.stdout);
      assert.ok(payload.warnings.length > 0, 'sanity: should have warnings');
      // The dead-end gate issue must be a warning, not an error
      assert.ok(
        !payload.errors.some((e) => e.includes('requires_files') && e.includes('review_only')),
        `Dead-end gate should be a warning, not an error: ${JSON.stringify(payload.errors)}`,
      );
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it('--json output has no dead-end gate warning when a proposed role exists', () => {
    const tempRoot = createHealthyProject();
    try {
      const result = runCli(tempRoot, ['validate', '--json']);
      const payload = JSON.parse(result.stdout);
      assert.ok(Array.isArray(payload.warnings), 'validate --json must return warnings array');
      assert.ok(
        !payload.warnings.some((w) => w.includes('requires_files') && w.includes('review_only remote runtimes')),
        `Should not have dead-end gate warning when proposed role exists, got: ${JSON.stringify(payload.warnings)}`,
      );
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });
});
