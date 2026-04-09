import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { array, nullable, number, object, string, union } from '../src/index.js';

describe('schema-guard composition', () => {
  it('supports transform and pipe composition', () => {
    const adultAge = string()
      .transform((value) => Number.parseInt(value, 10))
      .pipe(number({ integer: true, min: 18 }));

    assert.equal(adultAge.parse('21'), 21);
  });

  it('surfaces transform errors as validation issues', () => {
    const numericCode = string().transform((value) => {
      const parsed = Number.parseInt(value, 10);
      if (Number.isNaN(parsed)) {
        throw new Error('code must be numeric');
      }
      return parsed;
    });

    const result = numericCode.safeParse('nope');
    assert.equal(result.success, false);
    assert.equal(result.issues[0].code, 'transform');
    assert.equal(result.issues[0].message, 'code must be numeric');
  });

  it('supports union validation', () => {
    const priceSchema = union([number({ min: 0 }), string({ pattern: /^free$/ })]);
    assert.equal(priceSchema.parse('free'), 'free');
    assert.equal(priceSchema.parse(19), 19);
  });

  it('fails closed when union branches do not match', () => {
    const priceSchema = union([number({ min: 0 }), string({ pattern: /^free$/ })]);
    const result = priceSchema.safeParse(false);
    assert.equal(result.success, false);
    assert.equal(result.issues[0].code, 'union');
  });

  it('supports nullable and optional branches inside object graphs', () => {
    const orderSchema = object({
      id: string(),
      notes: nullable(string({ minLength: 3 })).optional(),
      items: array(
        object({
          sku: string(),
          qty: number({ integer: true, min: 1 }),
        }),
        { minLength: 1 },
      ),
    });

    const parsed = orderSchema.parse({
      id: 'ord_1',
      notes: null,
      items: [{ sku: 'kit-1', qty: 2 }],
    });

    assert.equal(parsed.notes, null);
  });

  it('supports custom refinement messages as functions', () => {
    const tag = string().refine(
      (value) => value.startsWith('ax-'),
      ({ value }) => `"${value}" must start with ax-`,
    );

    const result = tag.safeParse('beta');
    assert.equal(result.success, false);
    assert.equal(result.issues[0].message, '"beta" must start with ax-');
  });
});
