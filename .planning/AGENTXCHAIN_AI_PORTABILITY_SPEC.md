## AgentXchain.ai Portability Spec — Export/Import Contract

**Status:** Active
**Created:** Turn 287 — Claude Opus 4.6
**Depends on:** `AGENTXCHAIN_AI_MANAGED_SURFACE_SPEC.md`, `AGENTXCHAIN_AI_CONTROL_PLANE_API_SPEC.md`

### Purpose

Define the exact bundle format, round-trip semantics, and lossy/lossless boundaries for moving governed run state between `agentxchain.dev` (repo-native) and `agentxchain.ai` (cloud-managed) in both directions.

Without this contract, portability is a handwave. The managed surface spec says "import/export without lossy transforms." The control plane spec names `/export` and `/import` endpoints. Neither defines what is IN the bundle, what survives the round-trip, or what is explicitly dropped. This spec fills that gap.

### Interface

#### Export Bundle

The export bundle is a deterministic, self-contained archive of a single governed run. Format: gzipped tarball (`.agentxchain-export.tar.gz`).

The v1 bundle uses a flat, standard tarball layout on purpose. It must be explorable with off-the-shelf `tar`, diffable after extraction, and readable without a custom parser. JSONL-manifest-plus-embedded-blob streaming formats are deferred until there is measured evidence that the flat bundle is too slow or too large for real governed runs.

Contents:

```
<run_id>/
  manifest.json              # bundle metadata + integrity
  protocol-version.json      # { "version": 7 }
  governance-config.json     # agentxchain.json equivalent
  state.json                 # run state machine snapshot
  history.jsonl              # complete turn history (append-only)
  decision-ledger.jsonl      # all DEC-* entries
  events.jsonl               # complete event stream
  gates.json                 # gate states + evidence
  intake/
    intents/*.json           # intent queue
    injected-priority.json   # if exists
  artifacts/
    <turn_id>/
      turn-result.json       # declared turn result
      observed-artifact.json # orchestrator observation
      verification.json      # verification evidence
      files/                 # optional: snapshot of files_changed at acceptance
  checkpoints/
    <sha>.json               # checkpoint metadata
```

#### Manifest Schema

```json
{
  "format_version": 1,
  "exporter": "agentxchain.dev | agentxchain.ai",
  "exporter_version": "string",
  "exported_at": "ISO-8601",
  "run_id": "run_<ulid>",
  "protocol_version": 7,
  "content_hash": "sha256:<hex>",
  "includes_file_snapshots": true,
  "cloud_metadata_stripped": ["display_name", "notification_preferences", "dashboard_layout", "search_index_state"],
  "warnings": []
}
```

### Behavior

1. **Export is deterministic.** Given the same run state, export produces the same bundle (modulo `exported_at` timestamp). Content hash covers all files except `manifest.json` itself.

2. **Round-trip preserves protocol state.** Export from `.dev` → import to `.ai` → export from `.ai` → import back to `.dev` must produce identical protocol state. Specifically:
   - `state.json` phase, status, gates, last_completed_turn: identical
   - `history.jsonl` entries: identical (same order, same fields)
   - `decision-ledger.jsonl` entries: identical
   - `events.jsonl` entries: identical schema, same events (cloud-managed events like `api_request_audit` may be appended but never replace `.dev` events)
   - `gates.json` gate states: identical
   - Intake intents: identical status, contracts, phase_scope

3. **Cloud-only metadata is stripped on export.** The four named presentation-tier fields (`display_name`, `notification_preferences`, `dashboard_layout`, `search_index_state`) plus any cloud-specific tenancy refs (`org_id`, `ws_id`, `proj_id`) are removed. The bundle is a protocol-native artifact, not a cloud backup.

4. **Import validates protocol compatibility before applying.** Import checks:
   - `protocol_version` matches the target's supported version
   - `content_hash` integrity
   - No conflicting `run_id` already exists (or explicit `--force` / conflict-resolution mode)
   - Governance config compatibility with the target project's config

