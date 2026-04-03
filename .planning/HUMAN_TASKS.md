# Human Tasks — AgentXchain

Tasks that require human action. Organized by priority.

Current state: **two credential/configuration issues remain.** (1) npm publish auth is not currently usable through either configured path: the `NPM_TOKEN` in `.env` / GitHub Actions is invalid (`npm whoami` returns `401 Unauthorized`), and npm trusted publishing is not authorized for this repo/workflow yet (`workflow_dispatch` run `23935427391` failed with `npm ERR! code ENEEDAUTH`). (2) Twitter/X API keys are not yet configured. Human escalation is required for both.

---

## P0 — Human Setup Required

- [ ] **Restore npm publish authorization for `agentxchain`** (Priority: P0, RELEASE BLOCKER) — Status: **pending human action**. Agents exercised both available publish paths on the release branch:
  - token path failed: `npm whoami` returns `401 Unauthorized`, and workflow run `23934512338` failed publishing with token-backed registry auth
  - trusted publishing path failed: workflow run `23935427391` reached strict preflight, passed tests, then failed `npm publish` with `ENEEDAUTH`
  Choose one of these fixes:
  1. Preferred: configure npm trusted publishing for `shivamtiwari93/agentXchain.dev`
     - Go to [npmjs.com](https://www.npmjs.com) as an owner of `agentxchain`
     - Open package settings for `agentxchain` → trusted publishers
     - Add or verify the GitHub repository/workflow publisher for:
       - repository: `shivamtiwari93/agentXchain.dev`
       - workflow: `.github/workflows/publish-npm-on-tag.yml`
       - environment/branch constraints: allow the release workflow to publish tags
     - Agents can then rerun:
       - `gh workflow run publish-npm-on-tag.yml --repo shivamtiwari93/agentXchain.dev --ref release/v2.0.1 -f tag=v2.0.1`
  2. Fallback: regenerate the automation token
     - Go to npm **Access Tokens** → generate new **Automation** token
     - Update `.env` `NPM_TOKEN=...`
     - Update GitHub Actions secret `NPM_TOKEN`
     - Verify locally:
       - `source .env && TMP=$(mktemp) && printf '//registry.npmjs.org/:_authToken=%s\n' "$NPM_TOKEN" > "$TMP" && NPM_CONFIG_USERCONFIG="$TMP" npm whoami && rm "$TMP"`
  3. After either fix, agents will:
     - rerun publish for `v2.0.1`
     - run `cd cli && bash scripts/release-postflight.sh --target-version 2.0.1`
     - finish GitHub release + Homebrew + merge-back
  - Context: the release workflow itself is now corrected for trusted publishing and strict-preflight ordering. The remaining blocker is npm-side authorization, not the CI graph.

- [ ] Add Twitter/X API credentials to `.env` (Priority: P0) — Status: **pending human action**. Agents cannot post tweets until these are set.
  1. Go to [developer.x.com](https://developer.x.com) and sign in with the @agentxchain account
  2. Create a Project and App (or use existing one)
  3. Go to **Keys and Tokens** tab
  4. Generate/copy these 4 values:
     - **API Key** (Consumer Key) → set as `TWITTER_API_KEY` in `.env`
     - **API Secret** (Consumer Secret) → set as `TWITTER_API_SECRET` in `.env`
     - **Access Token** → set as `TWITTER_ACCESS_TOKEN` in `.env`
     - **Access Token Secret** → set as `TWITTER_ACCESS_TOKEN_SECRET` in `.env`
  5. Make sure the app has **Read and Write** permissions (not Read-only)
  6. Test: `bash scripts/tweet.sh "Hello from AgentXchain"`
  - Context: `scripts/tweet.sh` and `scripts/tweet-thread.sh` are ready. Once credentials are added, agents can post tweets and threads directly from `run-agents.sh`.

---

## P0 — Delegated Release Execution

- [x] Prepare a clean release workspace before the cut (Priority: P0) — Completed by AI agents. Context: the corrective `v2.0.1` tag exists and points at the fixed publish commit.

- [x] Run `cd cli && npm version 2.0.1` from the clean workspace (Priority: P0) — Completed by AI agents during the corrective cut. Context: this created the release identity used by the current `v2.0.1` tag.

- [x] Push tag `v2.0.1` to GitHub to trigger automated publish (Priority: P0) — Completed by AI agents. Context: the publish workflow ran and proved the remaining blocker is credentials, not tag/workflow shape.

- [~] Retrigger `publish-npm-on-tag.yml` for `v2.0.1` after the new `NPM_TOKEN` is configured (Priority: P0) — Delegated to AI agents. Context: agents will rerun the workflow, verify registry truth with `release-postflight.sh`, then proceed to GitHub release and Homebrew update.

- [x] Set `ANTHROPIC_API_KEY` environment variable for live API dogfood run (Priority: P0) — Status: configured in repo-local `.env` and validated with a successful minimal Anthropic Messages API call. Context: this clears the credential prerequisite for Scenario C, but does **not** complete the live governed dogfood run itself.

---

## P1 — Delegated Follow-Through

- [~] Update the Homebrew tap formula to the published `agentxchain@2.0.1` tarball URL and SHA256, then verify the install flow (Priority: P1) — Delegated to AI agents. Context: Homebrew distribution depends on the real published tarball, so this becomes actionable immediately after publish succeeds and `release-postflight.sh` passes.

- [~] Create and publish the GitHub release for `v2.0.1` after npm postflight passes (Priority: P1) — Delegated to AI agents. Context: do not publish GitHub release notes until registry truth is verified; a release page pointing at an unpublished package is the same governance failure in a different costume.

- [~] Execute Scenario D escalation dogfood from `.planning/SCENARIO_D_ESCALATION_DOGFOOD_SPEC.md` after `agentxchain@2.0.1` is released (Priority: P1) — Delegated to AI agents for execution planning and evidence collection. Context: this is post-release validation, not a release blocker. Human escalation is only required if the agents determine a true operator-only decision is necessary to preserve the fidelity of the escalation-path evidence.

- [x] Verify `claude` CLI is installed and authenticated for `local_cli` dogfood (Priority: P1, downgraded from P0 per DEC-LOCAL-CLI-001) — Status: verified on the release machine. `claude` resolves at `/usr/local/bin/claude`, `claude --version` returned `2.1.87 (Claude Code)`, and a live `claude --print "Reply with the single word ok."` call returned `ok`. Context: this clears the operator prerequisite for `local_cli` dogfood but does **not** complete the governed live run itself.

- [x] Run full Scenario A dogfood with live LLM (Priority: P1) — Status: **closed by agent concurrence (DEC-LIVE-001)**. The Anthropic-backed `api_proxy` QA turn succeeded inside the governed loop (run `run_399aea020ebb68d4`, turn `turn_9f5639c671280a8f`, provider telemetry captured). The `local_cli` dev turn hit an external Claude CLI quota limit — not a protocol deficiency. Both collaborating agents (GPT 5.4 Turn 2, Claude Opus 4.6 Turn 3) concur this closes the release-critical Scenario C validation gap. Full evidence in `LIVE_SCENARIO_A_REPORT.md`.

- [x] Decide on npm package scope/name for first publish (Priority: P1) — Decision: continue with the existing unscoped package name `agentxchain` to preserve continuity with prior npm releases through `0.8.8`. Context: local `package.json` remains `agentxchain`; first governed release will continue that lineage rather than creating a new scoped package.

- [x] Enable GitHub Actions and configure branch protection for `agentXchain.dev` repo (Priority: P1) — Status: complete. Actions are enabled on the repo, and `main` is now protected with: pull request required, 1 approving review, up-to-date branch required, required status check `cli`, conversation resolution required, no force pushes, and no deletions.

---

## P2 — Nice to Have

- [x] Review and approve `SPEC-GOVERNED-v4.md` as the normative v1 spec (Priority: P2) — Decision: **approved with minor corrections, not a release blocker**. Rationale: the spec is good enough to serve as the v1 normative reference, but three documentation-drift fixes should be made before the final release tag: (1) reconcile the config file location (`agentxchain.json` root vs `.agentxchain/agentxchain.json` in file layout), (2) align manual adapter wording so it does not imply the run enters `paused` merely because a manual turn is waiting, and (3) add missing governed CLI commands (`resume`, `migrate`) to the command list.

- [x] Review and approve the frozen v1 `accepted_integration_ref` semantics for uncommitted workspace acceptances (Priority: P2) — Status: **closed by agent concurrence (DEC-INTREF-002)**. Both agents independently verified the code (`deriveAcceptedRef()` in `repo-observer.js`) and the live dogfood evidence. `accepted_integration_ref` is the orchestrator-derived git lineage anchor; exact workspace state lives in `history.jsonl → observed_artifact`. Implementation matches spec. No contradiction found.

- [x] Decide whether `approve-transition` and `approve-completion` should stay strict or become idempotent (Priority: P2) — Status: **closed by agent concurrence (DEC-APPROVAL-001)**. Both agents verified the code (`approvePhaseTransition()` and `approveRunCompletion()` in `governed-state.js`). Strict behavior is correct for v1: no pending request = failure. No request identifier exists, so idempotent success would unsafely collapse "already approved" and "nothing pending" into one response. Idempotency may be revisited post-v1 if a request_id is added.

- [x] Set up Homebrew tap for macOS distribution (Priority: P2) — Status: complete. Tap repo created at `shivamtiwari93/homebrew-agentxchain`, formula published, and installation flow verified with `brew tap shivamtiwari93/agentxchain` plus `brew install --dry-run shivamtiwari93/agentxchain/agentxchain`. Current packaging model uses the published npm package `agentxchain@0.8.8`; when `2.0.1` is published, the tap formula only needs its npm tarball URL and SHA256 updated.
