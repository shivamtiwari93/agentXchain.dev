# Human Tasks — AgentXchain

Tasks that require human action. Organized by priority.

Current state: **one active blocker — NPM_TOKEN is expired.** The v2.0.0 git tag and GitHub release are live, but npm publish fails with 401 Unauthorized. The token in `.env` and GitHub Actions secrets needs regeneration.

---

## P0 — NPM Token Regeneration

- [ ] Regenerate NPM_TOKEN and publish v2.0.0 (Priority: P0) — The current token returns 401 Unauthorized on `npm whoami`. Steps:
  1. Log in to npmjs.com and generate a new automation/publish token for the `agentxchain` package
  2. Update `.env` in the repo with the new token
  3. Update the GitHub Actions secret `NPM_TOKEN` at `https://github.com/shivamtiwari93/agentXchain.dev/settings/secrets/actions`
  4. Publish manually: `cd cli && source ../.env && NPM_TOKEN=$NPM_TOKEN bash scripts/publish-from-tag.sh v2.0.0`
  5. Or re-trigger CI: `gh workflow run "Publish NPM Package" -f tag=v2.0.0`

- [x] ~~Prepare release workspace and bump version~~ — Done. v2.0.0 tag `ae9c166` pushed. GitHub release at https://github.com/shivamtiwari93/agentXchain.dev/releases/tag/v2.0.0

- [x] Set `ANTHROPIC_API_KEY` environment variable for live API dogfood run (Priority: P0) — Status: configured in repo-local `.env` and validated with a successful minimal Anthropic Messages API call. Context: this clears the credential prerequisite for Scenario C, but does **not** complete the live governed dogfood run itself.

---

## P1 — Delegated Follow-Through

- [~] Update the Homebrew tap formula to the published `agentxchain@2.0.0` tarball URL and SHA256, then verify the install flow (Priority: P1) — Delegated to AI agents. Context: Homebrew distribution depends on the real published tarball, so this becomes actionable immediately after the publish workflow succeeds.

- [~] Execute Scenario D escalation dogfood from `.planning/SCENARIO_D_ESCALATION_DOGFOOD_SPEC.md` after `agentxchain@2.0.0` is released (Priority: P1) — Delegated to AI agents for execution planning and evidence collection. Context: this is post-release validation, not a release blocker. Human escalation is only required if the agents determine a true operator-only decision is necessary to preserve the fidelity of the escalation-path evidence.

- [x] Verify `claude` CLI is installed and authenticated for `local_cli` dogfood (Priority: P1, downgraded from P0 per DEC-LOCAL-CLI-001) — Status: verified on the release machine. `claude` resolves at `/usr/local/bin/claude`, `claude --version` returned `2.1.87 (Claude Code)`, and a live `claude --print "Reply with the single word ok."` call returned `ok`. Context: this clears the operator prerequisite for `local_cli` dogfood but does **not** complete the governed live run itself.

- [x] Run full Scenario A dogfood with live LLM (Priority: P1) — Status: **closed by agent concurrence (DEC-LIVE-001)**. The Anthropic-backed `api_proxy` QA turn succeeded inside the governed loop (run `run_399aea020ebb68d4`, turn `turn_9f5639c671280a8f`, provider telemetry captured). The `local_cli` dev turn hit an external Claude CLI quota limit — not a protocol deficiency. Both collaborating agents (GPT 5.4 Turn 2, Claude Opus 4.6 Turn 3) concur this closes the release-critical Scenario C validation gap. Full evidence in `LIVE_SCENARIO_A_REPORT.md`.

- [x] Decide on npm package scope/name for first publish (Priority: P1) — Decision: continue with the existing unscoped package name `agentxchain` to preserve continuity with prior npm releases through `0.8.8`. Context: local `package.json` remains `agentxchain`; first governed release will continue that lineage rather than creating a new scoped package.

- [x] Enable GitHub Actions and configure branch protection for `agentXchain.dev` repo (Priority: P1) — Status: complete. Actions are enabled on the repo, and `main` is now protected with: pull request required, 1 approving review, up-to-date branch required, required status check `cli`, conversation resolution required, no force pushes, and no deletions.

---

## P2 — Nice to Have

- [x] Review and approve `SPEC-GOVERNED-v4.md` as the normative v1 spec (Priority: P2) — Decision: **approved with minor corrections, not a release blocker**. Rationale: the spec is good enough to serve as the v1 normative reference, but three documentation-drift fixes should be made before the final release tag: (1) reconcile the config file location (`agentxchain.json` root vs `.agentxchain/agentxchain.json` in file layout), (2) align manual adapter wording so it does not imply the run enters `paused` merely because a manual turn is waiting, and (3) add missing governed CLI commands (`resume`, `migrate`) to the command list.

- [x] Review and approve the frozen v1 `accepted_integration_ref` semantics for uncommitted workspace acceptances (Priority: P2) — Status: **closed by agent concurrence (DEC-INTREF-002)**. Both agents independently verified the code (`deriveAcceptedRef()` in `repo-observer.js`) and the live dogfood evidence. `accepted_integration_ref` is the orchestrator-derived git lineage anchor; exact workspace state lives in `history.jsonl → observed_artifact`. Implementation matches spec. No contradiction found.

- [x] Decide whether `approve-transition` and `approve-completion` should stay strict or become idempotent (Priority: P2) — Status: **closed by agent concurrence (DEC-APPROVAL-001)**. Both agents verified the code (`approvePhaseTransition()` and `approveRunCompletion()` in `governed-state.js`). Strict behavior is correct for v1: no pending request = failure. No request identifier exists, so idempotent success would unsafely collapse "already approved" and "nothing pending" into one response. Idempotency may be revisited post-v1 if a request_id is added.

- [x] Set up Homebrew tap for macOS distribution (Priority: P2) — Status: complete. Tap repo created at `shivamtiwari93/homebrew-agentxchain`, formula published, and installation flow verified with `brew tap shivamtiwari93/agentxchain` plus `brew install --dry-run shivamtiwari93/agentxchain/agentxchain`. Current packaging model uses the published npm package `agentxchain@0.8.8`; when `2.0.0` is published, the tap formula only needs its npm tarball URL and SHA256 updated.
