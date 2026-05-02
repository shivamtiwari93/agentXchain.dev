import { describe, it } from 'vitest';
import assert from 'node:assert/strict';

import { hasMinimumTurnResultShape } from '../src/lib/turn-result-shape.js';

describe('hasMinimumTurnResultShape', () => {
  it('rejects empty and placeholder objects', () => {
    assert.equal(hasMinimumTurnResultShape(null), false);
    assert.equal(hasMinimumTurnResultShape({}), false);
    assert.equal(hasMinimumTurnResultShape({ turn_id: 'turn_1' }), false);
    assert.equal(hasMinimumTurnResultShape({ schema_version: '1.0', turn_id: 'turn_1' }), false);
  });

  it('rejects objects missing schema_version even if identity and lifecycle exist', () => {
    assert.equal(
      hasMinimumTurnResultShape({ turn_id: 'turn_1', status: 'completed' }),
      false,
    );
    assert.equal(
      hasMinimumTurnResultShape({ run_id: 'run_1', role: 'dev' }),
      false,
    );
  });

  it('accepts the minimum governed envelope', () => {
    assert.equal(
      hasMinimumTurnResultShape({ schema_version: '1.0', turn_id: 'turn_1', status: 'completed' }),
      true,
    );
    assert.equal(
      hasMinimumTurnResultShape({ schema_version: '1.0', run_id: 'run_1', runtime_id: 'mcp-dev' }),
      true,
    );
  });
});
