# V2.1 Scope Boundary — AgentXchain

> Defines the exact feature boundary for v2.1.0 after the v2.0.0 release.

---

## Purpose

v2.0.0 expanded the product surface: multi-repo coordination, dashboard integration, plugin packaging, and protocol v6.

v2.1.0 is not another breadth release. It is a **trust-hardening and operator-visibility** release.

The question for v2.1 is simple:

- can the operator prove that the dispatch bundle consumed by an agent is exactly the bundle the orchestrator finalized
- can organizations integrate external policy services without shell-script wrappers
- can the dashboard surface enough evidence depth to support real gate decisions without dropping into raw ledgers immediately

If a candidate feature does not strengthen one of those three things, it is not v2.1 scope.

---

## Release Theme

**Governed execution must be tamper-evident, externally enforceable, and easier to audit.**

v2.1 strengthens the governed runtime itself. It does **not** add new orchestration models, cloud hosting, or generic agent-builder features.

---

## Interface

The v2.1 surface touches four operator-facing areas:

1. **Dispatch bundles**
   - Repo-local dispatch bundles gain a finalized `MANIFEST.json`
   - Coordinator-generated repo dispatch bundles also gain `MANIFEST.json`
   - Adapters verify the manifest before consuming bundle files

2. **Hook transport**
   - Hook config supports `"type": "http"` in addition to `"process"`
   - HTTP hooks preserve the same phase semantics: blocking phases can veto, advisory phases cannot

3. **Plugin lifecycle**
   - Plugin `config_schema` becomes enforced, not merely recorded
   - Plugin upgrades become first-class instead of remove-then-install only

4. **Dashboard evidence depth**
   - Turn details expose hook annotations and audit context
   - Decision and hook ledgers gain the deferred filters already named in the v2 dashboard spec
   - Turn cards expose diff entry points rooted in real git state, not fake inline patches

---

## What Ships In v2.1.0

### V2.1-F1: Dispatch Manifest Integrity

**Status:** Implemented and tested. 17 tests across 11 suites (AT-V21-001 through AT-V21-003, AT-V21-MANIFEST-001 through 003, plus unit and integration tests).

**Scope:**
- Each finalized dispatch bundle writes `MANIFEST.json` containing:
  - bundle identity (`run_id`, `turn_id`, `role`, `generated_at`)
  - manifest version
  - file entries with relative path, SHA-256 digest, and byte size
- The manifest is created at **bundle finalization time**, not at initial file write time.
- Repo-local `after_dispatch` hooks may still add supplements, but only before manifest finalization.
- The manifest covers all adapter-consumable files, including:
  - `ASSIGNMENT.json`
  - `PROMPT.md`
  - `CONTEXT.md`
  - `COORDINATOR_CONTEXT.json` when present
  - approved hook-produced supplement files
- Adapters verify the manifest before execution.
- Verification fails closed on:
  - unexpected files
  - missing files
  - digest mismatch
  - size mismatch
- Coordinator hook protection extends from “existing-file rollback” to “directory integrity” for protected dispatch paths once a bundle is finalized.

**Why this is in v2.1:**
- v2.0 documented a real gap: new files can be dropped into dispatch directories after tamper snapshots.
- The existing wording “manifest at generation time” was insufficient because `after_dispatch` already has an accepted supplement contract. Finalization is the correct boundary.

**What does NOT ship as part of V2.1-F1:**
- No cryptographic signing or public-key verification
- No remote artifact store
- No binary delta protocol or compression layer
- No automatic recovery that edits the bundle in place after verification failure

### V2.1-F2: Hook And Plugin Hardening

**Status:** Implemented and tested. Plugin hardening: enforced config_schema, atomic upgrades, rollback. HTTP hooks: type "http" transport with sync bridge, env-backed header interpolation, verdict/annotation parity with process hooks, 8 acceptance tests.

**Scope:**
- Add `"type": "http"` hooks with explicit request/response contract:
  - JSON POST body uses the same hook envelope shape as process hooks
  - response returns the same verdict surface (`allow`, `warn`, `block`, optional annotations)
  - timeout is mandatory
  - auth is supplied via env-backed headers, not literal secrets in config
- Preserve existing governance semantics:
  - `before_*` blocking phases may block
  - advisory phases cannot escalate themselves into auto-approval or silent mutation
- Enforce plugin `config_schema` during install/load so invalid plugin config is rejected before hooks run.
- Add first-class plugin upgrade flow with rollback on failure.
- Preserve deterministic hook merge semantics during upgrade; no duplicate hook-name collisions, no partial config mutation.

**Why this is in v2.1:**
- The hook spec already deferred HTTP hooks to v2.1.
- Plugin phase 1 explicitly left config enforcement and upgrade flows unresolved.
- “Plugin ecosystem hardening” is meaningless unless those two gaps are closed precisely.

**What does NOT ship as part of V2.1-F2:**
- No plugin marketplace or registry
- No signed plugins or trust policies
- No Wasm sandbox
- No hook dependency graph
- No hook-driven auto-approval of human gates

### V2.1-F3: Dashboard Evidence Drill-Down

**Status:** Defined, not implemented.

**Scope:**
- Turn detail panels surface:
  - hook annotations for the accepted turn
  - nearby hook audit entries
  - diff entry points anchored to git state / accepted integration refs
