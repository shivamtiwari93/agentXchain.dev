import { describe, it } from 'vitest';
import assert from 'node:assert/strict';

import { resolveGovernedRole } from '../src/lib/role-resolution.js';

function makeConfig(overrides = {}) {
  return {
    roles: {
      qa: { title: 'QA' },
      pm: { title: 'PM' },
      dev: { title: 'Dev' },
    },
    routing: {
      planning: {
        entry_role: 'pm',
        allowed_next_roles: ['pm', 'dev', 'human'],
      },
      qa: {
        entry_role: 'qa',
        allowed_next_roles: ['qa', 'dev', 'human'],
      },
    },
    ...overrides,
  };
}

describe('resolveGovernedRole', () => {
  it('returns an error for an unknown override role', () => {
    const result = resolveGovernedRole({
      override: 'ghost',
      state: { phase: 'planning' },
      config: makeConfig(),
    });

    assert.equal(result.roleId, null);
    assert.equal(result.error, 'Unknown role: "ghost"');
    assert.deepEqual(result.availableRoles, ['qa', 'pm', 'dev']);
  });

  it('uses a routing-legal next recommended role before entry_role fallback', () => {
    const result = resolveGovernedRole({
      state: { phase: 'planning', next_recommended_role: 'dev' },
      config: makeConfig(),
    });

    assert.equal(result.error, null);
    assert.equal(result.roleId, 'dev');
  });

  it('routes pending charter materialization back to PM before stale recommendations', () => {
    const result = resolveGovernedRole({
      state: {
        phase: 'planning',
        next_recommended_role: 'dev',
        charter_materialization_pending: {
          charter: 'Materialize the next intake.',
          suppressed_transition: 'implementation',
        },
      },
      config: makeConfig(),
    });

    assert.equal(result.error, null);
    assert.equal(result.roleId, 'pm');
  });

  it('ignores an illegal recommendation and falls back to the phase entry_role', () => {
    const result = resolveGovernedRole({
      state: { phase: 'planning', next_recommended_role: 'qa' },
      config: makeConfig(),
    });

    assert.equal(result.error, null);
    assert.equal(result.roleId, 'pm');
  });

  it('falls back to the first configured role when no routing entry_role exists', () => {
    const result = resolveGovernedRole({
      state: { phase: 'unknown' },
      config: makeConfig({ routing: {} }),
    });

    assert.equal(result.error, null);
    assert.equal(result.roleId, 'qa');
    assert.match(result.warnings[0], /Defaulting to "qa"/);
  });
});
