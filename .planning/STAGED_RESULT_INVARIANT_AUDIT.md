# Staged Result Invariant Audit

## Purpose

This audit maps validator-enforced staged-result invariants to prompt coverage, normalization coverage, and fail-fast behavior. It exists to close the BUG-78/BUG-79 class instead of chasing one malformed field at a time.

## Invariant Table

| Invariant | Enforced In | Prompt Coverage | Normalizer Coverage | Fail-Fast / Recovery |
| --- | --- | --- | --- | --- |
| Required top-level fields exist (`schema_version`, `run_id`, `turn_id`, `role`, `runtime_id`, `status`, `summary`, `decisions`, `objections`, `files_changed`, `verification`, `artifact`, `proposed_next_role`) | `turn-result-validator.js` schema stage | Dispatch bundle field rules list required fields; generated role prompts tell roles to write structured turn result | None; missing required objects fail closed | Schema failure; no invented top-level data |
| `objections[].id` matches `OBJ-NNN` (digits only) | `turn-result-validator.js` schema stage | Dispatch bundle field rule says `OBJ-NNN` with explicit "no extra suffixes" guidance | Invalid/missing IDs rewritten to `OBJ-001`, `OBJ-002`, ... by array index | Never fail-fast; always normalizable |
| `objections[].statement` is non-empty | `turn-result-validator.js` schema stage | Dispatch bundle objection template and field rule require `statement`; PM/QA prompts explicitly reject `summary` as a substitute | `summary` -> `statement`; `detail` -> `statement`; summary wins when both exist | If no recoverable text exists, fail with `--normalize-staged-result` recovery boundary |
| `decisions[].rationale` is non-empty | `turn-result-validator.js` schema stage | Dispatch bundle field rule requires `rationale` and explains it cannot be omitted | `reason` / `why` / `description` / `decision` / `statement` -> `rationale` | If no recoverable text exists, schema failure remains correct |
| Review-only roles include at least one objection | `turn-result-validator.js` protocol stage | Dispatch bundle and QA/director prompts state challenge requirement | None | Protocol failure |
| `workspace` artifact means repo mutation and non-empty `files_changed` unless an explicit no-edit lifecycle signal exists | `governed-state.js` artifact validation + observed diff checks | Dispatch bundle, generated prompts, PM/QA prompts state zero-edit work must use `review` and `workspace` only when files changed | Empty workspace + no-edit lifecycle signal -> `review`; emits `artifact_type_auto_normalized` and `staged_result_auto_normalized` | Ambiguous empty workspace with no lifecycle signal still fails; dirty worktree still fails observed-diff checks |
| `review` artifact with product file changes is invalid for authoritative roles | `turn-result-validator.js` artifact stage | Dispatch bundle says `review` is for zero repo edits | None | Artifact failure |
| `review_only` role cannot claim product file changes | `turn-result-validator.js` artifact stage | Dispatch bundle and QA/director prompts state review-only file boundary | None | Artifact failure |
| Proposed `api_proxy` / `remote_agent` file-changing turns must use `patch` and `proposed_changes[]` | `turn-result-validator.js` artifact stage | Dispatch bundle proposed-runtime rules state `patch`, not `workspace` or `commit` | None | Artifact failure |
| Verification `pass` requires zero-exit machine evidence when supplied | `turn-result-validator.js` verification stage | Dispatch bundle field rules state pass requires zero machine evidence exit codes | None | Verification failure |
| `phase_transition_request` and `run_completion_request` are mutually exclusive | `turn-result-validator.js` protocol stage | Dispatch bundle field rules state mutual exclusion | Some role/phase lifecycle corrections exist for known review-only drift | Protocol failure when still ambiguous |
| `phase_transition_request` must name a phase, not a gate | `turn-result-validator.js` normalizer + protocol stage | Dispatch bundle lists valid phases and warns not to use gate names | Gate name -> forward phase / terminal completion correction | Protocol failure if still invalid |

## Normalizer Table

| Class | Repair | Event |
| --- | --- | --- |
| BUG-78 empty workspace no-edit review | `artifact.type = "review"`, `artifact.ref = "turn:<turn_id>"` | `artifact_type_auto_normalized`, `staged_result_auto_normalized` |
| BUG-79 objection summary/detail shape | `objections[i].statement = summary || detail` | `staged_result_auto_normalized` |
| BUG-89 invalid objection ID | `objections[i].id` rewritten to `OBJ-{i+1}` (zero-padded 3 digits) | `staged_result_auto_normalized` |
| BUG-90 broad staged-result normalization (7 classes) | status synonyms, object files_changed, decision id/statement/category, verification.status, artifact.type | `staged_result_auto_normalized` |
| BUG-91 baseline-dirty unchanged files | Files in `baseline.dirty_snapshot` with matching SHA excluded from dirty parity check | `baseline_dirty_unchanged_excluded` |
| BUG-95 files_modified → files_changed | `files_modified` array renamed to `files_changed` when `files_changed` absent | `staged_result_auto_normalized` |
| BUG-95 missing runtime_id | Defaulted from dispatch context `activeTurn.runtime_id` | `staged_result_auto_normalized` |
| BUG-95 missing summary | Synthesized from `milestone_title`, `milestone`, or fallback | `staged_result_auto_normalized` |
| BUG-95 missing artifact object | Inferred `{ type: workspace/review }` from `files_changed` | `staged_result_auto_normalized` |
| BUG-95 missing proposed_next_role | Defaulted to first allowed role for current phase (excluding self) | `staged_result_auto_normalized` |
| BUG-96 missing decision rationale | `decisions[i].rationale` copied from `reason`, `why`, `description`, `decision`, or `statement` | `staged_result_auto_normalized` |

## Fail-Fast-Only Cases

- Missing required top-level fields with no safe source material AND no dispatch context to infer from (BUG-95 covers `runtime_id`, `summary`, `artifact`, `proposed_next_role`, `files_changed` via `files_modified` rename).
- Objections without `statement`, `summary`, or `detail`.
- Dirty worktree mismatches after artifact normalization (except baseline-unchanged files per BUG-91).
- Review artifacts that declare product file edits.
- Review-only product-file claims.
- Baseline-dirty files whose SHA CHANGED during the turn (modified without declaring).

## Acceptance Evidence

- `cli/test/beta-tester-scenarios/bug-78-no-edit-review-artifact-type.test.js`
- `cli/test/beta-tester-scenarios/bug-79-objection-statement-normalization.test.js`
- `cli/test/beta-tester-scenarios/bug-89-objection-id-normalization.test.js`
- `cli/test/beta-tester-scenarios/bug-90-broad-staged-result-normalization.test.js`
- `cli/test/beta-tester-scenarios/bug-91-baseline-dirty-unchanged-acceptance.test.js`
- `cli/test/beta-tester-scenarios/bug-95-missing-required-fields-normalization.test.js`
- `cli/test/beta-tester-scenarios/bug-96-decision-rationale-normalization.test.js`
