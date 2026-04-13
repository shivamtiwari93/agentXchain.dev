# Cross-Machine Continuity Restore Spec

**Status:** shipped
**Author:** GPT 5.4 (Turn 16)

## Purpose

Close the next honest long-horizon gap after multi-session continuity: move an in-progress governed run from one machine to another checkout of the same repo without creating a new run or rewriting history by hand.

This slice is intentionally narrow. It does **not** claim full filesystem sync, hosted orchestration, or arbitrary machine migration. It proves one concrete operator path:

1. export governed state from machine A
2. restore it into another checkout of the same repo on machine B
3. continue the same `run_id`

## Interface

### Command

```bash
agentxchain restore --input <path>
```

### Inputs

- `--input <path>`: required path to a prior `agentxchain export` artifact

### Supported artifact kind

- `agentxchain_run_export` only

Coordinator restore is out of scope for this slice.

## Behavior

### Export metadata extension

Run exports add a top-level `workspace` object:

- `workspace.git.is_repo`
- `workspace.git.head_sha`
- `workspace.git.dirty_paths`
- `workspace.git.restore_supported`
- `workspace.git.restore_blockers`

This metadata exists so restore can fail truthfully instead of guessing whether the export is portable.

### What restore owns

Restore is authoritative only over governed continuity roots:

- `agentxchain.json`
- `.agentxchain/`
- `.planning/`
- `TALK.md`

Before writing restored files, the command clears those roots in the target checkout so deletions in the source export are reproduced instead of leaving stale files behind.

### Compatibility checks

`agentxchain restore` succeeds only when all of the following are true:

1. The input artifact verifies as a run export with supported schema version.
2. The artifact says `workspace.git.restore_supported === true`.
3. The target directory is a governed project.
4. The target repo is git-backed.
5. The target `HEAD` matches `workspace.git.head_sha`.
6. The target worktree is clean before restore.
7. The exported project id matches the target `agentxchain.json` project id.

### Restore result

When restore succeeds:

1. governed continuity roots are replaced from the export artifact
2. `.agentxchain/state.json` is now the exported state
3. `history.jsonl` and `decision-ledger.jsonl` remain append-only because the target checkout receives the exact exported copies
4. the next `agentxchain resume` continues inside the same `run_id`

## Boundary Rules

1. Restore does **not** migrate arbitrary product source files.
2. Exported worktrees with dirty paths outside the continuity roots are **not restoreable** in this slice.
3. Restore does **not** support coordinator workspaces yet.
4. Restore does **not** add `--force` in this slice. Unsafe restores must fail closed.

## Error Cases

1. Missing `--input` -> command error
2. Non-run export artifact -> fail clearly
3. Unsupported schema version -> fail clearly
4. Export says `restore_supported: false` -> print blockers and fail
5. Target is not a governed project -> fail clearly
6. Target is not a git repo -> fail clearly
7. Target `HEAD` differs from exported `head_sha` -> fail clearly
8. Target worktree is dirty -> fail clearly
9. Export project id differs from target project id -> fail clearly

## Acceptance Tests

- `AT-XRESTORE-001`: `restore --help` documents `--input`
- `AT-XRESTORE-002`: run export includes `workspace.git` metadata and marks restore support truthfully
- `AT-XRESTORE-003`: restore rejects exports whose dirty paths include non-restorable files
- `AT-XRESTORE-004`: restore rejects target checkout `HEAD` mismatch
- `AT-XRESTORE-005`: export from machine A, restore into machine B, then `resume` continues the same `run_id`
- `AT-XRESTORE-006`: restore rejects coordinator exports
- `AT-XRESTORE-007`: `/docs/cli`, `/docs/multi-session`, and `README.md` document the restore path truthfully in the same turn

## Open Questions

- Should a later slice restore coordinator workspaces as well as child repos?
- Should a later slice add a signed archive format instead of plain JSON export artifacts?
