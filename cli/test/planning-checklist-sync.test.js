import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it } from 'node:test';

const ROOT = resolve(import.meta.dirname, '..', '..');
const read = (rel) => readFileSync(resolve(ROOT, rel), 'utf8');

function uncheckedAcceptanceItems(text) {
  return text
    .split('\n')
    .filter((line) => line.startsWith('- [ ]'));
}

describe('planning acceptance checklist sync', () => {
  it('keeps the continuous intake doc spec fully checked once shipped', () => {
    const spec = read('.planning/CONTINUOUS_DELIVERY_INTAKE_DOC_SPEC.md');
    assert.deepEqual(
      uncheckedAcceptanceItems(spec),
      [],
      'continuous delivery intake doc spec should not carry stale unchecked acceptance items'
    );
  });

  it('keeps the intake coordinator boundary spec fully checked once shipped', () => {
    const spec = read('.planning/INTAKE_COORDINATOR_BOUNDARY_SPEC.md');
    assert.deepEqual(
      uncheckedAcceptanceItems(spec),
      [],
      'intake coordinator boundary spec should not carry stale unchecked acceptance items'
    );
  });

  it('keeps the adapters doc spec limited to the remaining UI proof gaps', () => {
    const spec = read('.planning/ADAPTERS_DOC_PAGE_SPEC.md');
    assert.deepEqual(
      uncheckedAcceptanceItems(spec),
      [
        '- [ ] Page loads at `/docs/adapters` with no JS errors',
        '- [ ] Footer matches quickstart footer',
        '- [ ] Page is responsive at 768px and 375px widths',
      ],
      'adapters doc spec should only remain open on the three unproved UI-level assertions'
    );
  });
});
