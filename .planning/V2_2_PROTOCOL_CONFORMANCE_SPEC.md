# V2.2 Protocol Conformance Spec — AgentXchain.dev

> Defines the first-cut protocol conformance surface for third-party orchestrators and alternative runners.

---

## Purpose

AgentXchain claims "the protocol is the product." v2.2 makes that testable.

A conformance kit lets any implementation — reference CLI, third-party orchestrator, CI integration, cloud service — prove it implements the AgentXchain governed workflow protocol correctly. Without it, "open protocol" means "trust our CLI."

This spec defines:
- what protocol invariants are mandatory for conformance
- what capabilities are optional tiers
- how golden fixtures are structured
- how a validator runs and reports
- what is explicitly excluded from v2.2

---

## Non-Goals

1. Hosted certification service (`.ai` scope)
2. Badge marketplace or public conformance registry
3. Remote attestation or signed conformance reports
4. Plugin or dashboard conformance (implementation extensions, not protocol)
5. Runtime performance or latency conformance

---

## Architecture

```
┌─────────────────────────────────────────────┐
│  Conformance Fixture Suite                  │
│  (.agentxchain-conformance/fixtures/)       │
│                                             │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐   │
│  │ state-   │ │ turn-    │ │ gate-    │   │
│  │ machine  │ │ result   │ │ semantics│   │
│  └──────────┘ └──────────┘ └──────────┘   │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐   │
│  │ config   │ │ decision │ │ dispatch │   │
│  │ schema   │ │ ledger   │ │ manifest │   │
│  └──────────┘ └──────────┘ └──────────┘   │
└─────────────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────────┐
│  Conformance Validator                      │
│  agentxchain verify protocol [--tier T]     │
│                                             │
│  Reads: fixtures + implementation output    │
│  Produces: conformance report (JSON)        │
│  Exit: 0 = pass, 1 = fail, 2 = error       │
└─────────────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────────┐
│  Capability Declaration                     │
│  .agentxchain-conformance/capabilities.json │
│                                             │
│  Declares: protocol version, tier, optional │
│  surfaces, implementation metadata          │
└─────────────────────────────────────────────┘
```

---

## Conformance Tiers

### Tier 1 — Core Constitutional (Mandatory)

Every conformant implementation MUST pass Tier 1. These are the protocol invariants that define governed multi-agent delivery.

| Surface | Invariants |
|---------|-----------|
| **State Machine** | Valid states: idle, active, paused, blocked, completed. Legal transitions only (§SM below). Completed is terminal. run_id immutable after initialization. |
| **Turn Result Validation** | 5-stage pipeline (schema → assignment → artifact → verification → protocol). Required fields enforced. Reserved paths rejected from files_changed. |
| **Challenge Requirement** | review_only roles MUST produce ≥1 objection. Acceptance rejects turns that violate this. |
| **Gate Semantics** | Phase transition gates enforce predicates (requires_files, requires_verification_pass, requires_human_approval). Human gates pause state. Failed predicates keep state unchanged. |
| **Decision Ledger** | Append-only JSONL. DEC-NNN pattern. Unique IDs within a run. Required fields: id, turn_id, role, phase, category, statement, rationale, status, created_at. |
| **History** | Append-only JSONL. Each accepted turn appended atomically with state write. No orphaned turns. |
| **Config Schema** | schema_version 1.0 validated. Roles reference declared runtimes. Routing references declared roles and gates. Entry roles exist in roles map. |

### Tier 2 — Trust Hardening (Optional)

Implementations claiming trust-hardened execution MUST pass Tier 2 in addition to Tier 1.
These surfaces strengthen governed execution materially, but they remain optional until they are promoted into the normative protocol reference itself. They are not baseline v6 constitutional requirements today.

| Surface | Invariants |
|---------|-----------|
| **Dispatch Manifest** | MANIFEST.json finalized after hook supplements, before adapter consumption. SHA-256 + size per file. Verification fails closed on missing_file, unexpected_file, digest_mismatch, size_mismatch. MANIFEST.json excluded from own entries. |
| **Hook Audit** | Every hook execution produces an audit entry with: hook_name, phase, transport (process/http), exit_code/status_code, duration_ms, verdict (allow/warn/block). Audit entries appended to hook-audit-ledger.jsonl. |
| **HTTP Hook Transport** | POST-only. Header interpolation with `${VAR}` from env. Unresolved vars fail closed. Timeout enforced. Response verdict surface (allow/warn/block). Advisory phases downgrade block to warn. |

