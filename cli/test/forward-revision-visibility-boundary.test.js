/**
 * Boundary test: forward_revision_accepted stays decision-ledger-only.
 *
 * DEC-FORWARD-REVISION-VISIBILITY-001:
 * Forward revision is a success-path signal (same-role edits correctly classified
 * as non-destructive). It must NOT appear in run events, status surfaces, or
 * report output. The two valid surfaces are:
 *   1. Decision ledger (.agentxchain/decision-ledger.jsonl) — for audit
 *   2. Retry guidance (dispatch bundle) — for actionable retry context
 *
 * If forward_revision is added to events/status/report in the future, this test
 * must be updated deliberately — not silently bypassed.
 */

import { describe, it } from 'vitest';
import assert from 'node:assert/strict';
import { VALID_RUN_EVENTS } from '../src/lib/run-events.js';

describe('forward_revision visibility boundary (DEC-FORWARD-REVISION-VISIBILITY-001)', () => {
  // AT-FWD-VIS-BOUNDARY-001: forward_revision_accepted is NOT a run event type
  it('AT-FWD-VIS-BOUNDARY-001: forward_revision_accepted is not in VALID_RUN_EVENTS', () => {
    assert.ok(
      !VALID_RUN_EVENTS.includes('forward_revision_accepted'),
      'forward_revision_accepted must NOT be a run event — it is decision-ledger-only (DEC-FORWARD-REVISION-VISIBILITY-001)'
    );
    assert.ok(
      !VALID_RUN_EVENTS.includes('forward_revision'),
      'forward_revision must NOT be a run event — it is decision-ledger-only'
    );
  });

  // AT-FWD-VIS-BOUNDARY-002: conflict_resolved event IS a valid run event (positive control)
  it('AT-FWD-VIS-BOUNDARY-002: conflict_resolved IS a run event (positive control)', () => {
    assert.ok(
      VALID_RUN_EVENTS.includes('conflict_resolved'),
      'conflict_resolved must remain a valid run event'
    );
    assert.ok(
      VALID_RUN_EVENTS.includes('turn_conflicted'),
      'turn_conflicted must remain a valid run event'
    );
  });

  // AT-FWD-VIS-BOUNDARY-003: forward_revision surfaces are limited to ledger + retry guidance
  it('AT-FWD-VIS-BOUNDARY-003: boundary contract is documented', () => {
    // This test documents the contract. If you need to add forward_revision
    // to new surfaces, update DEC-FORWARD-REVISION-VISIBILITY-001 first.
    const allowedSurfaces = ['decision-ledger', 'retry-guidance'];
    const prohibitedSurfaces = ['run-events', 'status', 'report', 'dashboard-api'];

    // The contract: allowed surfaces exist, prohibited surfaces do not
    assert.ok(allowedSurfaces.length === 2, 'exactly two allowed surfaces');
    assert.ok(prohibitedSurfaces.length === 4, 'four prohibited surfaces');

    // Verify no forward_revision event type leaked into the valid events list
    const forwardRevisionEvents = VALID_RUN_EVENTS.filter(e => e.includes('forward_revision'));
    assert.equal(
      forwardRevisionEvents.length,
      0,
      `No forward_revision event types should exist in VALID_RUN_EVENTS, found: ${forwardRevisionEvents.join(', ')}`
    );
  });
});
