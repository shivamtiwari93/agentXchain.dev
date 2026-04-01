# Human Tasks — AgentXchain

Tasks that require human action. Organized by priority.

---

## P0 — Blocking

- [x] Set `ANTHROPIC_API_KEY` environment variable for live API dogfood run (Priority: P0) — Status: configured in repo-local `.env` and validated with a successful minimal Anthropic Messages API call. Context: this clears the credential prerequisite for Scenario C, but does **not** complete the live governed dogfood run itself.

---

## P1 — Important

- [x] Verify `claude` CLI is installed and authenticated for `local_cli` dogfood (Priority: P1, downgraded from P0 per DEC-LOCAL-CLI-001) — Status: verified on the release machine. `claude` resolves at `/usr/local/bin/claude`, `claude --version` returned `2.1.87 (Claude Code)`, and a live `claude --print "Reply with the single word ok."` call returned `ok`. Context: this clears the operator prerequisite for `local_cli` dogfood but does **not** complete the governed live run itself.

- [~] Run full Scenario A dogfood with live LLM (Priority: P1) — Delegation update: the human has delegated this back to the AI agents. If both collaborating agents concur that they can execute the run, interpret the evidence correctly, and record a shared judgment, they should proceed without waiting for human intervention. Human involvement is only required if they cannot complete the run, cannot agree on the outcome, or hit an external blocker that requires operator action. Context: Scenario A (PM → Dev → QA → completion) has been validated with mock/manual turns, but the `api_proxy` QA turn has not been exercised against a real API inside the governed loop. This remains the last major release-validation gap. Prerequisites now satisfied: `ANTHROPIC_API_KEY` configured and validated, `claude` CLI installed and authenticated.

- [x] Decide on npm package scope/name for first publish (Priority: P1) — Decision: continue with the existing unscoped package name `agentxchain` to preserve continuity with prior npm releases through `0.8.8`. Context: local `package.json` remains `agentxchain`; first governed release will continue that lineage rather than creating a new scoped package.

- [x] Enable GitHub Actions and configure branch protection for `agentXchain.dev` repo (Priority: P1) — Status: complete. Actions are enabled on the repo, and `main` is now protected with: pull request required, 1 approving review, up-to-date branch required, required status check `cli`, conversation resolution required, no force pushes, and no deletions.

---

## P2 — Nice to Have

- [x] Review and approve `SPEC-GOVERNED-v4.md` as the normative v1 spec (Priority: P2) — Decision: **approved with minor corrections, not a release blocker**. Rationale: the spec is good enough to serve as the v1 normative reference, but three documentation-drift fixes should be made before the final release tag: (1) reconcile the config file location (`agentxchain.json` root vs `.agentxchain/agentxchain.json` in file layout), (2) align manual adapter wording so it does not imply the run enters `paused` merely because a manual turn is waiting, and (3) add missing governed CLI commands (`resume`, `migrate`) to the command list.

- [~] Review and approve the frozen v1 `accepted_integration_ref` semantics for uncommitted workspace acceptances (Priority: P2) — Delegation update: the human has delegated this decision back to the AI agents. If both collaborating agents independently review the semantics, concur on the judgment, and write down the rationale, their shared decision is sufficient for v1. Human escalation is only required if they disagree or uncover a real contradiction between spec and implementation. Context: The current spec defines `accepted_integration_ref` as the best-known git anchor, with the exact accepted workspace state carried by `observed_artifact` in `history.jsonl`.

- [~] Decide whether `approve-transition` and `approve-completion` should stay strict or become idempotent (Priority: P2) — Delegation update: the human has delegated this decision back to the AI agents. If both collaborating agents review the operator semantics and concur on the right v1 behavior, they should record the decision and proceed. Human escalation is only required if they cannot reach concurrence or if the choice would force a release-scope expansion. Context: Current behavior is strict: no pending request means failure. Idempotent approval sounds nicer operationally, but the commands currently have no request identifier, so "already approved" cannot be distinguished safely from "nothing pending." Blocks: future operator UX polish and any machine-consumable recovery automation.

- [ ] Set up Homebrew tap for macOS distribution (Priority: P2) — Context: `cli/homebrew/` directory exists with a formula skeleton. Needs a real Homebrew tap repo and release automation. Blocks: `brew install agentxchain`.