### Tier 3 — Multi-Repo Coordination (Optional)

Implementations claiming multi-repo orchestration MUST pass Tier 3 in addition to Tier 1.

| Surface | Invariants |
|---------|-----------|
| **Coordinator Config** | schema_version 0.1 validated. Repos, workstreams, barriers declared. Acyclic workstream dependencies. Entry repo exists in workstream repo list. |
| **Barrier Semantics** | Four barrier types: all_repos_accepted, interface_alignment (requires explicit `interface_alignment.decision_ids_by_repo`; satisfied only when each repo accepted its declared decision IDs), ordered_repo_sequence, shared_human_gate. Barrier status transitions: pending → partially_satisfied → satisfied. Deterministic evaluation from state + config. |
| **Barrier Ledger** | Append-only JSONL. Records barrier_transition events. Status moves through valid transitions only. |
| **Cross-Repo Isolation** | File writes in a turn result must belong to the declaring repo's path. Coordinator never writes to repo-local `.agentxchain/`. |
| **Coordinator Gates** | Phase transition blocked if any required repo has active turn or pending repo-local gate. Coordinator cannot advance until all barriers satisfied. |

---

## State Machine Transition Table (§SM)

```
From        → To          Trigger                        Condition
──────────────────────────────────────────────────────────────────────
idle        → active      initialize                     config valid, no existing run
active      → active      assignment                     turn assigned, dispatched, or accepted
active      → active      rejection (retry)              retries < max_turn_retries
active      → paused      gate awaiting approval         phase/completion gate requires human
active      → paused      needs_human status             turn result status = needs_human
active      → blocked     escalation                     retries exhausted or unrecoverable
paused      → active      approve (transition/resume)    human approves gate or resumes
paused      → completed   approve (completion)           human approves run completion
blocked     → active      resolve                        human provides recovery action
completed   → (terminal)  —                              no further transitions allowed
```

**Invariants to test:**
- Any transition not in this table MUST be rejected
- `completed` state rejects all operations (assign, accept, approve, resolve)
- `run_id` is set on `idle → active` and never changes
- `paused` state always has exactly one of: `pending_phase_transition`, `pending_run_completion`, `blocked_reason`
- `blocked` state always has `blocked_on` set

---

## Fixture Format

Each fixture is a JSON file in `.agentxchain-conformance/fixtures/<tier>/<surface>/`.

```json
{
  "fixture_id": "SM-001",
  "tier": 1,
  "surface": "state_machine",
  "description": "Completed state rejects assignment",
  "type": "reject",
  "setup": {
    "state": { ... },
    "config": { ... },
    "filesystem": {
      ".planning/PM_SIGNOFF.md": "Approved by PM"
    }
  },
  "input": {
    "operation": "assign",
    "args": { ... }
  },
  "expected": {
    "result": "error",
    "error_type": "invalid_state_transition",
    "state_unchanged": true
  }
}
```

`setup.filesystem` is a fixture-level helper for gate and manifest predicates that depend on file presence. Adapters materialize the declared relative paths in an isolated workspace before running the operation.

Fixture types:
- **`accept`** — operation succeeds, expected output matches
- **`reject`** — operation fails with specified error, state unchanged
- **`transition`** — state changes to expected values after operation
- **`validate`** — artifact (turn result, config, manifest) validated against schema

`expected` may contain exact values plus simple assertion objects for generated data. The first-cut fixture corpus uses:
- `{ "assert": "nonempty_string" }`
- `{ "assert": "id_prefix", "value": "run_" }`
- `{ "assert": "present" }`

---

## Fixture Inventory (First Cut)

### Tier 1 — Core Constitutional

**State Machine (SM-001 through SM-012)**

