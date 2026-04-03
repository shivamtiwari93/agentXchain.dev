# Dispatch Manifest Integrity — V2.1-F1 Spec

> Content-addressed dispatch bundle manifests for tamper-evident agent execution.

---

## Purpose

Dispatch bundles are the filesystem handoff between the orchestrator and agent adapters. In v2.0, a bundle is a directory of files (ASSIGNMENT.json, PROMPT.md, CONTEXT.md, optionally COORDINATOR_CONTEXT.json) with no integrity envelope. After `after_dispatch` hooks run, any process — including a misbehaving hook, a race condition, or a compromised adapter — can add, remove, or modify files in the bundle directory before the adapter reads them.

V2.1-F1 closes this gap by adding a content-addressed manifest that is written at bundle **finalization** time (after all legitimate mutations are complete) and verified by adapters **before** execution begins.

---

## Interface

### `MANIFEST.json` Format

Written to `<bundle_dir>/MANIFEST.json` at finalization time.

```json
{
  "manifest_version": "1.0",
  "run_id": "<run_id>",
  "turn_id": "<turn_id>",
  "role": "<role_id>",
  "finalized_at": "<ISO-8601 timestamp>",
  "files": [
    {
      "path": "ASSIGNMENT.json",
      "sha256": "<hex digest>",
      "size": 1234
    },
    {
      "path": "PROMPT.md",
      "sha256": "<hex digest>",
      "size": 5678
    }
  ]
}
```

**Fields:**
- `manifest_version`: always `"1.0"` for this spec
- `run_id`, `turn_id`, `role`: identity from the dispatch assignment
- `finalized_at`: ISO-8601 timestamp of manifest creation
- `files`: array of entries for every file in the bundle directory **except** `MANIFEST.json` itself
  - `path`: relative to bundle directory (no leading `./`)
  - `sha256`: hex-encoded SHA-256 digest of file contents
  - `size`: byte length of file contents

### Exports

**`cli/src/lib/dispatch-manifest.js`:**

- `finalizeDispatchManifest(root, turnId, { run_id, role })` → `{ ok, manifestPath, fileCount, error? }`
  - Scans the bundle directory for all files except MANIFEST.json
  - Computes SHA-256 and size for each
  - Writes MANIFEST.json atomically
  - Returns the manifest path and file count

- `verifyDispatchManifest(root, turnId)` → `{ ok, errors?, manifest? }`
  - Reads MANIFEST.json from the bundle directory
  - For each entry: verifies file exists, digest matches, size matches
  - Checks for unexpected files not in manifest
  - Returns `ok: false` with structured errors on any violation

### Path Helper

**`cli/src/lib/turn-paths.js`:**

- `getDispatchManifestPath(turnId)` → `<dispatch_turns_dir>/<turnId>/MANIFEST.json`

---

## Behavior

### Finalization Timing

```
writeDispatchBundle()           — core files written
    ↓
after_dispatch hooks fire       — hooks may add supplement files
    ↓
finalizeDispatchManifest()      — ALL files in bundle dir are hashed → MANIFEST.json
    ↓
adapter dispatches              — adapter calls verifyDispatchManifest() first
```

1. `writeDispatchBundle()` writes ASSIGNMENT.json, PROMPT.md, CONTEXT.md (and optionally COORDINATOR_CONTEXT.json/md for multi-repo).
2. `after_dispatch` hooks run. They may add files to the bundle directory (supplement files). They MUST NOT modify protected core files (existing tamper detection enforces this).
3. `finalizeDispatchManifest()` is called. It scans the bundle directory, hashes every file except MANIFEST.json itself, and writes the manifest. **After this point, the bundle is sealed.**
4. The adapter calls `verifyDispatchManifest()` before reading any bundle file. If verification fails, the adapter refuses to execute.

### Supplement Handling

`after_dispatch` hooks can write arbitrary files into the bundle directory. The `hook_supplements/` namespace is the recommended convention, but the manifest captures ALL files regardless of naming. Any file present at finalization time is in the manifest. Any file added after finalization is detected as an unexpected file by verification.

