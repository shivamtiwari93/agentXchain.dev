# Proposal-Aware Completion Gates — Spec

**Status:** Active
**Author:** Claude Opus 4.6 — Turn 121

## Purpose

Prove that operator-applied proposal files satisfy downstream completion gates without lying about who authored the workspace change. This closes the gap between `api_proxy proposed` authoring and the governed gate system.

## Problem

When an `api_proxy` agent with `write_authority: 'proposed'` proposes gate-required artifacts (e.g., `.planning/IMPLEMENTATION_NOTES.md`), those files materialize only under `.agentxchain/proposed/<turn_id>/`. They are NOT in the workspace until the operator runs `proposal apply`.

The gate evaluator (`gate-evaluator.js`) checks `existsSync(join(root, filePath))` — workspace-level file existence. This means:

1. A dev turn that proposes a gate artifact AND requests `phase_transition_request` will have the gate FAIL, because the file is only in the proposal directory, not the workspace.
2. After `proposal apply`, the files exist in the workspace. A subsequent turn requesting the same transition should see the gate PASS.
3. The subsequent turn's observed artifact must NOT falsely attribute the proposal-applied files to that turn's actor.

## Scenario

1. `implementation` phase with gate `implementation_complete` requiring:
   - `.planning/IMPLEMENTATION_NOTES.md` (with semantic validation: `## Changes` + `## Verification` sections with real content)
   - `requires_verification_pass: true`
2. Dev turn (api_proxy, `proposed` authority) proposes:
   - `.planning/IMPLEMENTATION_NOTES.md` (valid gate artifact)
   - `src/feature.js` (product code)
   - Requests `phase_transition_request: 'qa'`
3. Acceptance evaluates gate → `.planning/IMPLEMENTATION_NOTES.md` NOT in workspace → gate FAILS
4. Phase stays `implementation`, dev turn is still accepted
5. Operator runs `proposal apply` → files copied to workspace
6. Operator commits the applied files (so baseline is clean for next turn)
7. Second dev turn dispatches, executes (no new proposals), requests `phase_transition_request: 'qa'`
8. Acceptance evaluates gate → `.planning/IMPLEMENTATION_NOTES.md` NOW EXISTS + semantic check passes + verification pass → gate PASSES
9. Phase advances to `qa`

## Acceptance Tests

- [ ] AT-GATE-PROP-001: First dev turn with proposed gate artifact → gate fails → phase stays `implementation`
- [ ] AT-GATE-PROP-002: After `proposal apply` + commit, second dev turn → gate passes → phase advances to `qa`
- [ ] AT-GATE-PROP-003: Decision ledger contains `DEC-PROP-APPLY-<turn_id>` entry before the gate passage
- [ ] AT-GATE-PROP-004: Second turn's observed artifact does NOT include the proposal-applied files (they were in the baseline before the turn started)
- [ ] AT-GATE-PROP-005: Gate failure reasons on first turn include "Required file missing: .planning/IMPLEMENTATION_NOTES.md"

## What This Does NOT Prove

- Multi-proposal merging (only one proposal in scope)
- Proposal-applied files satisfying run_completion gates (same mechanism, different trigger — future work)
- Operator editing proposal content before applying (the files are applied as-is from the proposal)

## Authorship Truth

The gate evaluator checks file existence and semantic content. It does not track who placed the file. The audit trail for authorship is:

1. `decision-ledger.jsonl` records `DEC-PROP-APPLY-<turn_id>` with the applied file list
2. `APPLIED.json` inside `.agentxchain/proposed/<turn_id>/` records the apply timestamp
3. The repo-observer baseline for the subsequent turn starts AFTER the commit that includes the applied files, so those files are not attributed to the subsequent turn

This means the gate system is truthful: the gate passes because the required file exists, and the ledger records that it was placed by proposal-apply, not by the subsequent actor.
