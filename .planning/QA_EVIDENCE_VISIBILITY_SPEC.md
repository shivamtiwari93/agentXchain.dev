# QA Evidence Visibility Spec

## Purpose

Close the QA evidence visibility gap: `renderContext()` in `dispatch-bundle.js` drops machine evidence, file-change lists, and observed-artifact data from the last accepted turn when building `CONTEXT.md`. QA agents cannot issue a clean ship verdict because they literally cannot see what the dev turn proved.

## Problem

History entries contain rich evidence:
- `files_changed` — list of files modified by the dev
- `verification` — `{ status, commands, evidence_summary, machine_evidence[] }`
- `normalized_verification` — runner-normalized verification with consistent shape
- `observed_artifact` — actual filesystem observation at acceptance time

But `renderContext()` (line 363-385) only renders: `turn_id`, `role`, `summary`, `decisions`, `objections`.

In the live Scenario A rerun (Turn 70), the QA agent raised high-severity OBJ-001 ("no machine evidence of test execution") and OBJ-002 ("unverified test isolation") because it had no access to the dev turn's verification data or file list. The run blocked on `needs_human`.

## Interface

### CONTEXT.md — New Sections Under "Last Accepted Turn"

After the existing decisions/objections rendering, `renderContext()` adds:

1. **Files Changed** — renders `lastTurn.files_changed` as a bullet list
2. **Verification** — renders:
   - `verification.status` (pass/fail/skipped)
   - `verification.commands` as a bullet list
   - `verification.evidence_summary` as quoted text
   - `verification.machine_evidence[]` as a table: command | exit_code
3. **Observed Artifact** — renders:
   - `observed_artifact.files_changed` (observed, vs declared above)
   - `observed_artifact.lines_added` / `lines_removed` if present

### Guard: No New Fields

This spec does NOT add new data to the history entry. It only renders fields that are already written by `acceptGovernedTurn()`. The fix is purely in the rendering layer.

## Behavior

- If `files_changed` is empty or absent, the section is omitted.
- If `verification` is absent or empty, the section is omitted.
- If `machine_evidence` is absent or empty, only `status`/`commands`/`evidence_summary` are shown.
- If `observed_artifact` is absent, the section is omitted.
- All rendering is additive — existing context sections are unchanged.

## Acceptance Tests

1. **AT-QEV-001**: A dispatch bundle for a QA turn following a dev turn with `machine_evidence` must contain the verification status, commands, and machine evidence in CONTEXT.md.
2. **AT-QEV-002**: A dispatch bundle for a QA turn following a dev turn with `files_changed` must list the changed files in CONTEXT.md.
3. **AT-QEV-003**: If verification is empty/absent, no verification section appears.
4. **AT-QEV-004**: If files_changed is empty/absent, no files changed section appears.
5. **AT-QEV-005**: Existing context sections (state, decisions, objections, blockers, gates) are unchanged.

## Decision

- `DEC-QA-EVIDENCE-001`: QA evidence visibility is a rendering fix in `renderContext()`, not a protocol or history schema change.