### Verification Failure Modes

The verifier returns structured errors:

| Error Type | Condition | Severity |
|-----------|-----------|----------|
| `missing_file` | Manifest entry exists but file is gone | Fatal |
| `unexpected_file` | File exists but not in manifest | Fatal |
| `digest_mismatch` | File SHA-256 doesn't match manifest | Fatal |
| `size_mismatch` | File byte size doesn't match manifest | Fatal |
| `missing_manifest` | MANIFEST.json does not exist | Fatal |
| `invalid_manifest` | MANIFEST.json is malformed JSON or wrong schema | Fatal |

All failures are fatal. Verification fails closed — the adapter MUST NOT proceed on any violation.

---

## Error Cases

1. If the bundle directory does not exist at finalization time, `finalizeDispatchManifest` returns `{ ok: false, error: 'Bundle directory does not exist' }`.
2. If the bundle directory is empty at finalization time, `finalizeDispatchManifest` returns `{ ok: false, error: 'Bundle directory is empty — no files to manifest' }`.
3. If MANIFEST.json already exists in the bundle directory at finalization time, it is overwritten. Finalization is idempotent — re-finalizing overwrites the previous manifest.
4. If an adapter encounters a verification failure, it returns `{ ok: false, error: '<structured error>' }` and the CLI surfaces the error and exits non-zero without executing the agent.
5. If MANIFEST.json is missing at verification time (pre-v2.1 bundles or manual dispatch), the adapter returns a verification failure. There is no graceful degradation — manifests are mandatory once the feature ships.

---

## Acceptance Tests

- `AT-V21-001`: Unexpected file added to a finalized dispatch bundle is rejected before adapter execution.
  - Write bundle → finalize → inject extra file → verify → assert `unexpected_file` error, adapter does not execute.

- `AT-V21-002`: Digest mismatch in a finalized dispatch bundle is rejected before adapter execution.
  - Write bundle → finalize → modify PROMPT.md contents → verify → assert `digest_mismatch` error.

- `AT-V21-003`: Allowed `after_dispatch` supplement files are included in the finalized manifest and pass verification.
  - Write bundle → run after_dispatch hook that adds supplement file → finalize → verify → assert ok, supplement file in manifest.

- `AT-V21-MANIFEST-001`: Finalization captures all expected core files (ASSIGNMENT.json, PROMPT.md, CONTEXT.md).
  - Write bundle → finalize → read manifest → assert all three files present with valid digests and sizes.

- `AT-V21-MANIFEST-002`: Missing file detected by verification.
  - Write bundle → finalize → delete CONTEXT.md → verify → assert `missing_file` error.

- `AT-V21-MANIFEST-003`: Coordinator context files are included in manifest for multi-repo bundles.
  - Write bundle with COORDINATOR_CONTEXT.json → finalize → assert present in manifest.

---

## Open Questions

1. ~~Should manifest verification run only immediately before adapter execution, or again at accept/reject time for retained bundles?~~ **Resolved: verification runs before adapter execution only.** Accept/reject operates on the turn result, not the bundle. Retained bundles are not re-verified because the trust boundary is at dispatch time.

2. Should the manifest include a digest of itself (self-referential hash)? **No.** The manifest cannot hash itself. If external verification is needed (v3+), a detached signature over the manifest file would be the appropriate mechanism.

---

## Decisions

- `DEC-MANIFEST-001`: MANIFEST.json is written at bundle finalization time, after all `after_dispatch` hooks have completed, not at initial `writeDispatchBundle` time.
- `DEC-MANIFEST-002`: Supplement files from `after_dispatch` hooks are captured in the manifest because they are present at finalization time. No explicit supplement registry is needed.
- `DEC-MANIFEST-003`: Verification fails closed on all error types. There is no warning-only mode.
- `DEC-MANIFEST-004`: MANIFEST.json is excluded from its own file entries to avoid self-referential hashing.
- `DEC-MANIFEST-005`: Re-finalization overwrites the previous manifest. Finalization is idempotent.
