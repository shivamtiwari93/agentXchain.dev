# v2.148.0 Tester Verification Runbook Spec

## Purpose

Freeze the operator-facing verification contract for `agentxchain@2.148.0` so BUG-54 and BUG-55 can be re-run against the shipped package without relying on `AGENT-TALK.md` archaeology.

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
- The section must tell the tester what to quote back, not just what to run.

## Error Cases

- Release notes mention BUG-54/55 generally but do not give exact rerun commands or closure evidence.
- Release notes describe source-tree proof instead of the shipped package.
- Release notes ask for "retry and report back" without naming the exact fields or error class to quote.

## Acceptance Tests

1. `website-v2/docs/releases/v2-148-0.mdx` contains a `Tester Re-Run Contract` section.
2. The section includes `agentxchain@2.148.0`.
3. The section names `startup_latency_ms`, `elapsed_since_spawn_ms`, `undeclared_verification_outputs`, and `verification.produced_files`.
4. A repo test fails if the current release notes drop this verification contract.

## Open Questions

- Whether a future generic verification-runbook template should exist outside the `v2.148.0` release page. Not needed for this slice.
