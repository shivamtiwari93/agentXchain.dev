# CI/Automation Runner Proof — Spec

> Spec for proving governed execution in CI without human interaction.

## Purpose

AgentXchain's vision targets "lights-out software factories" — governed runs that execute over long horizons without constant human steering. The existing CI runner proof scripts (`run-to-completion.mjs`, `run-with-run-loop.mjs`) prove that the **primitives** work: the runner interface and the run-loop library can drive a governed lifecycle to completion. But they use **synthetic dispatch** — hand-built turn results staged directly to disk. No real adapter is invoked, no real model is called, no real governed artifacts are produced by an agent.

This spec closes the gap between primitive proof and real CI execution.

## What Already Exists

| Surface | Status | Gap |
|---------|--------|-----|
| `run-to-completion.mjs` | Shipped | Synthetic dispatch only |
| `run-with-run-loop.mjs` | Shipped | Synthetic dispatch only |
| `agentxchain run --auto-approve` | Shipped | Now proven separately via `CI_CLI_AUTO_APPROVE_PROOF_SPEC.md` |
| `api_proxy` adapter (Anthropic/OpenAI/Google) | Shipped | Never dispatched in CI |
| Non-TTY fail-closed gates | Shipped | Only proven by unit test |
| `ci-runner-proof.yml` workflow | Shipped | Runs synthetic scripts only |

## Scope

**In scope:**
1. A new CI proof script that uses `runLoop` with real `api_proxy` adapter dispatch
2. A GitHub Actions workflow that runs the proof with a real API key
3. Proof that `--auto-approve` gates work in non-TTY CI
4. Proof that governed artifacts (state, history, ledger, TALK, report) are produced

**Out of scope (deferred):**
- Hosted/cloud runner (`.ai` surface)
- Multi-repo coordinator in CI
- Long-running CI jobs with checkpoint/restart
- CI-specific escalation surfaces (webhooks, PR comments)

## Interface

### New Proof Script: `examples/ci-runner-proof/run-with-api-dispatch.mjs`

```
node examples/ci-runner-proof/run-with-api-dispatch.mjs [--json] [--provider anthropic|openai|google]
```

Uses `runLoop` with a real `api_proxy` dispatch callback. The config is a minimal 2-phase project:
- **planning** phase: single `planner` role (api_proxy, review_only)
- **implementation** phase: single `implementer` role (api_proxy, authoritative)
- No `requires_human_approval` on any gate — gates auto-advance on file presence + verification

This means the run completes fully unattended: no gate pauses, no human approval, no TTY.

### Config Shape

```json
{
  "schema_version": 4,
  "protocol_mode": "governed",
  "project": { "id": "ci-api-dispatch-proof", "name": "CI API Dispatch Proof" },
  "roles": {
    "planner": {
      "title": "Planner",
      "mandate": "Produce a one-paragraph plan for the proof task.",
      "write_authority": "review_only",
      "runtime_class": "api_proxy",
      "runtime_id": "api-planner"
    },
    "implementer": {
      "title": "Implementer",
      "mandate": "Write a single source file that satisfies the plan.",
      "write_authority": "authoritative",
      "runtime_class": "api_proxy",
      "runtime_id": "api-implementer"
    }
  },
  "runtimes": {
    "api-planner": { "type": "api_proxy", "provider": "anthropic", "model": "claude-haiku-4-5-20251001" },
    "api-implementer": { "type": "api_proxy", "provider": "anthropic", "model": "claude-haiku-4-5-20251001" }
  },
  "routing": {
    "planning": {
      "entry_role": "planner",
      "allowed_next_roles": ["implementer"],
      "exit_gate": "planning_done"
    },
    "implementation": {
      "entry_role": "implementer",
      "allowed_next_roles": ["planner"],
      "exit_gate": "implementation_done"
    }
  },
  "gates": {
    "planning_done": {
      "requires_files": [".planning/PLAN.md"]
    },
    "implementation_done": {
      "requires_files": [".planning/IMPLEMENTATION_NOTES.md"],
      "requires_verification_pass": true
    }
  },
  "budget": { "per_turn_max_usd": 0.50, "per_run_max_usd": 2.00 },
  "rules": { "challenge_required": false, "max_turn_retries": 2, "max_deadlock_cycles": 1 }
}
```