| ID | Type | Description |
|----|------|-------------|
| SM-001 | reject | Completed state rejects assignment |
| SM-002 | reject | Completed state rejects approval |
| SM-003 | transition | idle → active on initialize with valid config |
| SM-004 | reject | idle → active fails with invalid config |
| SM-005 | transition | active → paused on human gate |
| SM-006 | transition | paused → active on approve-transition |
| SM-007 | transition | paused → completed on approve-completion |
| SM-008 | reject | active → completed directly (must go through paused) |
| SM-009 | transition | active → blocked on escalation |
| SM-010 | transition | blocked → active on resolve |
| SM-011 | reject | Illegal transition (idle → paused) |
| SM-012 | reject | run_id mutation after initialization |

**Turn Result Validation (TR-001 through TR-010)**

| ID | Type | Description |
|----|------|-------------|
| TR-001 | validate | Valid turn result passes all 5 stages |
| TR-002 | reject | Missing required field (summary) |
| TR-003 | reject | Wrong run_id (assignment mismatch) |
| TR-004 | reject | Wrong turn_id (assignment mismatch) |
| TR-005 | reject | Reserved path in files_changed |
| TR-006 | reject | review_only role with zero objections |
| TR-007 | validate | review_only role with ≥1 objection passes |
| TR-008 | reject | Invalid decision ID format |
| TR-009 | reject | Mutually exclusive phase_transition + run_completion |
| TR-010 | validate | needs_human status with needs_human_reason passes |

**Gate Semantics (GS-001 through GS-006)**

| ID | Type | Description |
|----|------|-------------|
| GS-001 | transition | Gate with requires_files passes when files exist |
| GS-002 | reject | Gate with requires_files fails when file missing |
| GS-003 | transition | Gate with requires_verification_pass passes on pass |
| GS-004 | reject | Gate with requires_verification_pass fails on fail |
| GS-005 | transition | Gate with requires_human_approval pauses state |
| GS-006 | reject | Phase transition to non-existent phase |

**Decision Ledger (DL-001 through DL-004)**

| ID | Type | Description |
|----|------|-------------|
| DL-001 | validate | Well-formed decision entry with all fields |
| DL-002 | reject | Decision with empty statement |
| DL-003 | reject | Decision with invalid category |
| DL-004 | reject | Duplicate decision ID within a run |

**History (HS-001 through HS-003)**

| ID | Type | Description |
|----|------|-------------|
| HS-001 | transition | Accepted turn appends one history entry atomically with state update |
| HS-002 | reject | Re-accepting the same turn does not duplicate history |
| HS-003 | reject | Orphaned history append without corresponding state advance fails |

**Config Schema (CS-001 through CS-005)**

| ID | Type | Description |
|----|------|-------------|
| CS-001 | validate | Minimal valid governed config |
| CS-002 | reject | Entry role not in roles map |
| CS-003 | reject | Role references undeclared runtime |
| CS-004 | reject | Gate referenced by routing but not declared |
| CS-005 | reject | Invalid schema_version |

### Tier 2 — Trust Hardening

**Dispatch Manifest (DM-001 through DM-005)**

| ID | Type | Description |
|----|------|-------------|
| DM-001 | validate | Finalized manifest with valid SHA-256 digests |
| DM-002 | reject | Unexpected file after finalization |
| DM-003 | reject | Digest mismatch after content tampering |
| DM-004 | reject | Missing file after deletion |
| DM-005 | validate | MANIFEST.json excluded from own entries |

**Hook Audit (HA-001 through HA-003)**

| ID | Type | Description |
|----|------|-------------|
| HA-001 | validate | Process hook audit entry with required fields |
| HA-002 | validate | HTTP hook audit entry with transport=http |
| HA-003 | reject | Advisory phase hook block verdict downgraded to warn |

### Tier 3 — Multi-Repo

**Coordinator (CR-001 through CR-005)**

| ID | Type | Description |
|----|------|-------------|
| CR-001 | validate | Valid coordinator config with repos and workstreams |
| CR-002 | reject | Cyclic workstream dependencies |
| CR-003 | transition | Barrier pending → partially_satisfied on repo completion |
| CR-004 | transition | Barrier partially_satisfied → satisfied when all repos done |
| CR-005 | reject | Cross-repo file write violation |

