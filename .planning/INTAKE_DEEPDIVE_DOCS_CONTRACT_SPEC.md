# Intake Deep-Dive Docs Contract Spec

## Purpose

Define the truthfulness contract for `/docs/continuous-delivery-intake` against `cli/src/lib/intake.js` and `cli/bin/agentxchain.js`. This spec records defects found during the Turn 15 audit and the acceptance tests that guard against regression.

## Defects Found

### DEFECT 1 — Paused-state behavioral lie (operator-breaking)

**Location:** Docs line 306-307, "Start constraints" section.

**Claim:** "Under the current governed-state contract, `paused` is an approval-held state, not a generic resumable idle state for intake."

**Status:** RESOLVED (Turn 153). The auto-resume code was removed from `startIntent()`. `intake start` now explicitly rejects paused runs unconditionally, aligning with `V3_S3_START_SPEC.md` and `DEC-V3S3-PAUSE-001`. The schema validator also rejects paused states without `pending_phase_transition` or `pending_run_completion`. Docs updated to document rejection behavior.

### DEFECT 2 — Undocumented idle bootstrap behavior

**Location:** "Start constraints" section (missing).

**Reality:** `intake.js:544-549` initializes a new governed run from idle state:
```js
if (state.status === 'idle' && !state.run_id) {
    const initResult = initializeGovernedRun(root, config);
    ...
}
```

The docs list rejection conditions but do not mention that `intake start` can bootstrap a fresh run. An operator would expect to need `agentxchain init` first.

**Severity:** Misleading. Not operator-breaking (it works), but undocumented capability.

### DEFECT 3 — Missing `run_blocked_recovery` in resolve output

**Location:** Resolve result shape and example (docs lines 335-359).

**Reality:** `intake.js:707` sets `intent.run_blocked_recovery = state.blocked_reason?.recovery?.recovery_action || null`. The resolve docs only show `run_blocked_on` and `run_blocked_reason`. An operator building recovery automation would miss the recovery action field.

**Severity:** Incomplete. Not wrong, but operationally relevant for automation.

### DEFECT 4 — Missing all-rejected scan failure semantics

**Location:** Scan result semantics section (missing rule).

**Reality:** `intake.js:894-900` returns `ok: false` when every scanned item is rejected:
```js
if (created === 0 && deduplicated === 0) {
    return { ok: false, error: 'all scanned items were rejected', ... };
}
```

The docs describe per-item rejection but not the aggregate failure rule. An operator would not know that an all-rejected snapshot produces a scan-level failure.

**Severity:** Missing behavioral contract.

### DEFECT 5 — Weak guard test (no code-backed verification)

**Location:** `cli/test/continuous-delivery-intake-content.test.js`.

**Reality:** The existing guard only checks string presence in docs text. It does not read `intake.js` to verify that:
- Documented state transitions match `VALID_TRANSITIONS`
- Documented sources match `VALID_SOURCES` and `SCAN_SOURCES`
- Documented template IDs match `VALID_GOVERNED_TEMPLATE_IDS`
- Start constraint claims match implementation logic
- Resolve outcome mapping matches implementation branches

**Severity:** Guard gap. Drift in implementation would not be caught.

## Acceptance Tests

1. Docs must document that `intake start` rejects paused runs (approval-held state)
2. Docs must document that `intake start` can bootstrap from idle (no existing run)
3. Resolve result shape must include `run_blocked_recovery`
4. Scan section must document all-rejected aggregate failure rule
5. Guard must read `VALID_TRANSITIONS` from `intake.js` and verify docs match
6. Guard must read `VALID_SOURCES` and `SCAN_SOURCES` from `intake.js`
7. Guard must read `VALID_GOVERNED_TEMPLATE_IDS` from `governed-templates.js`
8. Guard must verify resolve outcome mapping states against implementation
9. Guard must verify no ghost states in docs state machine
10. Guard must verify docs do not advertise nonexistent failed-outcome fields such as `run_failed_at`

## Files Affected

- `website-v2/docs/continuous-delivery-intake.mdx` — docs fixes
- `cli/test/continuous-delivery-intake-content.test.js` — guard strengthening
- `.planning/INTAKE_DEEPDIVE_DOCS_CONTRACT_SPEC.md` — this spec
