import assert from 'node:assert/strict';

import { sg } from '../src/index.js';

const checkoutSchema = sg.object({
  orderId: sg.string({ pattern: /^ord_[a-z0-9]+$/ }),
  customer: sg.object({
    email: sg.string().refine((value) => value.includes('@'), 'customer email must contain @'),
    name: sg.string({ minLength: 2 }),
  }),
  items: sg.array(
    sg.object({
      sku: sg.string(),
      quantity: sg.number({ integer: true, min: 1 }),
      unitPriceCents: sg.number({ integer: true, min: 0 }),
    }),
    { minLength: 1 },
  ),
  discountCode: sg.string().optional(),
  metadata: sg.object({
    source: sg.enum(['web', 'api']),
    priority: sg.enum(['normal', 'rush']).default('normal'),
  }),
});

const parsed = checkoutSchema.parse({
  orderId: 'ord_ax9',
  customer: {
    email: 'buyer@example.com',
    name: 'Buyer',
  },
  items: [
    { sku: 'schema-guard-shirt', quantity: 2, unitPriceCents: 2500 },
    { sku: 'sticker-pack', quantity: 1, unitPriceCents: 500 },
  ],
  metadata: {
    source: 'api',
  },
});

assert.equal(parsed.metadata.priority, 'normal');
assert.equal(parsed.items.length, 2);
assert.equal(parsed.customer.email, 'buyer@example.com');

console.log('schema-guard smoke: PASS');
