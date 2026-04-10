# CI Multi-Phase Write-Owning Proof Spec

## Purpose

Prove that a governed run with **3+ phases**, **at least one write-owning turn**, and **at least one real gate artifact check** can complete end-to-end in CI using real model dispatch — no human terminal, no synthetic staging, no proof-local semantic coercion.

This is the next honest widening of the CI lights-out proof surface. The existing proofs (`run-with-api-dispatch.mjs` and `run-via-cli-auto-approve.mjs`) use 2 phases with `review_only` roles and empty gates. This proof adds:

1. A `proposed`-authority turn that produces real file content via Haiku
2. A gate with `requires_files` that checks for that file in the workspace
3. A 3-phase lifecycle (planning → implementation → qa)
4. Durable gate-pass evidence via `state.phase_gate_status`, because `gates_approved` only counts paused approvals that flowed through `approveGate`

## Interface

### Script

`examples/ci-runner-proof/run-multi-phase-write.mjs [--json]`

### Environment

- `ANTHROPIC_API_KEY` — required for api_proxy dispatch

### Exit codes

- `0` — governed lifecycle completed with write-owning turn and gate artifact
- `1` — any step failed after all retry attempts

## Config Shape

```json
{
  "schema_version": 4,
  "protocol_mode": "governed",
  "routing": {
      "planning": {
        "entry_role": "planner",
        "allowed_next_roles": ["planner", "implementer", "qa", "human"],
        "exit_gate": "planning_gate"
      },
      "implementation": {
        "entry_role": "implementer",
        "allowed_next_roles": ["planner", "implementer", "qa", "human"],
        "exit_gate": "implementation_gate"
      },
      "qa": {
        "entry_role": "qa",
        "allowed_next_roles": ["planner", "implementer", "qa", "human"],
        "exit_gate": "qa_gate"
      }
  },
  "gates": {
    "planning_gate": {},
    "implementation_gate": {
      "requires_files": ["src/server.js"]
    },
    "qa_gate": {}
  },
  "roles": {
    "planner": {
      "write_authority": "review_only",
      "runtime_class": "api_proxy"
    },
    "implementer": {
      "write_authority": "proposed",
      "runtime_class": "api_proxy"
    },
    "qa": {
      "write_authority": "review_only",
      "runtime_class": "api_proxy"
    }
  }
}
```

## Behavior

### Phase Lifecycle

1. **Planning phase** — `planner` (review_only) receives the task and produces a plan as a review artifact. Mandate instructs the model to request phase transition to `implementation`. Gate: empty, auto-advance.

2. **Implementation phase** — `implementer` (proposed) receives the plan context and produces `proposed_changes` containing `src/server.js` with real Node.js code. Mandate instructs the model to write a hello-world HTTP server and request phase transition to `qa`. Gate: `requires_files: ["src/server.js"]` — checks that the file exists in the workspace.

3. **QA phase** — `qa` (review_only) reviews the implementation. Mandate instructs the model to confirm the server code is reasonable and request run completion.

### Proposal Application Strategy

The `api_proxy` adapter materializes proposals to `.agentxchain/proposed/<turn_id>/` during acceptance. The gate evaluator checks for files in the **workspace root**, not under the proposed directory. Therefore the proof harness must apply proposed files to the workspace before returning from the dispatch callback.

This is honest because:
- The model produces the file content (real Haiku dispatch)
- The proof harness acts as the CI operator applying proposals (same role as `agentxchain proposal apply`)
- The gate evaluator performs a real workspace file check
- No semantic coercion of model output

Implementation: in the `dispatch` callback, after reading the staged turn result, if `proposed_changes` exists, copy each file to the workspace root. Then `gitCommitAll()` so the repo-observer baseline is clean. Return `{ accept: true, turnResult }` — the runLoop then runs gate evaluation, finds the file, and advances. Proof output must report `state.phase_gate_status` so auto-advanced gates are visible even when `gates_approved` remains `0`.

### Retry

Up to 3 attempts. Same contract as existing proofs: single JSON payload in `--json` mode with `attempts_used` and `attempt_history`.

### Budget

- `per_turn_max_usd: 0.50`
- `per_run_max_usd: 3.00` (higher than existing $2.00 — 3 phases = more turns)
- Model: `claude-haiku-4-5-20251001` (~$0.01-0.03 per run)
- `max_turns: 8` (safety cap — expected 3-4 turns)

## Error Cases

| Condition | Behavior |
|-----------|----------|
| Missing `ANTHROPIC_API_KEY` | Dispatch fails, retry exhausted, exit 1 |
| Model fails to produce `proposed_changes` | Gate fails (file missing), subsequent turn retries implementation, eventually retry exhausted |
| Model requests wrong phase transition | Core normalization corrects routing-illegal transitions for review_only; proposed turns may need retry |
| Gate artifact missing after proposed apply | Gate evaluation fails, stays in implementation phase, next turn must re-propose |
| Budget exceeded | runLoop returns blocked, proof reports fail |

## Acceptance Tests

### AT-CIMPA-001: Three-phase lifecycle completion
The proof must complete with `stop_reason: "completed"` through all 3 phases (planning → implementation → qa). History must show at least 3 accepted turns with roles from all 3 phases.

### AT-CIMPA-002: Write-owning turn produces real proposed changes
At least one accepted turn must have `write_authority: "proposed"` and the history must show a non-empty `proposed_changes` array (or the materialized proposal directory must exist).

### AT-CIMPA-003: Gate artifact exists in workspace
After the implementation phase, `src/server.js` must exist in the workspace root (not only under `.agentxchain/proposed/`). The file must contain non-trivial content (not empty, not placeholder).

### AT-CIMPA-004: Real API cost across all phases
Each phase must show non-zero API cost (`cost.usd > 0`). Total real API calls must be ≥ 3.

### AT-CIMPA-005: No proof-local semantic coercion
The proof script must not contain any `normalizeTurnResult`, `normalizeCiTurnResult`, or custom decision/severity/status rewriting. All normalization is done by the core validator.

### AT-CIMPA-006: Gate evaluated with requires_files
The gate `implementation_gate` must use `requires_files: ["src/server.js"]`. The proof must not bypass or mock the gate evaluator.

### AT-CIMPA-007: Auto-advanced gate truth is reported explicitly
The proof payload must include `phase_gate_status` showing `planning_gate`, `implementation_gate`, and `qa_gate` as `passed`. This is the authoritative gate-pass surface for this proof because no gate requires human approval.

### AT-CIMPA-008: Single JSON payload on retry exhaustion
In `--json` mode with all attempts failing, exactly one top-level JSON document is emitted with `attempts_used` and `attempt_history`.

## Open Questions

1. **Should the proof also verify proposal materialization under `.agentxchain/proposed/`?** The current design writes files directly to workspace in the dispatch callback. Proposals are also materialized by `acceptGovernedTurn`. Verifying both copies exist would prove the full lifecycle, but the primary assertion is the workspace gate check.

2. **Should the `implementer` mandate include a strict JSON example for `proposed_changes`?** Haiku can produce `proposed_changes` but the field structure is model-dependent. The mandate should include the expected shape to avoid hallucinated structures.