5. **File snapshots are optional but recommended.** When `includes_file_snapshots: true`, the `artifacts/<turn_id>/files/` directory contains the exact file contents at acceptance time. This enables full replay without access to the original git repo. When absent, the importer must have access to the git repository to resolve file state.

6. **Import does not replay — it reconstructs.** Import creates the run state machine at the exported point. It does not re-execute turns. The imported run is immediately resumable if the state is `active` and the target has compatible connectors.

7. **Export from active runs is allowed but warned.** If the run has an in-flight turn, the bundle includes a `warnings: ["active_turn_in_flight"]` entry. Import of an active run reconstructs the state but does NOT resume the in-flight turn — it marks it as `interrupted` requiring explicit recovery.

8. **Import into `.ai` creates tenancy bindings.** The imported run is bound to the target `workspace_id` and `project_id`. These are cloud-only tenancy refs that do not contaminate the protocol state.

9. **Incremental export is not in the first slice.** v1 exports the complete run. Delta/incremental export (only events since last export) is deferred until the full-bundle contract is proven stable.

10. **Bundle readability beats speculative compression in v1.**
   - The portability boundary is a debugging and recovery surface, not just a transport payload.
   - Standard archive tooling and deterministic extracted paths matter more than theoretical byte savings before the repo has real evidence of bundle-scale pain.
   - Future chunked or streaming formats must prove they preserve deterministic inspection and hashability before they replace the flat bundle.

### Error Cases

1. Export produces a bundle that the other surface cannot import due to schema drift between `.dev` and `.ai` protocol evaluators.
2. Import silently drops decision ledger entries or gate evidence that the importer doesn't recognize.
3. Round-trip loses event ordering because `.ai` uses a different event ID scheme.
4. File snapshots reference paths that conflict with the target project's existing workspace.
5. Import of an active run resumes an in-flight turn without the original connector context, producing orphaned side effects.
6. Cloud-only metadata leaks into the bundle because the strip list is incomplete.
7. Import succeeds but the imported run's governance config is incompatible with the target workspace policy, causing silent acceptance failures on the next turn.
8. `content_hash` validation is skipped on import, allowing tampered bundles to inject governance state.
9. A custom streaming-only bundle format lands before there is bundle-scale evidence, making exports harder to inspect, diff, and recover by hand.

### Acceptance Tests

- `AT-PORT-001`: `.dev` export → `.ai` import → `.ai` export → `.dev` import produces identical `state.json`, `history.jsonl`, `decision-ledger.jsonl`, and `gates.json` content.
- `AT-PORT-002`: Cloud-only metadata (`display_name`, `notification_preferences`, `dashboard_layout`, `search_index_state`, `org_id`, `ws_id`, `proj_id`) is absent from exported bundles.
- `AT-PORT-003`: Import rejects bundles with mismatched `protocol_version`.
- `AT-PORT-004`: Import rejects bundles with failed `content_hash` integrity check.
- `AT-PORT-005`: Import of an active run with an in-flight turn marks the turn as `interrupted` instead of resuming it.
- `AT-PORT-006`: Imported run is immediately resumable on the target surface when state is `active` and connectors are compatible.
- `AT-PORT-007`: Export of a run with 100+ turns and 50+ decision ledger entries completes in under 5 seconds (performance gate).
- `AT-PORT-008`: `.ai`-appended cloud events (e.g., `api_request_audit`) are preserved in `.ai` export but do not appear in the `.dev`-imported `events.jsonl` when the `.dev` importer filters by known event types.
- `AT-PORT-009`: The v1 bundle is inspectable with standard tar tooling after export; import does not require a custom streaming decoder.

### Open Questions

1. At what measured bundle size or export latency should chunking/compression beyond flat tarballs be reconsidered?
2. Should the bundle include the governance config's connector definitions, or only the protocol-level config (roles, phases, gates)? Including connectors enables cold migration; excluding them forces re-binding and prevents stale credential leakage.
3. Should import support partial bundle (e.g., import only decision ledger and events, not full run state) for audit-only portability use cases?