Uses `claude-haiku-4-5-20251001` for cost control (~$0.01-0.05 per turn).

### Dispatch Callback

The dispatch callback:
1. Reads the dispatch bundle (`ASSIGNMENT.json`, `PROMPT.md`, `CONTEXT.md`)
2. Calls `dispatchApiProxy()` exactly as `run.js` does
3. Reads the staged turn result
4. Returns `{ accept: true, turnResult }` or `{ accept: false, reason }`

This is **not** a new adapter — it reuses the existing `api-proxy-adapter.js`.

### Gate Callback

```javascript
async approveGate(gateType, state) {
  return true; // Auto-approve all gates
}
```

No gates have `requires_human_approval`, so this callback is only invoked as a safety net.

### Validation

After `runLoop` returns, the script validates:
1. `result.ok === true`
2. `result.stop_reason === 'completed'`
3. `result.turns_executed >= 2` (at least planner + implementer)
4. `state.status === 'completed'`
5. `history.jsonl` has at least 2 entries
6. `decision-ledger.jsonl` has entries
7. `TALK.md` includes both role names
8. Each accepted turn has `cost.usd > 0` (real API call made, not synthetic)

### GitHub Actions Workflow Update

Add a new job to `ci-runner-proof.yml`:

```yaml
  api-dispatch-proof:
    runs-on: ubuntu-latest
    if: github.event_name == 'push' && github.ref == 'refs/heads/main'
    steps:
      - uses: actions/checkout@v6
      - uses: actions/setup-node@v6
        with:
          node-version: 22
          cache: npm
          cache-dependency-path: cli/package-lock.json
      - name: Install CLI dependencies
        run: cd cli && npm ci
      - name: Run CI API dispatch proof
        env:
          ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
        run: node examples/ci-runner-proof/run-with-api-dispatch.mjs --json
```

**Only runs on `push` to `main`**, not on PRs — avoids leaking secrets to fork PRs and controls cost.

## Behavior

### Happy Path

1. Script scaffolds a temp directory with `agentxchain.json` and initial state
2. `runLoop` initializes the run
3. Turn 1: `planner` dispatched via `api_proxy` → model returns plan → turn accepted → gate auto-advances to `implementation`
4. Turn 2: `implementer` dispatched via `api_proxy` → model returns implementation → turn accepted → completion gate passes → run completed
5. Script validates all artifacts and exits 0

### Adapter Failure

If the API key is missing or the API call fails:
- `dispatchApiProxy` returns `{ ok: false, classified: { error_class, recovery } }`
- Dispatch callback returns `{ accept: false, reason }`
- `runLoop` records the rejection and may retry (up to `max_turn_retries`)
- If retries exhausted, `runLoop` returns `{ ok: false, stop_reason: 'retries_exhausted' }`
- Script exits 1 with a clear error

### Missing Secret

If `ANTHROPIC_API_KEY` is not set:
- The job is `if: github.event_name == 'push'` so it only runs on main
- If the secret is genuinely missing, the adapter returns `credential_missing` classification
- Script exits 1, CI job fails, but it does not block PRs

## Error Cases

1. **API key absent** — adapter classifies as `credential_missing`, script reports and exits 1
2. **API rate limit** — adapter classifies as `rate_limited`, retry may succeed
3. **Model returns invalid turn result** — `acceptTurn` rejects, retry fires
4. **Budget exceeded** — `runLoop` returns `{ stop_reason: 'budget_exceeded' }`, script exits 1
5. **Timeout** — adapter has built-in timeout, returns `{ timedOut: true }`, dispatch rejects

## Acceptance Tests

| ID | Test | Pass Criterion |
|----|------|---------------|
| AT-CIAPI-001 | Script exits 0 with `ANTHROPIC_API_KEY` set | `result: 'pass'` in JSON output |
| AT-CIAPI-002 | At least 2 turns executed with real cost | Every accepted turn has `cost.usd > 0` |
| AT-CIAPI-003 | Final state is `completed` | `state.status === 'completed'` |
| AT-CIAPI-004 | Governed artifacts valid | `history.jsonl` ≥ 2 entries, `decision-ledger.jsonl` ≥ 2, `TALK.md` includes both roles |
| AT-CIAPI-005 | Script exits 1 without API key | `result: 'fail'` with credential error |
| AT-CIAPI-006 | Budget guard works | `per_run_max_usd: 2.00` is not exceeded |
| AT-CIAPI-007 | GitHub Actions workflow passes on main | Workflow run green |

