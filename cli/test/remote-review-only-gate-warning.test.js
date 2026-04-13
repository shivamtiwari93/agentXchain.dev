import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { validateV4Config } from '../src/lib/normalized-config.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SPEC = readFileSync(join(__dirname, '..', '..', '.planning', 'REMOTE_REVIEW_ONLY_GATE_WARNING_SPEC.md'), 'utf8');

function makeConfig({ writeAuthority = 'review_only', runtimeType = 'api_proxy' } = {}) {
  const runtime = runtimeType === 'remote_agent'
    ? { type: 'remote_agent', url: 'https://agent.example.com/turn' }
    : {
        type: 'api_proxy',
        provider: 'anthropic',
        model: 'claude-haiku-4-5-20251001',
        auth_env: 'ANTHROPIC_API_KEY',
      };

  return {
    schema_version: 4,
    protocol_mode: 'governed',
    project: { id: 'gate-warning-test', name: 'Gate warning test', default_branch: 'main' },
    roles: {
      pm: {
        title: 'PM',
        mandate: 'Plan.',
        write_authority: 'review_only',
        runtime: 'remote-pm',
      },
      dev: {
        title: 'Dev',
        mandate: 'Build.',
        write_authority: writeAuthority,
        runtime: 'remote-dev',
      },
    },
    runtimes: {
      'remote-pm': runtime,
      'remote-dev': runtime,
    },
    routing: {
      planning: {
        entry_role: 'pm',
        allowed_next_roles: ['pm', 'dev', 'human'],
        exit_gate: 'planning_signoff',
      },
    },
    gates: {
      planning_signoff: {
        requires_files: ['.planning/PM_SIGNOFF.md'],
      },
    },
    budget: { per_turn_max_usd: 2, per_run_max_usd: 10 },
    rules: { challenge_required: false, max_turn_retries: 2, max_deadlock_cycles: 2 },
    files: { talk: 'TALK.md', history: '.agentxchain/history.jsonl', state: '.agentxchain/state.json' },
  };
}

describe('remote review-only gate warnings', () => {
  it('warns when requires_files gate is backed only by remote review_only roles', () => {
    const result = validateV4Config(makeConfig());
    assert.equal(result.ok, true, `Expected config to remain valid: ${result.errors?.join('; ')}`);
    assert.ok(
      result.warnings.some((warning) =>
        warning.includes('requires_files') && warning.includes('review_only remote runtimes')),
      `Expected remote review-only gate warning, got: ${JSON.stringify(result.warnings)}`,
    );
  });

  it('does not warn when a proposed remote role can stage files for the gate', () => {
    const result = validateV4Config(makeConfig({ writeAuthority: 'proposed' }));
    assert.equal(result.ok, true, `Expected config to remain valid: ${result.errors?.join('; ')}`);
    assert.equal(
      result.warnings.some((warning) => warning.includes('planning_signoff')),
      false,
      `Unexpected warning for proposed remote writer: ${JSON.stringify(result.warnings)}`,
    );
  });

  it('warns for remote_agent review_only phases too', () => {
    const result = validateV4Config(makeConfig({ runtimeType: 'remote_agent' }));
    assert.equal(result.ok, true, `Expected config to remain valid: ${result.errors?.join('; ')}`);
    assert.ok(
      result.warnings.some((warning) => warning.includes('remote_agent')),
      `Expected remote_agent warning, got: ${JSON.stringify(result.warnings)}`,
    );
  });

  it('records the warning contract in a standalone spec', () => {
    assert.match(SPEC, /## Purpose/);
    assert.match(SPEC, /## Interface/);
    assert.match(SPEC, /## Behavior/);
    assert.match(SPEC, /## Acceptance Tests/);
    assert.match(SPEC, /review_only/);
    assert.match(SPEC, /requires_files/);
  });
});
