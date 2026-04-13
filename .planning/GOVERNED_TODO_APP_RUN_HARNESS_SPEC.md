# Governed Todo App — Auto-Run Harness Spec

## Purpose

Prove that a **real product example** (not a proof-only scaffold) can complete end-to-end via `agentxchain run --auto-approve` with real API dispatch. This replaces the `DEC-CI-RUNNER-CASE-STUDY-001` limitation that restricted the honest `run` case study to `ci-runner-proof`.

## Problem

`governed-todo-app` uses `manual` adapters for PM and Eng Director roles. `agentxchain run` rejects `manual` adapters. The example cannot run unattended as-is.

## Solution

Create `examples/governed-todo-app/run-auto.mjs` — a harness that:

1. Copies the governed-todo-app project to a temp directory
2. Rewrites `agentxchain.json` to replace all `manual` and `local_cli` adapters with `api_proxy` (Haiku for cost control)
3. Preserves the **4-role structure** (PM, Dev, QA, Eng Director) — this is the product-example differentiator vs ci-runner-proof's 2-role scaffold
4. Preserves the **3-phase workflow** (planning → implementation → qa) with real gate artifacts
5. Removes `requires_human_approval` from gates (auto-approve handles gate progression)
6. Runs `agentxchain run --auto-approve --max-turns 12`
7. Validates governance artifacts: state, history, decision ledger, TALK.md, reports

## Interface

```bash
# Basic execution
node examples/governed-todo-app/run-auto.mjs

# JSON output for CI
node examples/governed-todo-app/run-auto.mjs --json
```

Environment: `ANTHROPIC_API_KEY` required.

## Config Transformation

The harness transforms the original config as follows:

| Original | Harness Override |
|----------|-----------------|
| `manual-pm` (manual) | `api-pm` (api_proxy, Haiku) |
| `local-dev` (local_cli, claude) | `api-dev` (api_proxy, Haiku) |
| `api-qa` (api_proxy, Sonnet) | `api-qa` (api_proxy, Haiku) — downgrade for cost |
| `manual-director` (manual) | `api-director` (api_proxy, Haiku) |
| All gate `requires_files` | removed (api_proxy can't write files) |
| `planning_signoff.requires_human_approval` | removed |
| `qa_ship_verdict.requires_human_approval` | removed |
| `budget.per_run_max_usd` | $5.00 (was $50) |

All role mandates, prompts, routing, and gate file requirements are preserved.

## Behavior

1. Create temp directory, copy `.agentxchain/prompts/` from the example
2. Write transformed config, scaffold state/history/ledger/TALK.md
3. Initialize git repo (required for repo-observer)
4. Spawn `agentxchain run --auto-approve --max-turns 12`
5. On completion, validate:
   - `state.status === 'completed'`
   - `history.length >= 3` (at least PM + Dev + QA turns)
   - `history` contains at least 3 distinct roles
   - Decision ledger has entries
   - TALK.md references all 4 role names
   - Governance export and report exist
   - Real API cost > 0

## Error Cases

- Missing `ANTHROPIC_API_KEY` → exit 1 with clear message
- CLI spawn failure → capture stderr, exit 1
- Validation failure → report which checks failed, exit 1
- Transient API failure → retry up to 3 attempts (Haiku has occasional transient failures)

## Acceptance Tests

- AT-TODO-RUN-001: Harness shells out to real `cli/bin/agentxchain.js` (not direct import)
- AT-TODO-RUN-002: Uses `agentxchain run --auto-approve --max-turns 12`
- AT-TODO-RUN-003: Config preserves 4 roles (pm, dev, qa, eng_director)
- AT-TODO-RUN-004: Config preserves 3 phases (planning, implementation, qa)
- AT-TODO-RUN-005: All runtimes are api_proxy (no manual, no local_cli)
- AT-TODO-RUN-006: Validates ≥3 accepted turns with real API cost
- AT-TODO-RUN-007: Validates governance report generation
- AT-TODO-RUN-008: Cleans up temp directory on completion

## Open Questions

None. The pattern is proven by ci-runner-proof. This extends it to a product example.
