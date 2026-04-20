# BUG-55 Sub-Defect B — Verification Output Declaration Spec

> Narrow slice. Rejection-first. No auto-classification heuristics.
> Scope: when a turn declares `verification.commands` or `verification.machine_evidence`
> and produces untracked/dirty actor-owned files that are NOT classified under
> `files_changed` or `verification.produced_files`, acceptance must reject with
> a dedicated error class and an actionable message that names the files.

## Purpose

Close the HUMAN-ROADMAP BUG-55 sub-defect B gap:

- Tester's evidence (`run_5fa4a26c3973e02d`): QA acceptance initially failed at
  `2026-04-20T11:52:24.291Z` because untracked fixture outputs appeared that
  were not declared by the turn — `tests/fixtures/.../scan.json`,
  `tests/fixtures/.../tusq.config.json` etc.
- BUG-46 added the `verification.produced_files` schema field, but the
  acceptance path treats all undeclared dirty files identically
  (`error_code: 'artifact_dirty_tree_mismatch'`) with a generic message. The
  operator/agent is left to infer that the correct remediation is a
  `verification.produced_files` entry rather than a `files_changed` entry.

## Position — Rejection-First (Explicit)

HUMAN-ROADMAP BUG-55 fix requirement #2 lists two mutually-exclusive options:

- **(A)** auto-detect fixture-generating verification commands and
  auto-classify their outputs
- **(B)** force acceptance to reject turns where verification commands produce
  untracked files without declaration

We pick **(B)** rejection-first. Reasoning:

1. **Vision alignment.** `VISION.md` frames the product around *explicit*
   artifacts, charters, and declarations. Auto-classification is a silent
   heuristic — exactly the shape we have repeatedly rejected (BUG-46 replay
   workspace guard is a cleanup path, not a classifier).
2. **Governance contract stays tight.** The agent must declare the shape of
   its verification outputs. Auto-classification hides the contract and
   trains agents to rely on path heuristics that differ per project.
3. **Fix shape is minimal.** The acceptance path already rejects; we only
   sharpen the error code and message when the turn declared verification
   commands, so the agent/operator knows the correct remediation is
   `verification.produced_files` (with disposition `artifact` or `ignore`),
   not `files_changed`.
4. **Auto-classification keeps the escape hatch open.** If a future project
   wants path-based auto-classification (e.g., `tests/fixtures/**` → ignore),
   it can be layered on top of the rejection gate later as an explicit
   project-policy opt-in. Not today.

## Interface

No new CLI surface, no new schema field. Changes are entirely internal to the
acceptance path:

- `acceptGovernedTurn()` — when `detectDirtyFilesOutsideAllowed()` fails AND
  the turn result declared `verification.commands` or
  `verification.machine_evidence`, emit:
  - `error_code: 'undeclared_verification_outputs'`
  - `reason:` a message that names the undeclared paths and explicitly tells
    the agent to classify each under `verification.produced_files` with
    disposition `artifact` (checkpoint) or `ignore` (clean up), or add to
    `files_changed` if it is a core turn mutation.
- When no verification commands were declared, keep the existing
  `error_code: 'artifact_dirty_tree_mismatch'` and its existing message. A
  turn that did not run verification cannot have produced verification
  outputs, so the diagnosis differs.

## Behavior

Given a governed QA turn with:

- `verification.commands = ['node tests/smoke.mjs']` (or non-empty
  `machine_evidence`)
- `files_changed = ['src/cli.js']` (core turn mutations only)
- Working tree has `src/cli.js` + `tests/fixtures/sample/.tusq/scan.json`
  dirty, the latter produced by the verification command and not declared.

Before fix:
- Acceptance rejects with `error_code: 'artifact_dirty_tree_mismatch'` and a
  message that mentions both `files_changed` and
  `verification.produced_files` as equally-weighted options.

After fix:
- Acceptance rejects with `error_code: 'undeclared_verification_outputs'` and
  a message that:
  - Names the undeclared paths
  - Tells the agent to classify each under `verification.produced_files`
    (disposition `artifact` or `ignore`) if produced by a verification
    command, or `files_changed` if a core mutation
  - References `acceptance cannot proceed until the declared contract
    matches the working tree`

Given the same turn with correctly-declared
`verification.produced_files = [{ path: 'tests/fixtures/sample/.tusq/scan.json',
disposition: 'ignore' }]`, acceptance must succeed cleanly. The ignored file is
restored by `cleanupIgnoredVerificationFiles()` pre-observation (existing
BUG-46 behavior), so post-acceptance the tree contains only declared
`files_changed`.

## Error Cases

- Turn has verification commands declared AND unexpected dirty files
  → `error_code: 'undeclared_verification_outputs'`, stage
    `artifact_observation`, `failure_reason` names the files and the
    remediation verb `verification.produced_files`
- Turn has no verification commands AND unexpected dirty files
  → existing `error_code: 'artifact_dirty_tree_mismatch'` path, no change
- Turn declares `verification.produced_files` entries that cover every
  unexpected dirty file → acceptance succeeds (BUG-46 path, no regression)

## Acceptance Tests

Mandatory tester-sequence coverage, per HUMAN-ROADMAP rule 13:

1. **Rejection path** — seed a QA turn with
   `verification.commands = ['node tests/smoke.mjs']` plus an untracked
   fixture file not declared anywhere. Run `accept-turn` as a child-process
   CLI invocation. Assert:
   - non-zero exit code
   - stdout/stderr names the undeclared file path
   - stdout/stderr contains `verification.produced_files`
   - `.agentxchain/events.jsonl` contains an `acceptance_failed` event
     whose `payload.error_code === 'undeclared_verification_outputs'`
   - `state.json` shows the turn in `failed_acceptance`
2. **Acceptance path** — same turn with
   `verification.produced_files = [{ path, disposition: 'ignore' }]` declared.
   Run `accept-turn`. Assert:
   - exit 0
   - turn committed into accepted history
   - `git status --short` is clean (the ignored file was cleaned up)

Both assertions use `spawnSync(process.execPath, [CLI_PATH, 'accept-turn',
--turn, turnId])`, matching the tester's real command chain.

## Open Questions

- Should the schema validator *require* a `verification.produced_files` entry
  for each file written during replay when `machine_evidence` is present?
  **Deferred.** That would force every verification command to declare its
  outputs even when the replay workspace guard already cleans them up
  automatically. The tester's observed failure is at acceptance time
  (pre-replay), not replay time. The rejection-first gate here is enough.
- Should the `reason` message include the specific command that likely
  produced the file? **Deferred.** Pre-replay we don't know which command
  wrote which file without tracing. The message can name the declared
  commands as candidates without committing to attribution. Kept simple for
  this slice.

## Proof Surface

- Source: `cli/src/lib/governed-state.js` — sharpened error_code + reason in
  the `detectDirtyFilesOutsideAllowed` failure branch of
  `_acceptGovernedTurnLocked`.
- Test: `cli/test/beta-tester-scenarios/bug-55-verification-output-declaration.test.js`
  — rejection + acceptance subtests, both via `spawnSync(CLI_PATH, ...)`.
- No schema change, no new CLI flag, no new runtime dependency.
