# Decisions — AgentXchain

Canonical decision ledger for durable repo-operating decisions. Older decisions still exist inline in `.planning/AGENT-TALK.md`; new or updated durable decisions should be added here when they affect release, CI/CD, governance, or protocol contracts.

## DEC-RELEASE-CUT-AND-PUSH-AS-ATOMIC-001

**Status:** Active, updated 2026-04-21 by CICD-SHRINK.

**Decision:** A release-cut turn is not complete until the version bump, release-surface alignment, commit, tag, push, publish workflow observation, downstream verification, and collaboration log are all handled in the same execution chain.

**Precondition added by CICD-SHRINK:** Before creating any release tag, the release-cut turn MUST run:

```bash
bash cli/scripts/prepublish-gate.sh <target-version>
```

The turn's Evidence block MUST include the gate's exact `PREPUBLISH GATE PASSED for <version>` line. If the gate fails, agents must not create the tag, push the tag, or trigger the publish workflow. The local gate replaces the per-commit CI coverage removed by restricting `ci.yml` to pull-request events.

**Why:** The v2.149.x release incident showed that push-to-main CI density can saturate GitHub Free concurrent slots and block the OIDC publish path for hours. Release safety now depends on a local, explicit, logged gate before tag creation.

## DEC-GITHUB-ACTIONS-FOOTPRINT-FLOOR-001

**Status:** Active as of 2026-04-21.

**Decision:** AgentXchain.dev's steady-state GitHub Actions footprint is intentionally small:

- `publish-npm-on-tag.yml` on `v*.*.*` tags and manual dispatch, because npm trusted publishing requires GitHub Actions OIDC.
- `deploy-gcs.yml` on `website-v2/**`, `docs/**`, or deploy-workflow changes, because production website deploy credentials live in GitHub Actions.
- `governed-todo-app-proof.yml` on nightly schedule and manual dispatch, because the public example proof is useful but too expensive for every push and npm release tags must trigger exactly one workflow.
- `publish-vscode-on-tag.yml` on `vsce-v*.*.*` tags and manual dispatch, because VS Code Marketplace publish is a separate release channel.
- `codeql.yml` on weekly schedule and manual dispatch. GitHub CodeQL default setup must stay disabled because it creates hidden push-triggered `dynamic` runs even when its schedule is weekly.

All other test/proof work is local-first through `cli/scripts/prepublish-gate.sh`.

Adding a workflow that fires on every push to `main` requires explicit human approval through `.planning/HUMAN-ROADMAP.md` and a written justification that the failure mode cannot be covered by the local prepublish gate.

**Why:** Push-to-main workflows created 19 zombie CI runs during the v2.149.x cycle, saturating the 20-slot GitHub Free account limit and stalling release publication. The repo should spend remote workflow capacity only on work that cannot be done locally or that is intentionally low-frequency.

## DEC-BUG59-APPROVAL-POLICY-GATE-COUPLING-001

**Status:** Active as of 2026-04-21.

**Decision:** BUG-59 full-auto gate closure is implemented as a layered governed-state contract, not by moving policy into the pure gate evaluator.

- `approval_policy` is the autonomy surface for routine gate closure; no top-level `full_auto` protocol mode is added.
- Gate definitions may set `credentialed: true | false`. `credentialed: true` is a hard stop: no policy rule, including catch-all `auto_approve`, can close the gate.
- Generated governed configs use explicit policy rules with `credentialed_gate: false` guards and `phase_transitions.default: "require_human"`, rather than broad default auto-approval.
- Policy coupling lives in governed-state paths that have state, ledger, and event context: the accepted-turn drain path and `reconcilePhaseAdvanceBeforeDispatch()`.
- `gate-evaluator.js` remains a pure structural/evidence evaluator. It still returns `awaiting_human_approval` for gates whose structural predicates pass but whose gate definition requires human approval.
- `attemptTimeoutPhaseSkip()` is excluded from BUG-59. Timeout is not positive gate evidence and must fail closed until a separate timeout-escalation policy exists.
- QA ship gates intended for routine auto-approval require both `requires_human_approval: true` and `requires_verification_pass: true`; acceptance-matrix semantics supply the "all ACs pass" proof, while turn verification supplies smoke/test evidence.

**Why:** Research showed the roadmap's original locator (`gate-evaluator.js` human-approval branch) was historically useful but incomplete. The accepted-turn path already consulted approval policy, while generated configs lacked safe defaults and reconcile could still pause on policy-closable gates. This decision ties together `DEC-BUG59-CREDENTIALED-GATE-HARD-STOP-001`, `DEC-BUG59-SCHEMA-NEGATIVE-GUARD-001`, and `DEC-BUG59-RECONCILE-POLICY-COUPLING-001` into the durable integration contract.
