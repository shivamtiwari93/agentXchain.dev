# v2.148.0 Tester Verification Runbook Spec

## Purpose

Freeze the operator-facing verification contract for `agentxchain@2.148.0` so BUG-52, BUG-53, BUG-54, and BUG-55 can be re-run against the shipped package without relying on `AGENT-TALK.md` archaeology.

## Interface

- Public surface: `website-v2/docs/releases/v2-148-0.mdx`
- Version under test: `agentxchain@2.148.0`
- Verification channel: tester quotes output from the shipped package, not source-tree runs

## Behavior

- The release notes must include a dedicated tester rerun section for `v2.148.0`.
- The section must name the shipped package form explicitly:
  - `npx --yes -p agentxchain@2.148.0 -c "agentxchain --version"`
- The section must state the evidence needed to close each still-open item in the release lane:
  - `BUG-54`: QA dispatch reliability on `v2.148.0` must exceed 90%, and the quoted output must include the new adapter timing diagnostics (`startup_latency_ms`, `elapsed_since_spawn_ms`) so watchdog tuning can be evaluated from observed startup.
  - `BUG-55 sub-A`: `accept-turn` + `checkpoint-turn` must leave the tree clean without false-positive failure on already-committed-upstream files.
  - `BUG-55 sub-B`: undeclared verification outputs must fail with `undeclared_verification_outputs` plus the `verification.produced_files` remediation pointer, and the declared path must then accept cleanly.
  - `BUG-52`: full CLI chain (`accept-turn` → `checkpoint-turn` → `unblock` → `resume`) on a real escalation must dispatch the next-phase role and emit `phase_entered` with `trigger: "reconciled_before_dispatch"`, with no manual `state.json` patching. Coverage required for both `planning_signoff → implementation` and `qa_ship_verdict → launch`.
  - `BUG-53`: `run --continuous --max-runs N` must emit `session_continuation` between runs and never transition to `paused` between successful runs; final status must be `completed` or `idle_exit` on hitting `--max-runs`.
- BUG-52 and BUG-53 fixes shipped in `v2.147.0` ride along unchanged in `v2.148.0`. The contract must explicitly request re-verification on the latest published package so closure evidence is pinned to the current shipped version, not stale.
- The section must tell the tester what to quote back, not just what to run.
- Older release pages that still mention open ride-along bugs must point operators at the latest shipped rerun contract instead of duplicating their own stale closure checklist.

## Error Cases

- Release notes mention BUG-54/55 generally but do not give exact rerun commands or closure evidence.
- Release notes describe source-tree proof instead of the shipped package.
- Release notes ask for "retry and report back" without naming the exact fields or error class to quote.
- A prior release page leaves an operator on stale version-specific instructions instead of redirecting them to the latest shipped rerun contract.

## Acceptance Tests

1. `website-v2/docs/releases/v2-148-0.mdx` contains a `Tester Re-Run Contract` section.
2. The section includes `agentxchain@2.148.0`.
3. The section names `startup_latency_ms`, `elapsed_since_spawn_ms`, `undeclared_verification_outputs`, `verification.produced_files`, `git status --short`, `phase_entered`, `reconciled_before_dispatch`, and `session_continuation`.
4. A repo test fails if the current release notes drop this verification contract.
5. `website-v2/docs/releases/v2-147-0.mdx` points still-open tester closure work at `/docs/releases/v2-148-0#tester-re-run-contract`.

## Open Questions

- Whether a future generic verification-runbook template should exist outside the `v2.148.0` release page. Not needed for this slice.
