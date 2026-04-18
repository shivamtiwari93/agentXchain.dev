import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { detectActiveTurnBindingDrift } from '../src/lib/governed-state.js';

describe('B-7: active turn binding drift detection', () => {
  const baseConfig = {
    roles: {
      pm: { write_authority: 'review_only', runtime: 'manual-pm' },
      dev: { write_authority: 'authoritative', runtime: 'local-dev' },
    },
    runtimes: {
      'manual-pm': { type: 'manual' },
      'local-dev': { type: 'local_cli', command: ['claude'] },
      'local-pm': { type: 'local_cli', command: ['claude'] },
      'api-qa': { type: 'api_proxy', provider: 'anthropic' },
    },
  };

  it('returns empty array when no active turns exist', () => {
    const state = { active_turns: {} };
    const drifts = detectActiveTurnBindingDrift(state, baseConfig);
    assert.deepStrictEqual(drifts, []);
  });

  it('returns empty array when turn matches current config', () => {
    const state = {
      active_turns: {
        turn_1: {
          turn_id: 'turn_1',
          assigned_role: 'dev',
          runtime_id: 'local-dev',
          write_authority: 'authoritative',
          status: 'running',
        },
      },
    };
    const drifts = detectActiveTurnBindingDrift(state, baseConfig);
    assert.deepStrictEqual(drifts, []);
  });

  it('detects runtime rebinding drift', () => {
    // Turn was assigned under manual-pm, but config now says local-pm
    const state = {
      active_turns: {
        turn_1: {
          turn_id: 'turn_1',
          assigned_role: 'pm',
          runtime_id: 'manual-pm',
          status: 'running',
        },
      },
    };
    const configWithRebind = {
      ...baseConfig,
      roles: {
        ...baseConfig.roles,
        pm: { write_authority: 'review_only', runtime: 'local-pm' },
      },
    };

    const drifts = detectActiveTurnBindingDrift(state, configWithRebind);
    assert.strictEqual(drifts.length, 1);
    assert.strictEqual(drifts[0].turn_id, 'turn_1');
    assert.strictEqual(drifts[0].runtime_changed, true);
    assert.strictEqual(drifts[0].old_runtime, 'manual-pm');
    assert.strictEqual(drifts[0].new_runtime, 'local-pm');
    assert.match(drifts[0].recovery_command, /reissue-turn/);
  });

  it('detects authority drift', () => {
    const state = {
      active_turns: {
        turn_1: {
          turn_id: 'turn_1',
          assigned_role: 'dev',
          runtime_id: 'local-dev',
          write_authority: 'review_only',
          status: 'running',
        },
      },
    };
    // Config says authoritative, turn was assigned as review_only
    const drifts = detectActiveTurnBindingDrift(state, baseConfig);
    assert.strictEqual(drifts.length, 1);
    assert.strictEqual(drifts[0].authority_changed, true);
    assert.strictEqual(drifts[0].old_authority, 'review_only');
    assert.strictEqual(drifts[0].new_authority, 'authoritative');
  });

  it('detects both runtime and authority drift simultaneously', () => {
    const state = {
      active_turns: {
        turn_1: {
          turn_id: 'turn_1',
          assigned_role: 'pm',
          runtime_id: 'manual-pm',
          write_authority: 'review_only',
          status: 'running',
        },
      },
    };
    const configWithBothDrift = {
      ...baseConfig,
      roles: {
        ...baseConfig.roles,
        pm: { write_authority: 'authoritative', runtime: 'local-pm' },
      },
    };

    const drifts = detectActiveTurnBindingDrift(state, configWithBothDrift);
    assert.strictEqual(drifts.length, 1);
    assert.strictEqual(drifts[0].runtime_changed, true);
    assert.strictEqual(drifts[0].authority_changed, true);
  });

  it('detects drift across multiple active turns', () => {
    const state = {
      active_turns: {
        turn_1: {
          turn_id: 'turn_1',
          assigned_role: 'pm',
          runtime_id: 'manual-pm',
          status: 'running',
        },
        turn_2: {
          turn_id: 'turn_2',
          assigned_role: 'dev',
          runtime_id: 'local-dev',
          write_authority: 'proposed',
          status: 'running',
        },
      },
    };
    const configWithDrift = {
      ...baseConfig,
      roles: {
        pm: { write_authority: 'review_only', runtime: 'local-pm' },
        dev: { write_authority: 'authoritative', runtime: 'local-dev' },
      },
    };

    const drifts = detectActiveTurnBindingDrift(state, configWithDrift);
    // pm has runtime drift (manual-pm → local-pm), dev has authority drift (proposed → authoritative)
    assert.strictEqual(drifts.length, 2);
  });

  it('handles missing role in config gracefully', () => {
    const state = {
      active_turns: {
        turn_1: {
          turn_id: 'turn_1',
          assigned_role: 'nonexistent_role',
          runtime_id: 'manual-pm',
          status: 'running',
        },
      },
    };
    const drifts = detectActiveTurnBindingDrift(state, baseConfig);
    assert.deepStrictEqual(drifts, []);
  });

  it('recovery command includes turn id', () => {
    const state = {
      active_turns: {
        turn_abc123: {
          turn_id: 'turn_abc123',
          assigned_role: 'pm',
          runtime_id: 'manual-pm',
          status: 'running',
        },
      },
    };
    const configWithDrift = {
      ...baseConfig,
      roles: {
        ...baseConfig.roles,
        pm: { write_authority: 'review_only', runtime: 'local-pm' },
      },
    };

    const drifts = detectActiveTurnBindingDrift(state, configWithDrift);
    assert.match(drifts[0].recovery_command, /--turn turn_abc123/);
  });
});