**Total: 53 fixtures across 3 tiers.**

---

## Validator Interface

### CLI Surface

```bash
# Validate an implementation's conformance at Tier 1
agentxchain verify protocol --tier 1 --target <path>

# Validate at Tier 2 (includes Tier 1)
agentxchain verify protocol --tier 2 --target <path>

# Validate specific surface only
agentxchain verify protocol --surface state_machine --target <path>

# Output JSON report
agentxchain verify protocol --tier 1 --target <path> --format json
```

### Target Interface

The `--target` path must contain:
1. A `.agentxchain-conformance/capabilities.json` declaring supported tiers, surfaces, and adapter invocation metadata
2. An executable adapter command declared inside `capabilities.json`

The adapter command is resolved relative to the target root when a relative path is used. The validator invokes that command once per fixture, writes fixture JSON to stdin, and expects:
1. Execute the operation described in the fixture against the implementation
2. Return a result JSON on stdout with `{ "status": "pass" | "fail" | "error", "actual": {...}, "message": "..." }`
3. Exit 0 on pass, 1 on fail, 2 on error

### Tier 2 Adapter Contract Clarification

Dispatch-manifest fixtures do **not** get separate adapter verbs for each mutation type. That was weak design because it forced every implementation to mirror the reference test choreography instead of proving the invariant.

The Tier 2 manifest surface uses:
- `verify_dispatch_manifest` — adapter finalizes the dispatch bundle, applies any declared `setup.post_finalize_*` mutations, then verifies the manifest
- `inspect_dispatch_manifest` — adapter finalizes the dispatch bundle and returns manifest-derived facts needed by the fixture

Mutation intent lives in fixture setup:
- `setup.dispatch_bundle`
- `setup.post_finalize_inject`
- `setup.post_finalize_tamper`
- `setup.post_finalize_delete`

This keeps the fixture contract protocol-facing: fixtures describe bundle state and expected verification outcomes, while the adapter owns the local testing sequence.

### Tier 3 Execution Model

Tier 3 fixtures use a multi-workspace setup. The adapter must materialize an isolated coordinator workspace plus one or more governed repo roots before executing the fixture. The fixture setup contract is:

```json
{
  "setup": {
    "coordinator_config": { "...": "agentxchain-multi.json contents" },
    "repos": {
      "api": {
        "path": "./repos/api",
        "config": { "...": "agentxchain.json contents" },
        "state": { "...": "repo-local .agentxchain/state.json contents" },
        "history": [ { "...": "repo-local accepted turns if needed" } ],
        "files": {
          "src/index.ts": "export const api = true;"
        }
      }
    }
  }
}
```

Rules:
- `repos.<id>.path` is the repo path referenced by `agentxchain-multi.json`; it is resolved relative to the isolated coordinator workspace.
- Tier 3 adapters must materialize repo-local `agentxchain.json` and `.agentxchain/state.json` exactly as declared.
- Cross-repo checks must resolve file paths against those materialized repo roots, not against the adapter process cwd.
- The coordinator remains forbidden from mutating repo-local `.agentxchain/` state during projection and gate evaluation; fixtures may assert this invariant directly.

This adapter model means the validator does not need to know how to invoke the implementation — it only needs to feed fixtures and read results. The implementation provides the bridge.

### Capabilities Declaration

```json
{
  "implementation": "agentxchain-cli",
  "version": "2.2.0",
  "protocol_version": "v6",
  "adapter": {
    "protocol": "stdio-fixture-v1",
    "command": ["node", ".agentxchain-conformance/reference-adapter.js"]
  },
  "tiers": [1, 2, 3],
  "surfaces": {
    "state_machine": true,
    "turn_result_validation": true,
    "gate_semantics": true,
    "decision_ledger": true,
    "history": true,
    "config_schema": true,
    "dispatch_manifest": true,
    "hook_audit": true,
    "http_hooks": true,
    "coordinator": true,
    "barriers": true
  },
  "metadata": {
    "name": "AgentXchain Reference CLI",
    "url": "https://github.com/shivamtiwari93/agentXchain.dev"
  }
}
```

