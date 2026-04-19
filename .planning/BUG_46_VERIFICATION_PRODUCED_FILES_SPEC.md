**Status:** shipped

## Purpose

Close the remaining BUG-46 ambiguity around verification-generated repo files.

`files_changed` alone cannot distinguish between:

- repo mutations that are genuine turn artifacts and must be checkpointed
- verification side effects that should not remain dirty after acceptance

Without an explicit contract, acceptance, checkpoint, and resume can still disagree about what the accepted turn actually owns.

## Interface

Extend staged turn results with an optional `verification.produced_files` field:

```json
{
  "verification": {
    "status": "pass",
    "machine_evidence": [
      { "command": "node tests/smoke.mjs", "exit_code": 0 }
    ],
    "produced_files": [
      { "path": "tests/fixtures/express-sample/tusq.manifest.json", "disposition": "artifact" },
      { "path": ".planning/ship-verdict.md", "disposition": "ignore" }
    ]
  }
}
```

Entry contract:

- `path`: repo-relative file path
- `disposition`:
  - `artifact`: this file is part of the accepted turn artifact set and must be treated as an owned repo mutation
  - `ignore`: this file is an expected verification side effect and must be cleaned back to the dispatch baseline before acceptance persists history

## Behavior

1. Acceptance computes an effective declared file set as:
   - top-level `files_changed`
   - plus every `verification.produced_files[].path` marked `artifact`
2. The effective declared file set is the set used for:
   - declared-vs-observed comparison
   - empty-workspace-artifact validation
   - overlap/conflict detection
   - accepted history `files_changed`
   - checkpoint eligibility
3. `verification.produced_files[].disposition === "ignore"` is actionable, not documentary:
   - acceptance restores those paths to the dispatch baseline before artifact observation is finalized
   - ignored files may not remain as actor-owned dirty workspace after acceptance succeeds
4. Ignored verification files are fail-closed when the framework cannot safely restore them:
   - if the path was already dirty at dispatch and changed again, acceptance rejects instead of guessing
5. Operational/framework-owned paths remain excluded. `verification.produced_files` is only for actor-owned repo paths.

## Error Cases

- `verification.produced_files` entry is missing `path` or has an invalid `disposition`
  - staged turn validation fails
- same produced file path is declared more than once
  - staged turn validation fails
- same path is both `files_changed` and `verification.produced_files` with `disposition: "ignore"`
  - staged turn validation fails
- ignored produced file cannot be restored safely to the dispatch baseline
  - acceptance fails with a verification-produced-files cleanup error
- authoritative completed turn declares `artifact.type: "workspace"` but the effective declared file set is empty
  - acceptance fails with `empty_workspace_artifact`

## Acceptance Tests

1. Authoritative completed turn with `artifact.type: "workspace"`, top-level `files_changed: []`, and `verification.produced_files: [{ path, disposition: "artifact" }]` accepts when observation sees that file and checkpoint commits it.
2. Authoritative completed turn with `verification.produced_files: [{ path, disposition: "ignore" }]` restores the ignored file before acceptance persists history, leaving resume unblocked.
3. Duplicate produced-file paths are rejected by staged turn validation.
4. `disposition: "ignore"` for a path also listed in top-level `files_changed` is rejected by staged turn validation.
5. Ignored produced files that were already dirty at dispatch fail closed if acceptance cannot safely restore the pre-turn state.

## Open Questions

1. Should a future baseline format capture restorable bytes for dirty files so ignored verification side effects can safely target baseline-dirty paths too?
2. Should CLI docs surface `verification.produced_files` now, or wait until operators ask for the contract explicitly?
