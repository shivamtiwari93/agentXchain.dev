import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { SchemaGuardError, enumValue, formatIssues, number, string } from '../src/index.js';

describe('schema-guard primitives', () => {
  it('validates strings with min length and pattern checks', () => {
    const username = string({ minLength: 3, pattern: /^[a-z0-9_-]+$/ });
    assert.equal(username.parse('agent_team'), 'agent_team');
  });

  it('returns custom string messages when configured', () => {
    const slug = string({
      minLength: 4,
      messages: {
        minLength: 'slug is too short',
      },
    });

    const result = slug.safeParse('abc');
    assert.equal(result.success, false);
    assert.equal(result.issues[0].message, 'slug is too short');
  });

  it('validates integers with bounds', () => {
    const port = number({ integer: true, min: 1024, max: 65535 });
    assert.equal(port.parse(3000), 3000);
  });

  it('rejects non-finite numbers', () => {
    const budget = number();
    const result = budget.safeParse(Number.NaN);
    assert.equal(result.success, false);
    assert.equal(result.issues[0].code, 'type');
  });

  it('supports enum values', () => {
    const state = enumValue(['draft', 'active', 'archived']);
    assert.equal(state.parse('active'), 'active');
  });

  it('parse throws SchemaGuardError with issue metadata', () => {
    const positive = number({ min: 1 });
    assert.throws(
      () => positive.parse(0),
      (error) => {
        assert.ok(error instanceof SchemaGuardError);
        assert.equal(error.issues.length, 1);
        assert.equal(error.issues[0].path, '$');
        assert.match(error.message, /Expected number >= 1/);
        return true;
      },
    );
  });

  it('formatIssues renders readable output', () => {
    const status = enumValue(['todo', 'done']);
    const result = status.safeParse('blocked');
    assert.equal(result.success, false);
    assert.equal(formatIssues(result.issues), '$: Expected one of "todo", "done"');
  });
});