## CI Reliability: Normalization Layer

Small models (Haiku) produce structured JSON that is often directionally right but inconsistent at two different layers:

1. **Lifecycle/routing drift** — missing forward progression, invalid next-role names, or non-forward phase requests.
2. **Semantic schema drift** — malformed objection statuses/severities, weakly typed verification objects, or terminal `needs_human` on an otherwise approving review.

These must not be handled at the same boundary.

### Core normalization (product behavior)

`cli/src/lib/turn-result-validator.js` owns **unambiguous lifecycle/routing normalization** because that validator is the shared acceptance boundary for `step`, `run`, runner-interface consumers, remote agents, and conformance fixtures.

Core-normalized cases for **review_only** turns:

1. routing-illegal `proposed_next_role` -> allowed fallback
2. self/backward or invalid `phase_transition_request` -> next forward phase
3. completed non-terminal turn with omitted/null lifecycle signal -> next forward phase
4. completed terminal turn with omitted/null lifecycle signal -> `run_completion_request: true`
5. completion turns -> `proposed_next_role: "human"`
6. `needs_human` with affirmative, non-blocker reason on terminal phase -> `run_completion_request: true` (DEC-CI-NORM-006)
7. `needs_human` with affirmative, non-blocker reason on non-terminal phase -> `phase_transition_request: nextPhase` (DEC-CI-NORM-007)

### Proof-local stabilization

This proof no longer performs proof-local semantic stabilization.

The current boundary is stricter:

- product code may repair unambiguous lifecycle mechanics in `turn-result-validator.js`
- CI proof scripts return the raw adapter result and let `acceptTurn` enforce the real product boundary
- if Haiku cannot satisfy the governed contract through that boundary, the proof should fail instead of masking the defect locally

### Retry behavior (DEC-CI-RETRY-001)

Both proof scripts (`run-with-api-dispatch.mjs` and `run-via-cli-auto-approve.mjs`) retry up to 3 attempts on failure. This handles transient cheap-model hallucinations (run_id digit flips, invalid enum values) without masking systemic failures. If the proof fails all 3 attempts, it exits with status 1.

`--json` mode must still emit exactly one parseable JSON payload per invocation. Retry history belongs inside that final payload (`attempts_used`, `attempt_history`), not as multiple top-level JSON blobs.

### Mandate specificity (DEC-CI-MANDATE-001)

Role mandates must include the concrete task description, not references to metadata fields. Haiku takes mandates literally — "plan for the task described in project.description" causes the model to look for that field in its dispatch context and block when it's not found. Direct mandates ("The task is: build X") produce reliable lifecycle signals.

## Implemented Design

- **Config**: 2-phase (planning → review), 2 roles (planner, reviewer), both `review_only` `api_proxy` via `claude-haiku-4-5-20251001`
- **Task**: Concrete hello-world server task embedded in mandates and TALK.md
- **Cost**: ~$0.01-0.02 per run (2 turns typical, $2.00 budget cap)
- **Max turns**: 6 (prevents cost runaway)
- **Gates**: No `requires_human_approval` on any gate — fully auto-advancing
- **Role selection**: Entry-role-for-current-phase (mirrors `run.js` behavior)
- **Retry**: Up to 3 attempts per proof invocation
- **Local proof**: 4/5 consecutive passes verified (remaining failures are transient run_id hallucinations)

## Open Questions

1. **Should we also prove `--auto-approve` via the CLI binary?** Resolved by the standalone subprocess proof in `.planning/CI_CLI_AUTO_APPROVE_PROOF_SPEC.md`. The `runLoop` proof and the CLI proof defend different boundaries and both are required.

2. **Should semantic proof-local stabilization ever move into product code?** Current answer: no, not without a separate product-facing contract and stronger evidence that the coercions preserve operator intent. Lifecycle/routing normalization already moved to the core validator; semantic coercion remains proof-local by design.
