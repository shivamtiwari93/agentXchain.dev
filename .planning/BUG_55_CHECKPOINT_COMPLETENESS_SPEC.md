# BUG-55 Checkpoint Completeness Spec

## Purpose

Prevent `checkpoint-turn` from reporting success after committing only a subset of the accepted turn's declared `files_changed` set.

This spec covers BUG-55 sub-defect A only. Verification-produced side effects remain separate work.

## Interface

- Library: `checkpointAcceptedTurn(root, { turnId })`
- CLI: `agentxchain checkpoint-turn --turn <turn_id>`

## Behavior

1. `checkpoint-turn` must normalize the accepted history entry's `files_changed` paths the same way it does today.
2. It must run `git add -A -- <declared paths>` against the normalized declared set.
3. After staging, it must partition every declared path into one of three classes:
   - **staged**: path appears in `git diff --cached` for the checkpoint.
   - **already_committed_upstream**: path is tracked in git, has zero divergence against HEAD or the index, and differs between the accepted turn's recorded `observed_artifact.baseline_ref` and current HEAD. This covers the BUG-23 legitimate pattern where the actor committed a declared file before `checkpoint-turn` ran on the same accepted lineage.
   - **genuinely_missing**: path is neither staged nor tracked-clean — it is absent from the worktree, gitignored, or tracked-but-dirty-and-not-staged.
4. The command must fail loudly before creating any commit if `genuinely_missing` is non-empty; the error must name each missing path.
5. The command must proceed and commit the staged set when `genuinely_missing` is empty, regardless of how many paths fell into `already_committed_upstream`.
6. A successful checkpoint must leave all declared actor-owned files clean in `git status`.
7. Completeness enforcement exists to prevent the tester-reported symptom of dirty declared files surviving checkpoint — it is NOT a declaration-purity gate. Declared paths that are already-committed-upstream are a legitimate workflow (see BUG-23) and must not be treated as failures.

## Error Cases

- Accepted turn not found: return error, no commit.
- Repo is not git: return error, no commit.
- `git add` fails for any declared path: return error, no commit.
- Any declared checkpointable path is genuinely missing (not staged AND not tracked-clean-in-HEAD): return error naming the missing path(s), no commit.
- Any declared checkpointable path is tracked-clean at current HEAD but unchanged since the accepted turn's `observed_artifact.baseline_ref`: treat it as genuinely missing, because the accepted lineage never absorbed the declared turn change.
- No checkpointable files exist after normalization: skip with explicit reason.
- Declared paths all resolve to `already_committed_upstream` and nothing is staged: skip with explicit reason citing upstream presence.

## Acceptance Tests

1. Command-chain proof:
   - seed a governed repo with an accepted QA turn declaring four dirty files
   - run `accept-turn` then `checkpoint-turn` as child-process CLI calls
   - assert the checkpoint commit contains all four files
   - assert `git status --short` is clean afterward
2. Genuinely-missing refusal:
   - seed an accepted turn whose `files_changed` declares one real dirty path plus one path that does not exist in the repo
   - run `checkpointAcceptedTurn`
   - assert it fails before commit and reports the never-existed path as missing
3. BUG-23 pre-commit compatibility:
   - seed an accepted turn whose declared path was committed by the actor before checkpoint runs
   - run `checkpointAcceptedTurn`
   - assert it succeeds, reports the path under `already_committed_upstream`, and does not error on "missing from checkpoint"
4. Wrong-lineage refusal:
   - seed an accepted turn, capture its recorded `observed_artifact.baseline_ref`, commit the declared file on a throwaway lineage, then restore HEAD to the accepted baseline
   - run `checkpointAcceptedTurn`
   - assert it fails and reports the path as genuinely missing, not `already_committed_upstream`

## Decisions

- `DEC-BUG55A-ALREADY-COMMITTED-UPSTREAM-002` (2026-04-20, supersedes the strict staged-only semantic from Turn 64) — A declared checkpointable path that is tracked in git and not divergent from HEAD/index counts as present for completeness, not missing. Rationale: the tester-reported BUG-55A symptom is dirty files surviving checkpoint, not declaration purity. Treating "already committed by the actor before checkpoint" as a completeness failure introduces a false-positive that regresses the historical BUG-23 pattern and blocks shippable releases for legitimate workflows.
- `DEC-BUG55A-ACCEPTED-LINEAGE-ANCHOR-003` (2026-04-20) — `already_committed_upstream` is not a pure "clean at HEAD" check. The path must also differ between the accepted turn's recorded `observed_artifact.baseline_ref` and current `HEAD`, proving the accepted lineage actually absorbed the declared change. Rationale: otherwise a wrong-branch or reset-to-baseline workflow can make a declared path look "already committed" even though the current governed branch never checkpointed it.

## Open Questions

- BUG-55 sub-defect B was closed by `DEC-BUG55B-UNDECLARED-VERIFICATION-OUTPUTS-001`.
- Declaration-purity enforcement (catching declared-but-unchanged paths) belongs at acceptance-time validation, not at checkpoint-time completeness. Not scoped for this spec.
