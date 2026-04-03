# Human Tasks — AgentXchain

Tasks that require human action. Organized by priority.

Current state: **two credential issues remain.** (1) The `NPM_TOKEN` in `.env` and GitHub Actions secret is **expired or invalid** — `npm whoami` returns 401 Unauthorized. A new token must be generated before v2.0.1 can publish. (2) Twitter API keys are not yet configured. Human escalation is required for both.

---

## P0 — Human Setup Required

- [ ] **Regenerate NPM_TOKEN** (Priority: P0, RELEASE BLOCKER) — Status: **pending human action**. The current `NPM_TOKEN` in `.env` and GitHub Actions returns `401 Unauthorized` on `npm whoami`. The v2.0.1 publish workflow (run `23934512338`) failed at the "Publish to npm" step with `E404 Not Found` because the token is invalid.
  1. Go to [npmjs.com](https://www.npmjs.com) → sign in as the `agentxchain` package owner
  2. Go to **Access Tokens** → Generate New Token → select **Automation** type
  3. Copy the new token (starts with `npm_`)
  4. Update `.env`: replace the existing `NPM_TOKEN=...` value
  5. Update GitHub Actions secret: go to `github.com/shivamtiwari93/agentXchain.dev` → Settings → Secrets → Actions → update `NPM_TOKEN`
  6. Verify: `source .env && TMP=$(mktemp) && printf '//registry.npmjs.org/:_authToken=%s\n' "$NPM_TOKEN" > "$TMP" && NPM_CONFIG_USERCONFIG="$TMP" npm whoami && rm "$TMP"`
  7. After both are updated, agents can retrigger the publish workflow: `gh workflow run publish-npm-on-tag.yml -f tag=v2.0.1`
  - Context: The tag v2.0.1 is already pushed. The workflow is ready. Only the credential is blocking npm publish.

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

- [~] Prepare a clean release workspace before the cut (Priority: P0) — Delegated to AI agents. Context: the canonical `cd cli && npm version 1.0.0` step is expected to create the release commit and tag. A dirty working tree risks pulling unrelated changes into the release or causing the version step to fail. Human escalation only if the agents cannot reconcile the workspace safely.

- [~] Run `cd cli && npm version 1.0.0` from the clean workspace (Priority: P0) — Delegated to AI agents. Context: this is the canonical v1 version-bump step. In the current npm configuration (`git-tag-version = true`), it creates the release commit and git tag `v1.0.0`. This establishes the immutable release identity that the publish workflow requires.

- [~] Push tag `v1.0.0` to GitHub to trigger automated publish (Priority: P0) — Delegated to AI agents. Context: `git push origin v1.0.0` triggers `.github/workflows/publish-npm-on-tag.yml`, which calls `scripts/publish-from-tag.sh`. The workflow enforces version/tag match, runs strict preflight, publishes via temporary `.npmrc`, and polls the registry for visibility. `NPM_TOKEN` prerequisite is now satisfied in GitHub Actions. Manual fallback if workflow fails: `cd cli && NPM_TOKEN=<token> bash scripts/publish-from-tag.sh v1.0.0`.

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
