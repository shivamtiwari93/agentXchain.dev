# Release Brief — AgentXchain Governed CLI v1.0.0

Purpose: give Shivam a single handoff document for final human-gated release work.

## Current Status

- Autonomous protocol, spec, test, and docs work is complete.
- Governed CLI is feature-complete for v1.0.0 pending human-gated tasks.
- Test status at handoff: `369 tests`, `84 suites`, `0 failures`.
- Frozen planning/spec artifacts: `13`.

## What v1.0.0 Ships

- Governed v4 as the canonical CLI surface.
- Single-run, single-repo, sequential turn orchestration.
- Full governed lifecycle: assign, dispatch, validate, accept, reject, retry, approve transition, approve completion.
- Three adapter classes: `manual`, `local_cli`, `api_proxy`.
- Five-stage turn-result validation.
- Append-only run history and decision ledger.
- Retry-aware dispatch bundles and rejected-attempt preservation.
- Typed `api_proxy` recovery with staged `api-error.json`.
- Automated lifecycle coverage for happy path and reject/retry.

## Human Actions Required

1. P0: Live API validation.
   Status: **Credential prerequisite resolved** — `ANTHROPIC_API_KEY` is configured in repo-local `.env` and has been verified with a successful minimal Anthropic Messages API call.
   `local_cli` prerequisite is also resolved — `claude` is installed at `/usr/local/bin/claude`, reports version `2.1.87 (Claude Code)`, and a live `claude --print` sanity check returned `ok`.
   Delegation rule: the human has delegated this item back to the collaborating AI agents. If both agents concur that the run was executed correctly and the evidence is sufficient, they may close this item without further human approval.
   Remaining work: release criterion `Scenario C` still requires a full governed run exercising a real Anthropic-backed QA `api_proxy` turn.
   Steps:
   `cd cli && npm link`
   Follow [`DOGFOOD-RUNBOOK.md`](/Users/shivamtiwari.highlevel/VS Code/1008apps/agentXchain.ai/agentXchain.dev/.planning/DOGFOOD-RUNBOOK.md) prerequisites plus Scenario A through the QA `api_proxy` turn.

2. P1: Enable GitHub Actions and branch protection.
   Status: **Resolved**
   Applied on `main`:
   - pull request required
   - 1 approving review required
   - required status check: `cli`
   - up-to-date branch required before merge
   - conversation resolution required
   - force pushes disabled
   - deletions disabled

3. P1: npm package scope/name decision.
   Status: **Resolved**
   Decision: continue publishing under the existing unscoped package name:
   `agentxchain`
   Context: prior npm releases already exist under this name through `0.8.8`, so the governed `1.0.0` release will continue the same package lineage instead of introducing a new scoped identity.

4. P1: Run release packaging checks after the npm name decision.
   Steps:
   `cd cli`
   `npm ci`
   `npm test`
   `npm pack --dry-run`

5. P2: Review and approve [`SPEC-GOVERNED-v4.md`](/Users/shivamtiwari.highlevel/VS Code/1008apps/agentXchain.ai/agentXchain.dev/SPEC-GOVERNED-v4.md).
   Status: **Resolved**
   Decision: approved for v1 with minor pre-tag documentation cleanup only (config path wording, manual adapter state wording, governed CLI command list completeness).

6. P2: Agent-delegable product judgments.
   Status: **Delegated back to AI**
   The following items no longer require default human signoff if both collaborating agents reach explicit concurrence and record the rationale in the planning artifacts:
   - live Scenario A judgment after execution
   - frozen `accepted_integration_ref` semantics
   - strict vs idempotent `approve-transition` / `approve-completion`
   Human escalation is only required on disagreement, missing evidence, or external blockers.

## Release Criteria

- Scenarios A, B, and C pass.
- Clean `npm ci && npm test` passes with `0` failures.
- README quickstart works for a new user.
- `SPEC-GOVERNED-v4.md` and `CLI_SPEC.md` match implementation.
- All P0 human tasks are resolved.
- `cli/CHANGELOG.md` contains the `1.0.0` entry.

## Deferred To Post-v1

- Scenario D: multi-turn escalation dogfood.
- Parallel agent turns / multi-agent concurrency.
- Provider-specific API error code mapping beyond heuristic HTTP/body classification.
- Preemptive tokenization for context-overflow avoidance.
- Automatic retry with backoff for retryable `api_proxy` failures.
- Open state-model questions: persisted blocked sub-state, persisted dispatch/staging sub-state, reachable run-level `failed`.

## Where To Look

- Normative product spec:
  [`SPEC-GOVERNED-v4.md`](/Users/shivamtiwari.highlevel/VS Code/1008apps/agentXchain.ai/agentXchain.dev/SPEC-GOVERNED-v4.md)
- Release gate:
  [`V1_RELEASE_CHECKLIST.md`](/Users/shivamtiwari.highlevel/VS Code/1008apps/agentXchain.ai/agentXchain.dev/.planning/V1_RELEASE_CHECKLIST.md)
- Human-only tasks:
  [`HUMAN_TASKS.md`](/Users/shivamtiwari.highlevel/VS Code/1008apps/agentXchain.ai/agentXchain.dev/.planning/HUMAN_TASKS.md)
- Live validation procedure:
  [`DOGFOOD-RUNBOOK.md`](/Users/shivamtiwari.highlevel/VS Code/1008apps/agentXchain.ai/agentXchain.dev/.planning/DOGFOOD-RUNBOOK.md)
- CLI release notes:
  [`cli/CHANGELOG.md`](/Users/shivamtiwari.highlevel/VS Code/1008apps/agentXchain.ai/agentXchain.dev/cli/CHANGELOG.md)
- Collaboration record:
  [`vision-discussion.md`](/Users/shivamtiwari.highlevel/VS Code/1008apps/agentXchain.ai/agentXchain.dev/.planning/vision-discussion.md)

## Recommended Order

1. Run Scenario C now that `ANTHROPIC_API_KEY` is configured and `claude` is verified.
2. Run packaging dry-run.
3. Apply the minor spec doc-drift corrections already approved for v1.
4. Cut the `1.0.0` release commit/tag.
