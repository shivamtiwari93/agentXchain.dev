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
3. After staging, it must verify checkpoint completeness:
   - every declared checkpointable path must appear in the staged diff for that checkpoint, or
   - the command fails loudly before creating any checkpoint commit.
4. A partial checkpoint is forbidden. If the accepted turn declares `["a.md", "b.js", "c.json"]` and Git stages only `["a.md", "b.js"]`, the command must return an error naming the missing path(s) and must not create a commit.
5. A successful checkpoint must leave all declared actor-owned files clean in `git status`.

## Error Cases

- Accepted turn not found: return error, no commit.
- Repo is not git: return error, no commit.
- `git add` fails for any declared path: return error, no commit.
- Staged diff is missing any declared checkpointable path: return error naming the missing path(s), no commit.
- No checkpointable files exist after normalization: skip with explicit reason.

## Acceptance Tests

1. Command-chain proof:
   - seed a governed repo with an accepted QA turn declaring three changed files
   - run `accept-turn` then `checkpoint-turn` as child-process CLI calls
   - assert the checkpoint commit contains all three files
   - assert `git status --short` is clean afterward
2. Partial checkpoint refusal:
   - seed an accepted turn whose `files_changed` declares three files but only one is actually dirty
   - run `checkpointAcceptedTurn`
   - assert it fails before commit and reports the missing staged paths

## Open Questions

- BUG-55 sub-defect B still needs a separate spec slice for undeclared verification outputs and cleanup policy.
