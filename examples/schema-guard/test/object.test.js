import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { array, boolean, number, object, string } from '../src/index.js';

describe('schema-guard objects', () => {
  const userSchema = object({
    id: string({ pattern: /^usr_[a-z0-9]+$/ }),
    email: string().refine((value) => value.includes('@'), 'email must contain @'),
    age: number({ integer: true, min: 13 }),
    newsletter: boolean().default(false),
    profile: object({
      displayName: string({ minLength: 2 }),
      interests: array(string({ minLength: 2 }), { minLength: 1 }),
      timezone: string().optional(),
    }),
  });

  it('parses nested objects and applies defaults', () => {
    const parsed = userSchema.parse({
      id: 'usr_agent1',
      email: 'agent@example.com',
      age: 29,
      profile: {
        displayName: 'Agent Team',
        interests: ['cli', 'governance'],
      },
    });

    assert.equal(parsed.newsletter, false);
    assert.deepEqual(parsed.profile.interests, ['cli', 'governance']);
    assert.ok(!Object.prototype.hasOwnProperty.call(parsed.profile, 'timezone'));
  });

  it('reports nested paths for invalid values', () => {
    const result = userSchema.safeParse({
      id: 'usr_agent2',
      email: 'agent@example.com',
      age: 22,
      profile: {
        displayName: 'OK',
        interests: ['valid', 'x'],
      },
    });

    assert.equal(result.success, false);
    assert.equal(result.issues[0].path, '$.profile.interests[1]');
    assert.match(result.issues[0].message, /at least 2 characters/);
  });

  it('rejects unknown keys by default', () => {
    const result = userSchema.safeParse({
      id: 'usr_agent3',
      email: 'agent@example.com',
      age: 33,
      profile: {
        displayName: 'Agent',
        interests: ['docs'],
      },
      extra: true,
    });

    assert.equal(result.success, false);
    assert.equal(result.issues[0].path, '$.extra');
    assert.match(result.issues[0].message, /Unknown key "extra"/);
  });

  it('allows unknown keys when configured', () => {
    const looseSchema = object(
      {
        name: string(),
      },
      { allowUnknown: true },
    );

    const parsed = looseSchema.parse({ name: 'kit', extra: 'kept' });
    assert.equal(parsed.extra, 'kept');
  });

  it('supports object-level refinement for cross-field rules', () => {
    const billingSchema = object({
      plan: string(),
      seats: number({ integer: true, min: 1 }),
    }).refine(
      (value) => value.plan !== 'enterprise' || value.seats >= 10,
      'enterprise plan requires at least 10 seats',
    );

    const result = billingSchema.safeParse({ plan: 'enterprise', seats: 5 });
    assert.equal(result.success, false);
    assert.equal(result.issues[0].path, '$');
    assert.equal(result.issues[0].message, 'enterprise plan requires at least 10 seats');
  });
});
