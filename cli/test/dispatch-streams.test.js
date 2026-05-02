import { describe, it } from 'vitest';
import assert from 'node:assert/strict';

import {
  isKnownTurnRunningProofStream,
  isPersistedTurnStartupProofStream,
  isDispatchProgressProofOutputStream,
  isDispatchProgressDiagnosticStream,
} from '../src/lib/dispatch-streams.js';

describe('dispatch stream contracts', () => {
  it('accepts only the closed lifecycle proof stream set', () => {
    assert.equal(isKnownTurnRunningProofStream('stdout'), true);
    assert.equal(isKnownTurnRunningProofStream('staged_result'), true);
    assert.equal(isKnownTurnRunningProofStream('request'), true);
    assert.equal(isKnownTurnRunningProofStream('stderr'), false);
    assert.equal(isKnownTurnRunningProofStream('mcp'), false);
  });

  it('treats legacy untagged state as startup proof but rejects unknown tags', () => {
    assert.equal(isPersistedTurnStartupProofStream(null), true);
    assert.equal(isPersistedTurnStartupProofStream(undefined), true);
    assert.equal(isPersistedTurnStartupProofStream('stdout'), true);
    assert.equal(isPersistedTurnStartupProofStream('request'), true);
    assert.equal(isPersistedTurnStartupProofStream('stderr'), false);
    assert.equal(isPersistedTurnStartupProofStream('mcp'), false);
  });

  it('keeps dispatch-progress proof and diagnostics stream-specific', () => {
    assert.equal(isDispatchProgressProofOutputStream('stdout'), true);
    assert.equal(isDispatchProgressProofOutputStream('stderr'), false);
    assert.equal(isDispatchProgressProofOutputStream('mcp'), false);
    assert.equal(isDispatchProgressDiagnosticStream('stderr'), true);
    assert.equal(isDispatchProgressDiagnosticStream('stdout'), false);
    assert.equal(isDispatchProgressDiagnosticStream('mcp'), false);
  });
});