- Decision ledger explorer adds the deferred columns and filters already named in `V2_DASHBOARD_SPEC.md`:
  - timestamp
  - objection presence
  - phase filter
  - date range filter
- Hook audit log adds the deferred filters already named in `V2_DASHBOARD_SPEC.md`:
  - phase
  - verdict
  - hook name
- The dashboard remains read-only. Evidence depth improves; write authority does not.

**Why this is in v2.1:**
- v2.0 deliberately shipped the observation surface first.
- The remaining gap is not “make it prettier.” The gap is that operators still have to drop into raw ledgers too often during real gate review.

**What does NOT ship as part of V2.1-F3:**
- No cloud-hosted dashboard
- No real-time adapter stdout streaming
- No dashboard-triggered approvals, retries, or dispatch
- No editor-specific deep links as a protocol requirement

---

## What Is Deferred Beyond v2.1

### V3-D1: Signed Plugin Trust Policy

**Why deferred:** It changes the plugin trust model materially and requires provenance, key management, and revocation semantics. v2.1 hardens lifecycle and transport first.

### V3-D2: Wasm Hook Isolation

**Why deferred:** This is a runtime architecture change, not a release-hardening task.

### V3-D3: Dashboard Write Actions

**Why deferred:** The constitutional model still requires CLI-backed explicit approval paths. Dashboard write authority changes the permission model and audit surface.

### V3-D4: Streaming Agent Output

**Why deferred:** Streaming output is a different data model and does not strengthen governed convergence by itself.

---

## What Is Cut Entirely (No Version Planned)

### CUT-1: Automatic Hook Auto-Approval Of Human Gates

**Why cut:** Human gates are constitutional authority. Hooks may block or annotate them, not bypass them.

### CUT-2: Cross-Repo Automatic Rollback On Manifest Failure

**Why cut:** A verification failure should stop execution and surface recovery instructions. The orchestrator should not perform destructive rollback across repos automatically.

---

## Behavior

1. Dispatch bundles are mutable only until bundle finalization completes.
2. `after_dispatch` supplements remain allowed, but they must be present in the finalized manifest or they are rejected as unexpected files.
3. Adapter execution begins only after manifest verification passes.
4. HTTP hooks inherit the same verdict model and tamper protections as process hooks; only transport changes.
5. Plugin upgrades are atomic: success replaces prior plugin state; failure restores prior plugin state and hook config.
6. Dashboard drill-down reads existing ledgers and git state; it does not become a second source of truth.

---

## Error Cases

1. If a dispatch bundle contains an undeclared file after manifest finalization, adapter execution must fail closed with a manifest-integrity error.
2. If an `after_dispatch` supplement is written after manifest finalization, it must be rejected as tamper, not silently accepted.
3. If an HTTP hook times out during a blocking phase, the blocking command must fail closed and preserve coherent run state.
4. If plugin config violates `config_schema`, install/load must fail before hook execution.
5. If a plugin upgrade fails after filesystem copy but before hook-config commit, the prior plugin installation and config must be restored.
6. If dashboard filters require invented schema fields rather than persisted ledgers, the feature is out of contract.

---

## Acceptance Tests

1. `AT-V21-001`: unexpected file added to a finalized dispatch bundle is rejected before adapter execution.
2. `AT-V21-002`: digest mismatch in a finalized dispatch bundle is rejected before adapter execution.
3. `AT-V21-003`: allowed `after_dispatch` supplement files are included in the finalized manifest and pass verification.
4. `AT-V21-004`: blocking HTTP hook can veto a gate/assignment and leaves run state coherent on timeout or `block`.
5. `AT-V21-005`: plugin upgrade is atomic and rolls back cleanly on failure.
6. `AT-V21-006`: invalid plugin config is rejected via enforced `config_schema` before runtime use.
7. `AT-V21-007`: dashboard turn detail renders hook annotations and audit context for an accepted turn without mutating state.
8. `AT-V21-008`: decision and hook-audit views honor the deferred phase/verdict/date filters against persisted ledgers.

---

## Open Questions

1. Should manifest verification run only immediately before adapter execution, or again at accept/reject time for retained bundles?
2. Is env-backed bearer/header auth sufficient for HTTP hooks in v2.1, or do we need mTLS to call the feature complete?
3. Should diff entry points open raw git diffs in a new route, or render a constrained inline diff view inside the dashboard shell?

---

## Decisions

- `DEC-V2_1-SCOPE-001`: v2.1.0 is a trust-hardening release, not a new orchestration-model release.
- `DEC-V2_1-SCOPE-002`: Dispatch integrity is enforced at bundle finalization time with content-addressed manifests, not at initial file generation time.
- `DEC-V2_1-SCOPE-003`: HTTP hooks are in v2.1 because they were already deferred from the hook spec and materially improve external policy integration.
- `DEC-V2_1-SCOPE-004`: Plugin ecosystem hardening means enforced `config_schema` plus atomic upgrade flow; vague “ecosystem” language is not sufficient.
- `DEC-V2_1-SCOPE-005`: Dashboard v2.1 work is evidence drill-down only. The dashboard remains read-only.
- `DEC-V2_1-SCOPE-006`: Hook auto-approval of human gates is cut, not deferred.
