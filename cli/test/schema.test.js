import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { validateLockSchema, validateStateSchema, validateConfigSchema, safeParseJson } from '../src/lib/schema.js';

describe('validateLockSchema', () => {
  it('accepts a valid lock', () => {
    const result = validateLockSchema({
      holder: null,
      last_released_by: 'pm',
      turn_number: 3,
      claimed_at: null
    });
    assert.equal(result.ok, true);
    assert.equal(result.errors.length, 0);
  });

  it('accepts a claimed lock', () => {
    const result = validateLockSchema({
      holder: 'dev',
      last_released_by: 'pm',
      turn_number: 4,
      claimed_at: '2026-03-17T12:00:00.000Z'
    });
    assert.equal(result.ok, true);
  });

  it('rejects missing holder field', () => {
    const result = validateLockSchema({ turn_number: 0, last_released_by: null, claimed_at: null });
    assert.equal(result.ok, false);
    assert.ok(result.errors.some(e => e.includes('holder')));
  });

  it('rejects non-integer turn_number', () => {
    const result = validateLockSchema({ holder: null, turn_number: 1.5, last_released_by: null, claimed_at: null });
    assert.equal(result.ok, false);
    assert.ok(result.errors.some(e => e.includes('turn_number')));
  });

  it('rejects non-object input', () => {
    const result = validateLockSchema('not an object');
    assert.equal(result.ok, false);
  });
});

describe('validateStateSchema', () => {
  it('accepts a valid state', () => {
    const result = validateStateSchema({ phase: 'build', blocked: false, blocked_on: null });
    assert.equal(result.ok, true);
  });

  it('rejects missing phase', () => {
    const result = validateStateSchema({ blocked: false });
    assert.equal(result.ok, false);
  });
});

describe('validateConfigSchema', () => {
  it('accepts a valid config', () => {
    const result = validateConfigSchema({
      version: 3,
      project: 'Test',
      agents: {
        pm: { name: 'Product Manager', mandate: 'Manage product' },
        dev: { name: 'Developer', mandate: 'Write code' }
      }
    });
    assert.equal(result.ok, true);
  });

  it('rejects wrong version', () => {
    const result = validateConfigSchema({ version: 2, project: 'Test', agents: {} });
    assert.equal(result.ok, false);
    assert.ok(result.errors.some(e => e.includes('version')));
  });

  it('rejects invalid agent IDs', () => {
    const result = validateConfigSchema({
      version: 3,
      project: 'Test',
      agents: { 'Bad Agent': { name: 'Bad', mandate: 'Bad' } }
    });
    assert.equal(result.ok, false);
    assert.ok(result.errors.some(e => e.includes('Invalid agent id')));
  });

  it('rejects agents with empty mandate', () => {
    const result = validateConfigSchema({
      version: 3,
      project: 'Test',
      agents: { pm: { name: 'PM', mandate: '' } }
    });
    assert.equal(result.ok, false);
  });
});

describe('safeParseJson', () => {
  it('parses valid JSON', () => {
    const result = safeParseJson('{"a": 1}');
    assert.equal(result.ok, true);
    assert.deepEqual(result.data, { a: 1 });
  });

  it('returns error for invalid JSON', () => {
    const result = safeParseJson('{bad json}');
    assert.equal(result.ok, false);
    assert.ok(result.errors[0].includes('Invalid JSON'));
  });

  it('runs validator on parsed data', () => {
    const result = safeParseJson('{"holder": null, "turn_number": 0, "last_released_by": null, "claimed_at": null}', validateLockSchema);
    assert.equal(result.ok, true);
  });
});
