# Live Continuous Mixed-Runtime Proof — Spec

## Purpose

Prove that `agentxchain run --continuous --vision` completes a full governed run on the real operator-facing CLI surface while using a production-valid mixed runtime shape:

- local authoring roles satisfy repo-local `requires_files` gates
- a real `api_proxy` review role participates in the governed lifecycle
- continuous session, intake provenance, review artifacts, and cost tracking all stay truthful

This closes the credibility gap between:

- mock-only continuous E2E (`cli/test/continuous-api-proxy-e2e.test.js`)
- one-turn live api proofs (`examples/live-governed-proof/run-live-turn.mjs`)

The product claim here is narrower and more honest than “fully live across every role.” `review_only` `api_proxy` roles still cannot author repo files, so a valid lights-out proof must not pretend otherwise.

## Interface

### Script

```bash
node examples/live-governed-proof/run-continuous-mixed-proof.mjs [--json]
```

- `--json` returns machine-readable proof output

### Environment Gate

- Requires `ANTHROPIC_API_KEY`
- If the key is missing, the script exits `0` with `result: "skip"`

### Runtime Shape

- `pm`: `local_cli`, `authoritative`
- `dev`: `local_cli`, `authoritative`
- `qa`: `api_proxy`, `review_only`
- `eng_director`: `local_cli`, `authoritative`

### Proof Command

The script must shell out to the real CLI binary and run:

```bash
agentxchain run --continuous --vision .planning/VISION.md --max-runs 1 --max-idle-cycles 1 --poll-seconds 0 --session-budget 2.00
```

## Behavior

1. If `ANTHROPIC_API_KEY` is missing, emit a skip result and exit `0`.
2. Create a temp governed repo and initialize git so repo-observer and attribution checks are truthful.
3. Configure authoritative `local_cli` roles to use a repo-owned local proof agent that commits each authored slice.
4. Configure `qa` as `review_only` + real `api_proxy` using a cheap Anthropic model.
5. Write `.planning/VISION.md`.
6. Pre-seed the QA gate files (`acceptance-matrix.md`, `ship-verdict.md`, `RELEASE_NOTES.md`) before the run starts.
7. Run one bounded continuous session through the real CLI.
8. Validate:
   - process exit `0`
   - `.agentxchain/continuous-session.json` exists and reports `status: "completed"` and `runs_completed: 1`
   - `.agentxchain/run-history.jsonl` has one completed entry with continuous/intake provenance
   - `.agentxchain/history.jsonl` includes a `qa` turn with `runtime_id: "api-qa"`
   - `.agentxchain/reviews/` contains a QA review artifact generated from the real api turn
   - session or run state records non-zero API spend
9. Emit a structured proof summary with artifact paths, role order, and spend.
10. Remove the temp repo on success or failure.

### Clean-Baseline Rule

Because the proof repo is a real git repo, authoritative local turns must return the working tree to a clean baseline before the next authoritative turn is assigned. The proof harness therefore uses a committing local proof agent instead of the non-committing mock used by pure E2E tests.

## Error Cases

- Missing `ANTHROPIC_API_KEY` → skip, not fail
- CLI exit non-zero → fail
- Continuous session missing or malformed → fail
- No `qa` history turn with `runtime_id: "api-qa"` → fail
- No generated QA review artifact → fail
- Zero recorded spend on a supposed live API proof → fail
- Local authoritative turn leaves actor-owned files dirty and blocks the next assignment → fail

## Acceptance Tests

1. `AT-LIVE-CONT-001`: script exists and shells out to `cli/bin/agentxchain.js`
2. `AT-LIVE-CONT-002`: script runs `run --continuous --vision .planning/VISION.md`
3. `AT-LIVE-CONT-003`: script skips cleanly with exit `0` when `ANTHROPIC_API_KEY` is missing
4. `AT-LIVE-CONT-004`: doc guidance names the mixed-runtime proof script and explains the `review_only` gate-file boundary
5. `AT-LIVE-CONT-005`: proof validates continuous session, run history provenance, QA review artifact, and non-zero spend

## Open Questions

None. This proof is intentionally scoped to the truthful mixed-runtime shape that the product supports today.
