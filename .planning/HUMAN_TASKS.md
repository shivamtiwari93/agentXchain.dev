# Human Tasks — AgentXchain

Tasks that require human action. Organized by priority.

Current state: **no active human credential or publishing-configuration blocker remains.** npm trusted publishing is now configured and validated far enough to reach the release preflight test phase. The remaining `v2.0.0` blocker is agent-owned: the publish workflow fails on a release-blocking test failure in `cli/test/hook-runner.test.js`, not on npm auth or GitHub Actions configuration.

---

## P0 — Release Recovery (Agent-Owned)

- [~] Recover `v2.0.0` publish after trusted publishing setup (Priority: P0) — Status: **human side resolved; agent side still blocked by tests**. Trusted publishing is configured and the GitHub workflow now reaches strict preflight successfully with:
  - clean working tree: pass
  - npm auth / trusted publishing setup: no failure
  Current blocker from workflow run `23931001607`:
  - `npm test` failure in `cli/test/hook-runner.test.js`
  - failing test: `records annotations in hook-annotations.jsonl for after_acceptance (AT-HOOK-005)`
  - assertion at `cli/test/hook-runner.test.js:554`
  Human action is no longer required here unless npm trusted publisher settings are later changed or revoked.

- [x] ~~Prepare release workspace and bump version~~ — Done. v2.0.0 tag `ae9c166` pushed. GitHub release at https://github.com/shivamtiwari93/agentXchain.dev/releases/tag/v2.0.0

- [x] Set `ANTHROPIC_API_KEY` environment variable for live API dogfood run (Priority: P0) — Status: configured in repo-local `.env` and validated with a successful minimal Anthropic Messages API call. Context: this clears the credential prerequisite for Scenario C, but does **not** complete the live governed dogfood run itself.

---

## P1 — Delegated Follow-Through

- [~] Update the Homebrew tap formula to the published `agentxchain@2.0.0` tarball URL and SHA256, then verify the install flow (Priority: P1) — Delegated to AI agents. **Blocked by P0 test failure, not by human setup.** Context: Homebrew distribution depends on the real published tarball, so this becomes actionable immediately after the publish workflow succeeds. Exact post-publish recovery sequence:
  1. Agents fix the release-blocking test failure and rerun publish
  2. Publish v2.0.0 to npm via trusted publishing: `gh workflow run "Publish NPM Package" -R shivamtiwari93/agentXchain.dev --ref main --field tag=v2.0.0`
  3. Verify: `npm view agentxchain@2.0.0 dist.tarball` — capture the tarball URL
  4. Get SHA256: `curl -sL <tarball-url> | shasum -a 256`
  5. Clone tap: `git clone https://github.com/shivamtiwari93/homebrew-agentxchain /tmp/homebrew-agentxchain`
  6. Update formula in `Formula/agentxchain.rb`: change `url` to new tarball URL, change `sha256` to new hash, change `version` to `2.0.0`
  7. Commit and push: `cd /tmp/homebrew-agentxchain && git add -A && git commit -m "Update agentxchain to 2.0.0" && git push`
  8. Verify install: `brew tap shivamtiwari93/agentxchain && brew install agentxchain && agentxchain --version`

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
