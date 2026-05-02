import { describe, it } from 'vitest';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { validateV4Config } from '../src/lib/normalized-config.js';
import { runAdmissionControl } from '../src/lib/admission-control.js';

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
  it('ADM-001 rejects when requires_files gate is backed only by review_only roles', () => {
    const config = makeConfig();
    // Config schema validation passes (topology is not a schema concern)
    const schemaResult = validateV4Config(config);
    assert.equal(schemaResult.ok, true, `Schema should pass: ${schemaResult.errors?.join('; ')}`);
    // Admission control rejects (ADM-001)
    const admission = runAdmissionControl(config, config);
    assert.equal(admission.ok, false, 'ADM-001 should fire for all review_only roles');
    assert.ok(
      admission.errors.some((e) => e.includes('ADM-001') && e.includes('review_only')),
      `Expected ADM-001 error, got: ${JSON.stringify(admission.errors)}`,
    );
  });

  it('does not reject when a proposed remote role can stage files for the gate', () => {
    const config = makeConfig({ writeAuthority: 'proposed' });
    const admission = runAdmissionControl(config, config);
    assert.equal(admission.ok, true, `Should pass: ${admission.errors?.join('; ')}`);
  });

  it('ADM-001 rejects for remote_agent review_only phases too', () => {
    const config = makeConfig({ runtimeType: 'remote_agent' });
    const admission = runAdmissionControl(config, config);
    assert.equal(admission.ok, false, 'ADM-001 should fire for remote_agent review_only');
    assert.ok(
      admission.errors.some((e) => e.includes('ADM-001') && e.includes('review_only')),
      `Expected ADM-001 error, got: ${JSON.stringify(admission.errors)}`,
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
