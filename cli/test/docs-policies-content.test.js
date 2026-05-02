import { describe, it } from 'vitest';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const DOC_PATH = resolve(import.meta.dirname, '../../website-v2/docs/policies.mdx');
const SPEC_PATH = resolve(import.meta.dirname, '../../.planning/REPRODUCIBLE_VERIFICATION_POLICY_SPEC.md');

const DOC = readFileSync(DOC_PATH, 'utf8');
const SPEC = readFileSync(SPEC_PATH, 'utf8');

describe('policies docs reproducible verification guard', () => {
  it('documents require_reproducible_verification as a built-in rule', () => {
    assert.match(DOC, /require_reproducible_verification/);
    assert.match(DOC, /verification\.machine_evidence/);
    assert.match(DOC, /trusted agent-authored execution intent/i);
    assert.match(DOC, /verify turn/);
  });

  it('keeps the spec and docs aligned on acceptance-time replay enforcement', () => {
    assert.match(SPEC, /require_reproducible_verification/);
    assert.match(SPEC, /verify turn/i);
    assert.match(SPEC, /acceptance/i);
    assert.match(SPEC, /verified_at/);
    assert.match(SPEC, /trusted execution surface/i);
  });
});