### Conformance Report

```json
{
  "implementation": "agentxchain-cli",
  "protocol_version": "v6",
  "tier_requested": 2,
  "timestamp": "2026-04-03T12:00:00Z",
  "results": {
    "tier_1": {
      "status": "pass",
      "fixtures_run": 40,
      "fixtures_passed": 40,
      "fixtures_failed": 0,
      "surfaces": {
        "state_machine": { "passed": 12, "failed": 0 },
        "turn_result_validation": { "passed": 10, "failed": 0 },
        "gate_semantics": { "passed": 6, "failed": 0 },
        "decision_ledger": { "passed": 4, "failed": 0 },
        "history": { "passed": 3, "failed": 0 },
        "config_schema": { "passed": 5, "failed": 0 }
      }
    },
    "tier_2": {
      "status": "pass",
      "fixtures_run": 8,
      "fixtures_passed": 8,
      "fixtures_failed": 0,
      "surfaces": {
        "dispatch_manifest": { "passed": 5, "failed": 0 },
        "hook_audit": { "passed": 3, "failed": 0 }
      }
    }
  },
  "overall": "pass"
}
```

---

## Acceptance Tests

| ID | Assertion |
|----|-----------|
| AT-V22-001 | Reference CLI passes all Tier 1 fixtures when run against itself via the adapter |
| AT-V22-002 | Reference CLI passes all Tier 2 fixtures when claiming trust-hardened |
| AT-V22-003 | Reference CLI passes all Tier 3 fixtures when claiming multi-repo |
| AT-V22-004 | Validator exits 1 and reports failures when a fixture fails |
| AT-V22-005 | Validator exits 2 on malformed adapter response |
| AT-V22-006 | Validator skips Tier 2/3 fixtures when capabilities.json declares only Tier 1 |
| AT-V22-007 | Fixture format validation rejects malformed fixtures before execution |
| AT-V22-008 | Conformance report is valid JSON and contains all required fields |

---

## Implementation Strategy

1. **Fixtures first.** Write the fixtures as static JSON files. Start with Tier 1 state machine fixtures, review them, then expand to the remaining Tier 1 surfaces before writing Tier 2 or Tier 3. Do not dump all 53 fixtures into one unreviewed blob.
2. **Validator second.** Build the `verify protocol` command that reads fixtures, invokes the adapter, collects results, and produces the report.
3. **Reference adapter third.** Write the adapter script that bridges fixtures to the reference CLI's internal APIs (governed-state, turn-result-validator, gate-evaluator, etc.).
4. **Self-validation last.** Prove that the reference CLI passes its own conformance suite. This is AT-V22-001 through AT-V22-003.

---

## Explicit Exclusions

These are NOT part of v2.2 conformance and should not leak into the fixture set:

1. **Plugin lifecycle** — implementation extension, not protocol invariant
2. **Dashboard behavior** — observation layer, not constitutional surface
3. **Adapter transport details** — how you talk to the LLM is implementation-defined
4. **Hook execution internals** — hook _audit_ format is conformance-tested; hook _runner_ behavior is not
5. **Performance characteristics** — conformance is functional correctness, not SLA
6. **CLI UX** — command names, flag syntax, output formatting are implementation choices

---

## Open Questions

1. **Should batch adapter mode be added later as an optimization alongside `stdio-fixture-v1`?** Not for the first cut. Freeze synchronous per-fixture execution first; add batching only if fixture volume makes it necessary.

2. **Should Tier 1 conformance be required for npm package naming?** E.g., packages claiming `agentxchain-*` must pass Tier 1. This is a governance decision, not a technical one. Defer to post-v2.2.

3. **Should fixture setup include pre-populated state files, or should the adapter handle initialization?** Recommend: fixtures include setup state as JSON. The adapter materializes it however the implementation needs. This keeps fixtures implementation-agnostic.

4. **Protocol version pinning: should v2.2 fixtures target only v6, or include v3 compatibility fixtures?** Recommend: v6 only. v3 is the legacy single-repo protocol and should not constrain new conformance work. If someone wants v3 conformance, they can propose a separate fixture set.
