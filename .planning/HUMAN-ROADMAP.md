# Human Roadmap — AgentXchain

Human-prioritized work for the agents.

Rules:
- Agents should read this file before acting.
- Unchecked items here take priority over general exploration in `AGENT-TALK.md`.
- When an item is complete, agents should mark it complete and briefly record what changed.
- If an item is too large, agents should split it into smaller checklist items and work them down in order.
- Only move an item back to `HUMAN_TASKS.md` if it truly requires operator-only action.

Current focus: **🚨 BUG-52 third variant (critical-path, blocks full-auto lights-out on v2.151.0) — `unblock`-based human-gate resolution does NOT advance the phase when `pending_phase_transition` is `null` and the gate is merely `pending`. Tester's v2.151.0 `tusq.dev` re-test reproduced the loop seven times: approve `unblock` → PM reassigned to same gate → ghost turn → repeat. Only manual `.agentxchain/state.json` surgery escapes. My earlier prediction that BUG-59's approval_policy coupling would resolve this as a side-effect was WRONG — the `approval_policy` lane never triggers in projects that rely on delegated human approval. BUG-52 requires its own fix in the escalation-resolution → phase-state-mutation code path, and MUST ship before BUG-60 (perpetual continuous mode) because BUG-60 inherits the same defect. See BUG-52 entry for full tester evidence + sharpened acceptance. BUG-60 research continues but implementation waits for BUG-52 to ship.** (Prior focus, now superseded: BUG-59 + BUG-60 architectural pair — BUG-59 shipped in v2.151.0 for its narrow scope (approval_policy auto-approval), confirmed working; tester report shows broader defect is actually BUG-52 third variant, not BUG-59 scope limit.) (Prior focus, now closed: CICD-SHRINK — step 1 shipped Turn 115, workflow trigger shrink + repo-accurate plan corrections shipped Turn 116.) (Prior focus, now closed: FULLTEST-58 — Turn 114 restored the full CLI gate by fixing cross-run acceptance-history scoping, stale BUG-51 taxonomy tests, coordinator retry/wave terminal status, restart pending-approval recovery, current-release rerun docs, recent-event fixtures, and the api_proxy proposed lifecycle fixture; full evidence: `6639 tests / 6634 pass / 0 fail / 5 skipped`.) (Prior focus, now closed: BUG-56 — v2.149.1 auth-preflight false positive broke every working Claude Max user; v2.149.2 replaced the static shape-check with a bounded `runClaudeSmokeProbe` and shipped positive + negative command-chain regression tests under rule #13.) (Prior focus, now closed: BUG-57 — pre-existing `dashboard-bridge.test.js` resource leak blocked `npm test` exit and forced `--skip-preflight` on the v2.149.2 bump; Turn 112 fixed per-test bridge teardown and fail-fast test/release scripts.) (Prior BUG-54 hypothesis, now superseded: keychain-auth hang. Turn 137 directly reproduced the tester worktree and isolated the current BUG-54 failure to startup watchdog threshold instead: same Claude binary and auth environment, small 41-byte stdin produced first stdout in 3.3-5.0s, while the realistic 17,737-byte dispatch bundle produced first stdout only at 113,094ms under a 120s watchdog. The old 30,000ms default false-killed healthy realistic Claude prompt processing. Fix path: raise the built-in local CLI startup watchdog default while preserving explicit per-run and per-runtime overrides, then require shipped-package tester quote-back before closing BUG-54.)

Current tester handoff asks: `.planning/TESTER_QUOTEBACK_ASK_V1.md` is the copy-paste BUG-52 third-variant ask; `.planning/TESTER_QUOTEBACK_ASK_V2.md` is the copy-paste BUG-59 / BUG-54 ask; `.planning/TESTER_QUOTEBACK_ASK_V3.md` is the copy-paste BUG-62 reconcile-state ask (self-contained, no companion runbook); `.planning/TESTER_QUOTEBACK_ASK_V4.md` is the copy-paste BUG-61 ghost-turn auto-retry ask (self-contained); `.planning/TESTER_QUOTEBACK_ASK_V5_BUG53.md` is the copy-paste BUG-53 continuous auto-chain + clean idle-exit ask (self-contained). These are handoff wrappers around the canonical runbooks and do not replace the literal tester quote-back requirement.

## Priority Queue

- [x] **BUG-56: v2.149.1 auth-preflight is a FALSE POSITIVE that breaks every working Claude Max user. Ship a real smoke test, stop shipping theories.** ✅ Completed 2026-04-21 (Turn 111, release commit `c87a142a`, homebrew mirror sync `ebacc07e`, tag `v2.149.2`, publish workflow `24707400591` green in 3m4s). Verified: `npm view agentxchain@2.149.2 version` → `2.149.2`; `npx --yes -p agentxchain@2.149.2 -c "agentxchain --version"` → `2.149.2`; canonical Homebrew tap `shivamtiwari93/homebrew-tap` → `agentxchain-2.149.2.tgz` with registry sha256 `57a0e1e61f43e7cb2dc946097c20552d03fcd0f722e53d7b54ad5b587c865768`; in-repo homebrew mirror synced (matches registry sha); `gh release view v2.149.2` → non-draft, tagName `v2.149.2`. **Smoke-probe replaces static shape check**: `runClaudeSmokeProbe()` spawns `claude --print` with 1-byte stdin + 10s watchdog; `getClaudeSubprocessAuthIssue()` (now async) returns `null` when probe produces stdout, returns diagnostic only when probe hangs or exits with empty stdout. Call-sites updated: `connector-probe.js:168`, `connector-validate.js:111`, `local-cli-adapter.js:131`, `doctor.js:505`. Tests: `cli/test/claude-local-auth-smoke-probe.test.js` (probe semantics) + `cli/test/beta-tester-scenarios/bug-56-claude-auth-preflight-probe-command-chain.test.js` (positive Claude Max shim passes; negative hanging shim fails with `claude_auth_preflight_failed`). Decision records: new `DEC-BUG56-PREFLIGHT-PROBE-OVER-SHAPE-CHECK-001`; `DEC-BUG54-CLAUDE-AUTH-PREFLIGHT-001` and `DEC-BUG54-VALIDATE-AUTH-PREFLIGHT-001` marked superseded. Retro: `.planning/BUG_56_FALSE_POSITIVE_RETRO.md`. Rule #13 added to WAYS-OF-WORKING (every preflight gate requires a positive-case regression test that proves it passes for at least one real valid configuration). **`--skip-preflight` caveat**: bump used `--skip-preflight` because a pre-existing `dashboard-bridge.test.js` resource-leak hang (reproduces at v2.149.1 baseline too) blocks `npm test` from exiting. Individual gates verified instead: 366 tests / 93 suites / 361 pass / 0 fail / 5 skipped on BUG-56 + release-alignment + launch-evidence + connector + adapter surfaces; `npm pack --dry-run` → 700.3kB, 283 files, sha `7e81d81be7dfd172cd0ce5e55b3ec91feabdba95`; `website-v2 npm run build` → clean. Followed up as BUG-57 (filed this turn). **The preflight the agents spent two release cycles shipping is wrong.** Tester's exact reproduction on `tusq.dev-21491-clean` with `agentxchain 2.149.1`:

  ```bash
  # Claude Max is authenticated:
  $ claude auth status --text
  Login method: Claude Max Account
  Organization: shivam@gohighlevel.com's Organization
  Email: shivam@gohighlevel.com

  # The exact command the adapter spawns WORKS non-interactively:
  $ printf 'Say exactly READY and nothing else.\n' | \
      claude --print --permission-mode bypassPermissions \
             --model opus --dangerously-skip-permissions
  READY

  # No env-based auth (and none needed — Claude Max uses OAuth/keychain):
  $ env | rg 'ANTHROPIC|CLAUDE'
  (no output)

  # But AgentXchain refuses anyway:
  $ agentxchain connector check local-pm
  FAIL  local-pm (local_cli)
        Probe:  auth_preflight
        Detail: Claude local_cli runtime has no env-based auth and is missing "--bare";
                non-interactive subprocesses can hang on macOS keychain reads.
  ```

  **The preflight's theory is false on this setup.** The claim "non-interactive subprocesses can hang on macOS keychain reads" is specifically what the `printf | claude --print` smoke test disproves. Claude Max's non-interactive path reads the keychain fine. The original BUG-54 hang was caused by something else (probably a specific auth-state edge case in the tester's earlier `tusq.dev-21480-clean` setup, or a Claude CLI version difference, or something else entirely). **The agents shipped a fix for a misdiagnosed root cause.**

  **Direct scold for the agents (read before fixing):**

  1. **You shipped a theory, not a fix.** The v2.149.1 `getClaudeSubprocessAuthIssue()` helper asserts "no env auth + no --bare = hang risk" as a static config-shape check. You never ran a real Claude Max setup through it to see if the check's output matched reality. The tester ran ONE smoke-test command — `printf 'READY' | claude --print` — and proved the theory wrong in under a second. You had 11 turns between Turn 95 (repro script shipped) and Turn 107 (v2.149.1 live) to run that exact command on your own dev box. You didn't.

  2. **You violated rule #12 in spirit.** Rule #12 says command-chain integration tests must spawn real child processes against governed state, not assert function-return shapes. You extended the same seam-vs-flow failure to preflight gates: `claim-reality-preflight.test.js` asserts the preflight FIRES the right warning shape for the right INPUT shape. It does NOT assert the warning is CORRECT for a real-world valid configuration. A test that passes for `{command: "claude", no_env_auth, no_bare}` → emits `auth_preflight` warning is green in CI but says nothing about whether emitting that warning is the right behavior for a working Claude Max user. **That's the same mistake rule #12 was written to prevent. Add a corollary rule for preflight correctness.**

  3. **You spent TWO release cycles on the wrong question.** v2.149.0 preflight failed on warning-ordering. v2.149.1 fixed the ordering. Both turns argued about whether `auth_preflight` should fire before or after `command_presence`. Neither turn asked the prior question: **"Does `auth_preflight` have any business firing for this setup?"** An ordering bug assumes the thing being ordered is correct. You never checked that assumption. DEC-BUG54-CLAUDE-AUTH-PREFLIGHT-001 and DEC-BUG54-VALIDATE-AUTH-PREFLIGHT-001 both codify the wrong preflight logic into canonical contracts across four call-sites (adapter + connector check + connector validate + doctor). **You standardized the defect.**

  4. **The blast radius is bigger than the original bug.** Original BUG-54: intermittent hang on a specific subset of Claude setups (possibly not reproducible on default Claude Max + keychain at all — we never isolated it, we theorized). New BUG-56: **deterministic hard-fail on EVERY Claude Max user who doesn't manually export an env var they shouldn't need.** You made the problem worse for more people while claiming to have fixed it. Tester's framing — "2.149.1 is an improvement because it fails fast with a clear reason" — is generous. It's not an improvement; it's a regression with better error messages. A wrong error shown fast is not better than a right silence shown slowly.

  5. **The tester already gave you the correct fix** (their "Suggested Fix" section, quoted verbatim below). You should have shipped this originally:

     ```text
     if no env auth and no --bare:
       run bounded non-interactive Claude smoke test
       if smoke succeeds: pass, maybe warn keychain auth is being used
       if smoke hangs/fails: fail with current diagnostic
     ```

     That's ~40 lines of code. A 5-second bounded `spawn('claude', ['--print'])` with a 10s watchdog and a 1-byte stdin probe. You already have the subprocess-spawn harness (`cli/scripts/reproduce-bug-54.mjs`). Use it in the preflight.

  **Fix requirements — in this order:**
  1. **BEFORE TOUCHING CODE**: run `printf 'Say READY\n' | claude --print --permission-mode bypassPermissions --model opus --dangerously-skip-permissions` on your own dev box. Confirm it returns `READY`. If it does, you cannot ship ANY fix that asserts "this setup will hang" without also running this exact probe at preflight time. Document the output in the fix turn's Evidence block.
  2. **Replace the static check with a bounded smoke probe.** In `cli/src/lib/claude-local-auth.js::getClaudeSubprocessAuthIssue()`: when env-based auth is absent and `--bare` is absent, spawn `claude --print` with a short stdin prompt (e.g., `"ok"`) and a 10-second watchdog. If it produces stdout before the watchdog fires, return `null` (no issue). If it hangs or exits non-zero with empty stdout, THEN return the current diagnostic. Keep the current error message shape for the hang case; just gate it on actual observation of a hang.
  3. **Update all 4 call-sites to use the new probe result.** `local-cli-adapter.js`, `connector-check.js`, `connector-validate.js`, `doctor.js` — the call-site interface doesn't change; the function semantics do. Existing tests asserting "emits `auth_preflight` on missing-env + missing-bare" must be updated to "emits `auth_preflight` only when the probe shows a real hang" — with a fixture that actually hangs (e.g., a shim script that `sleep 60`s on stdin).
  4. **Add a command-chain regression test** for the Claude Max case: a shim `claude` script that immediately echoes stdin to stdout (simulating a working Claude Max non-interactive path) with no env vars set. `agentxchain connector check <runtime>` MUST pass. `agentxchain connector validate <runtime>` MUST pass. `agentxchain run --continuous` MUST dispatch turns successfully. This test did not exist and must exist before closure.
  5. **Add a command-chain regression test for the actual hang case**: a shim `claude` script that reads stdin but never writes stdout (simulating the keychain-hang failure mode). Same three CLI commands must FAIL with the existing `claude_auth_preflight_failed` diagnostic. This test also did not exist and must exist before closure.
  6. **Update both decision records** (`DEC-BUG54-CLAUDE-AUTH-PREFLIGHT-001` and `DEC-BUG54-VALIDATE-AUTH-PREFLIGHT-001`) to reference the probe-based behavior, not the static-shape behavior. Add an inline "**Superseded contract**: the prior static shape-check was overly strict and false-positived on valid Claude Max setups; see BUG-56 retrospective."
  7. **Write `.planning/BUG_56_FALSE_POSITIVE_RETRO.md`** — what the agents assumed, what the tester disproved in one command, why neither release turn ran that command, how the test suite accepted it, what the corrective rule is. Follow the template of the other false-closure retros.
  8. **New rule (rule #13 candidate)**: *"No preflight gate ships without a positive-case regression test that proves the gate passes for at least one real valid configuration. A test that only asserts the gate's failure output for the failure-case input is not sufficient — it proves the gate can say no, not that it says yes when it should."* Add to the Active Discipline rule list in this file with the BUG-56 incident as the named prior.

  **Acceptance:**
  - Tester's exact reproduction on v2.150.0 or v2.149.2: `agentxchain connector check local-pm` and `agentxchain connector validate local-pm` both PASS on a Claude Max setup with no env vars and no `--bare` flag.
  - Tester's exact reproduction on a hanging-Claude shim still FAILS with the existing diagnostic (no regression on the BUG-54 detection).
  - Two new command-chain tests (positive + negative) in `cli/test/beta-tester-scenarios/` committed before the fix.
  - New rule #13 committed to Active Discipline.
  - BUG_56_FALSE_POSITIVE_RETRO.md committed.

- [x] **BUG-57: `cli/test/dashboard-bridge.test.js` resource-leak hang blocks `npm test` from exiting — forced `--skip-preflight` on v2.149.2.** ✅ Completed 2026-04-21 (Turn 112). Root cause: the `GET /api/timeouts HTTP bridge` governed timeout snapshot suite reused mutable `bridge`/`root` handles across tests while cleaning up only once at suite end, leaking earlier HTTP bridge servers. Fix: `cli/test/dashboard-bridge.test.js` now tears down each bridge/root with `afterEach`; `cli/package.json` pins the Node test phase to `--test-timeout=60000 --test-concurrency=4`; `cli/scripts/release-bump.sh` passes `npm test -- --test-timeout=60000` so release preflight fails fast on future leaks. Evidence: `cd cli && node --test test/dashboard-bridge.test.js` exits cleanly (`87 tests / 87 pass`, ~2.5s); targeted dashboard/gate/reconciliation suites pass; `cd cli && npm test -- --test-timeout=60000` no longer hangs and exits with code 1 because it now exposes unrelated full-suite failures rather than wedging. Follow-on: FULLTEST-58 tracks those newly visible failures before CICD-SHRINK removes per-push CI.

- [x] **FULLTEST-58: Full `cd cli && npm test -- --test-timeout=60000` now terminates but is red; classify and fix the failures before CICD-SHRINK removes per-push CI.** ✅ Completed 2026-04-21 (Turn 114). The full local gate is green again: `cd cli && npm test -- --test-timeout=60000` → `6639 tests / 6634 pass / 0 fail / 5 skipped` in ~476s. Fixes landed across run-scoped acceptance overlap (`assignGovernedTurn` carries `run_id`; `classifyAcceptanceOverlap` skips other runs), BUG-51 continuous-mode expectation drift (`stdout_attach_failed` / `ghost_turn` recovery), current release rerun docs, recent-event stale fixture setup, coordinator wave terminal reasons, coordinator retry handling for child `failed_start`, restart pending-approval recovery, and the api_proxy proposed lifecycle fixture's phase-aware mock response. CICD-SHRINK may now use the local `npm test` gate as a real quality signal.

- [x] **CICD-SHRINK: Execute the workflow-shrink plan in `.planning/CICD_REDUCTION_PLAN.md`.** ✅ Completed 2026-04-21 (Turn 116). Shipped local prepublish gate in Turn 115, then reduced remote workflow footprint in commits `7999a251`, `c95bf975`, `652a931f`, and `10913fc0`: `ci.yml` is pull-request only; `ci-runner-proof.yml` is deleted and its proof contracts now run through local `npm test`/`prepublish-gate.sh`; `governed-todo-app-proof.yml` is nightly/manual only; `deploy-gcs.yml` is scoped to `website-v2/**`, `docs/**`, and its own workflow file; repo-owned `codeql.yml` is weekly/manual only; GitHub CodeQL default setup is disabled after smoke proved it still emitted hidden push runs despite reporting `schedule=weekly`; `.planning/DECISIONS.md` records `DEC-RELEASE-CUT-AND-PUSH-AS-ATOMIC-001` prepublish-gate requirement and `DEC-GITHUB-ACTIONS-FOOTPRINT-FLOOR-001`. Smoke: commit `652a931f` triggered zero workflows; docs/workflow commit `10913fc0` triggered exactly one deploy workflow (`24715589903`, success); dummy tag `v0.0.0-cicd-smoke` triggered only `Publish NPM Package` (`24715606409`) and no governed-todo/vscode/codeql workflows, then the tag was deleted; `gh run list --status queued` → `0`; `gh run list --status in_progress` → `0` after cancelling old pre-shrink CI runs. Targeted proof: affected workflow/spec/doc tests `121/121` pass; workflow-footprint guard `13/13` pass.

- [x] **RELEASE-v2.149: Push the v2.149.1 hotfix — v2.149.0 publish failed, docs went live anyway, npm + Homebrew are stuck on 2.148.0.** ✅ Completed 2026-04-21 (Turn 107, `ae8c2be0`). Publish workflow `24702845949` went green at ~2h36m queued → 2m56s running (GH-hosted runner backlog cleared). Verified: `npm view agentxchain version` → `2.149.1`, `dist-tags.latest` → `2.149.1`; `gh release view v2.149.1` → non-draft, tagName `v2.149.1`; canonical Homebrew tap `shivamtiwari93/homebrew-tap` → `agentxchain-2.149.1.tgz` with sha256 `811a261179e9e6a3ca7dcc9b2c66ff78efa85355621765ae3551f9f756dad7c3`; `release-downstream-truth.sh --target-version 2.149.1` → 3/3 passed. Marketing: X + LinkedIn posted successfully, Reddit posted-but-verification-failed (not a blocker per WAYS-OF-WORKING §8). `/docs/releases/v2-149-0` page was already superseded-bannered at the source level in Turn 104; `Deploy Website to GCP GCS` rerun (`24702442641`) re-queued to propagate. BUG-52/53/54/55 remain OPEN awaiting tester-quoted shipped-package output on 2.149.1. Release notes shipped to `https://agentxchain.dev/docs/releases/v2-149-0` but the binary never reached the registry. Observable state (2026-04-20): `npm view agentxchain version` → `2.148.0`; Homebrew tap formula `url` → `agentxchain-2.148.0.tgz`; `gh release view v2.149.0` → `release not found`. Anyone following the docs link cannot install the fix they are reading about. **Root cause of the stuck publish:** GitHub Actions run `24694846765` (workflow `publish-npm-on-tag.yml`, completed/failure, 3h50m) failed at the release-gate preflight. `cli/test/claim-reality-preflight.test.js:2765` asserted that on a Claude `local_cli` runtime with missing-binary AND missing-auth, the first warning should be `auth_preflight`; v2.149.0 fired `command_presence` first. The preflight did its job — it refused to publish a tarball whose BUG-54 behavior was wrong. The v2.149.1 hotfix (local commits `4de3d469 fix(bug-54): auth-preflight fires before command_presence` + `c2a33d1f docs(release): align 15 surfaces for v2.149.1 hotfix` + `5af9bd8e 2.149.1`) reorders correctly, but the 3 commits sit local-only on `main` and the `v2.149.1` tag was never created on origin. GPT 5.4's Turn 106 cut the hotfix without pushing or logging the turn in AGENT-TALK.md — a direct recurrence of the Turn 104 failure mode that `DEC-RELEASE-CUT-AND-PUSH-AS-ATOMIC-001` was supposed to prevent. **Required actions, in this order:**
  1. `git push origin main` (3 commits ahead) → `git tag v2.149.1` locally if it does not exist → `git push origin v2.149.1`. The push triggers the publish workflow.
  2. Watch the workflow to terminal state via `gh run watch <id> --exit-status`. If it fails again, capture logs with `gh run view <id> --log-failed`, diagnose, and cut v2.149.2 — never reuse a version that hit npm's OIDC trusted-publish flow, even on failure.
  3. After `npm view agentxchain version` returns `2.149.1`, update the Homebrew tap: clone `shivamtiwari93/homebrew-tap`, bump `Formula/agentxchain.rb` `url` + `sha256` to match the new tarball, push.
  4. Create the GitHub release: `gh release create v2.149.1 --title "v2.149.1 — BUG-54 auth-preflight ordering hotfix" --notes-file <notes>`.
  5. **Fix the stale `/docs/releases/v2-149-0` page.** It currently describes a version that never shipped. Either redirect to `v2-149-1` or rewrite content to describe the hotfix version. This is the one item that can't wait — it is visibly wrong to anyone reading the docs right now.
  6. Post release announcement via `bash marketing/post-release.sh "v2.149.1" "<summary>"`.
  7. Log the turn in `.planning/AGENT-TALK.md` before handing off, per `DEC-TURN-LOG-MANDATORY-ON-EXECUTION-TURNS-001`.
  - **Acceptance:** `npm view agentxchain version` returns `2.149.x` (x ≥ 1); Homebrew tap formula references the same version with matching SHA256; `/docs/releases/v2-149-*` page describes the version that actually shipped; `gh release view v2.149.x` succeeds; the release is referenced by a turn log in AGENT-TALK.md naming what was pushed.

- [x] **BUG-59 (architectural): `approval_policy` is disconnected from `requires_human_approval` gate flag — full-auto/autonomous runs always block on human-approval gates even when the configured policy says auto-approve. This is the headline product-promise defect: "full-auto" doesn't actually mean full-auto today.** ✅ Shipped 2026-04-21 in `agentxchain@2.151.0` (release commit `8c4a8ba6`, Homebrew mirror sync `1ee770e9`, publish workflow `24747497938` green, GitHub release live). Post-publish proof: `verify-post-publish.sh --target-version 2.151.0` passed, public `npx` resolved `2.151.0`, full suite green (`6706 pass / 0 fail / 5 skipped`), repo Homebrew SHA `98c26a10f24ce4049dfa5792634c922eeb7c1bca6ab5a8a083d0f7622fe8d2ee` matches registry tarball. Tester quote-back is still required before BUG-60 implementation starts. **Post-closure tester evidence (2026-04-21, v2.151.0):** tester titled their follow-up report *"BUG-59 Not Fully Fixed"* — but careful reading of the evidence shows **BUG-59's actual scope (coupling `approval_policy` into the reconcile path) DID ship and works for projects that configure auto-approval rules**. The tester's flow does NOT configure `approval_policy` — they use **delegated human approval via `agentxchain unblock <hesc>`** and `approve-transition`. That's a different code path. Seven escalations were approved on `tusq.dev` v2.151.0 (`hesc_37d43f0e3908a30b`, `hesc_cccf32a1430eaed5`, `hesc_0e34b2c5c12f6f2b`, `hesc_c5ee0f264325e114`, `hesc_89c97a9477832e35`, `hesc_7143573d66bbf1ea`, `hesc_a0c5bbfb4ad56e61`) — every one resolved the escalation but reassigned PM instead of advancing the phase. Five PM turns became ghost turns during the loop (`turn_719f9e187ae539fc`, `turn_a1e82454ecca3929`, `turn_73e99edc50407733`, `turn_3401760aa1a60052`, `turn_cc4fb94452048b4b`). Only manual `.agentxchain/state.json` editing (`phase: planning → implementation`, clearing stale PM `active_turns`, `planning_signoff: pending → passed`, clearing stale budget reservation, `next_recommended_role: dev`) unblocked the run. **After manual repair the system worked cleanly through dev → QA → checkpoint** — confirming the product artifacts were valid and the blocker was framework state, not evidence quality. **The tester was hitting BUG-52 third variant, not BUG-59.** My earlier prediction that BUG-59 would resolve BUG-52 third variant as a side-effect was **wrong** — documented in the updated BUG-52 entry below. BUG-52 is now the critical-path defect for full-auto; it requires its own implementation work separate from BUG-59's approval_policy coupling.

  **BEFORE WRITING ANY CODE: both agents must do an extensive research + code-review pass, logged in AGENT-TALK, before a single line of implementation lands. See "Required pre-work" block below. The first agent that tries to ship a fix without completing both research turns is violating this item's contract.**

  ---

  **Tester report (2026-04-21, paraphrased):**
  > In full-auto mode, AgentXchain still enforces human approval gates like `qa_ship_verdict`. Run state: 38/38 acceptance criteria PASS, smoke tests exit 0, no active turn, run blocked only on `qa_ship_verdict` human approval. The 5-minute autonomous heartbeat cannot make progress. Expected: in full-auto mode, routine gates auto-approve when verification passes; human gates fire only for external/irreversible decisions, credentialed actions, failed verification, or missing requirements — not merely because the gate exists.

  **The tester's framing has one hole** (credentialed actions SHOULD require human input, and publishing to npm IS credentialed — so if "qa_ship_verdict" means "approve npm publish," the gate should stay human-gated even in full-auto). But the core complaint is valid: full-auto mode should change gate behavior, and today it doesn't. The tester likely intends `qa_ship_verdict` as a routine phase-complete gate, not an external-publish gate.

  ---

  **Root cause — the specific architectural disconnect:**

  AgentXchain already has an `approval_policy` subsystem (`cli/src/lib/approval-policy.js:25-92`, `evaluateApprovalPolicy()`). It supports auto-approval rules per phase transition with conditions like `gate_passed`, `roles_participated`, etc.

  **But `gate-evaluator.js` never consults it for human-approval gates.** At `cli/src/lib/gate-evaluator.js:290-295`:

  ```javascript
  // Rule 5: requires_human_approval → pause instead of advancing
  if (gateDef.requires_human_approval) {
    result.blocked_by_human_approval = true;
    result.action = 'awaiting_human_approval';
    return result;  // ← EARLY RETURN, approval_policy NEVER consulted
  }
  ```

  The early return means: **any gate with `requires_human_approval: true` unconditionally pauses**, regardless of what `approval_policy` says. The two systems are orthogonal when they should be coupled. The policy code exists but has no effect on any gate that actually needs policy evaluation.

  **Downstream consequence in continuous mode:** `cli/src/lib/continuous-run.js:114-120` (`isBlockedContinuousExecution()`) correctly detects `status === 'blocked'` and pauses the heartbeat. This is not the bug — the continuous loop does the right thing *given* the gate is blocked. The bug is upstream: the gate shouldn't be blocked if the configured policy would auto-approve.

  ---

  **What exists today (code audit, 2026-04-21):**

  | Surface | File:line | What it does |
  |---|---|---|
  | Gate definitions | `agentxchain.json:93-115` | 3 gates: `planning_signoff` (L94-101, human), `implementation_complete` (L102-107, verification-pass), `qa_ship_verdict` (L108-115, human) |
  | Gate evaluator | `cli/src/lib/gate-evaluator.js:183-300` | `evaluatePhaseExit()` returns action `'advance' \| 'awaiting_human_approval' \| 'gate_failed' \| 'no_request' \| 'unknown_phase' \| 'no_gate'` |
  | Human-approval short-circuit | `cli/src/lib/gate-evaluator.js:290-295` | **The exact lines that bypass approval_policy** |
  | Approval policy | `cli/src/lib/approval-policy.js:25-92` | `evaluateApprovalPolicy()` — has `rules[]` with conditions, returns `auto_approve \| require_human \| no_match` |
  | Continuous mode block-check | `cli/src/lib/continuous-run.js:114-120` | `isBlockedContinuousExecution()` — correctly pauses on blocked state |
  | Approve-transition command | `cli/src/lib/governed-state.js:5793-5935` | `approvePhaseTransition()` — the only path today that closes a human-approval gate |
  | Approve-completion command | `cli/src/lib/governed-state.js:5952-6090` | `approveRunCompletion()` — final-phase equivalent |
  | Phase reconcile after unblock | `cli/src/lib/governed-state.js:2610-2748` | `reconcilePhaseAdvanceBeforeDispatch()` — BUG-52 fix path; reruns gate eval but still hits the short-circuit |
  | Write-authority model | `cli/src/lib/dispatch-bundle.js:242-287` | `review_only \| authoritative \| proposed` — document write restrictions, but **no gate-closure authority** |
  | `--auto-approve` CLI flag | `cli/src/commands/run.js` (exact line TBD by agents' research) | Runtime blanket override — approves everything, not per-policy |
  | `triage_approval: 'auto'` | `cli/src/lib/normalized-config.js:1256-1269` | Auto-approves intake triage; does NOT affect gate approval |
  | Continuous config | `cli/src/lib/normalized-config.js:1256-1269` | `enabled`, `max_runs`, `max_idle_cycles` — no gate-policy hook |

  **No `full_auto: true` flag exists today.** The mode name in the tester's report is aspirational — what exists is a combination of (`continuous.enabled: true`, `triage_approval: auto`, possibly `--auto-approve`) that the tester is calling "full-auto." Product docs need to either name the mode explicitly or explain the combination.

  ---

  **Related existing artifacts the agents must read before touching code:**

  - `.planning/BUG_52_FALSE_CLOSURE.md` — prior bug in the same reconcile path. The BUG-52 fix added a null-last-failure code path but did NOT change the `requires_human_approval` short-circuit. So BUG-52's fix stopped the "stuck pending" problem but left the "always blocks when policy says advance" problem intact.
  - `.planning/QA_ACCEPTANCE_GATE_SPEC.md` — acceptance matrix semantics. The "38/38 ACs pass" data lives here. Auto-approval logic must read this.
  - `.planning/PROPOSAL_AWARE_GATES_SPEC.md` — proposal-aware workflow gates. Fix must work for both proposal and non-proposal flows.
  - `.planning/IMPLEMENTATION_EXIT_GATE_SPEC.md` — the `requires_verification_pass` case, closest existing precedent for "auto-approve when evidence present."
  - `.planning/GATE_ACTIONS_SPEC.md` — shell actions that run on gate approval. Policy-based auto-approval must either trigger these or document that they don't fire for auto-approvals.
  - `.planning/GATE_FAILURE_VISIBILITY_SPEC.md` — gate-failure diagnostics. Auto-approval audit trail fits this model.
  - `SPEC-GOVERNED-v5.md` (repo root) — authoritative governance spec. Any amendment propagates here.
  - `PROTOCOL-v7.md` (repo root) — latest protocol spec, same requirement.

  ---

  **Required pre-work — BOTH agents must complete before either writes implementation code:**

  **Pre-work turn A — Claude Opus 4.7 research pass** (~one full turn dedicated, no code, log in AGENT-TALK with tag `BUG-59-RESEARCH-CLAUDE`):

  1. **Read every file cited in the code audit table above.** Quote the exact lines that embody the defect. Confirm or challenge the `gate-evaluator.js:290-295` short-circuit claim. If actual behavior differs from this entry's description, flag it — this entry may be wrong in places.
  2. **Read the eight planning artifacts in the "Related existing artifacts" list.** For each, write one sentence on what the fix keeps vs. changes vs. supersedes.
  3. **Enumerate every call-site of `evaluatePhaseExit()` and `evaluateRunCompletion()`.** Cite file:line for each. Identify which need the fix wired in and which are diagnostic-only. Use `grep -rn "evaluatePhaseExit\|evaluateRunCompletion" cli/src`.
  4. **Find every test that exercises `requires_human_approval`.** Cite file:line. Identify which tests would need to change under each of the three fix options below, and which should remain unchanged.
  5. **Trace the tester's exact scenario through the code.** 38/38 ACs pass + smoke exit 0 + no active turn + blocked on qa_ship_verdict → walk from the last turn's `accept-turn` through `applyAcceptedTurn()` through gate evaluation to `blocked`. Quote the exact sequence. The trace is the acceptance criterion that the fix maps to the defect the tester observed — not a theoretical nearby defect.
  6. **Map `approval_policy` config paths.** Find every example of `approval_policy` in the repo (fixtures, tests, docs). Document the supported shape — what conditions can `rules[]` check today? What would need to be added for conditions like `{acceptance_criteria_all_pass: true}` or `{smoke_tests_exit: 0}`?
  7. **Answer three specific questions in writing:**
     a. Is the existing `--auto-approve` CLI flag functionally equivalent to the tester's ask, or does it differ? If it differs, how?
     b. If a project sets `approval_policy.phase_transitions.rules[].action: "auto_approve"` today, does anything happen? Trace the code. (Hypothesis: it only activates in narrow paths that never fire for human-approval gates — confirm or deny.)
     c. What write_authority would a role need to close `qa_ship_verdict` autonomously today? If the answer is "none — no role can," confirm that is correct for external-credentialed gates but incorrect for routine phase gates.
  8. **Do NOT propose a fix in this turn.** Research only. The implementation approach is decided after both research turns land.

  **Pre-work turn B — GPT 5.4 code-review pass** (~one full turn, reads Claude's research + does independent code review, log in AGENT-TALK with tag `BUG-59-REVIEW-GPT`):

  1. **Adversarial review of Claude's research turn.** Challenge every file:line quote. Find at least one factual error or missed call-site or misread spec. The review's job is to make subsequent implementation bulletproof, not to rubber-stamp.
  2. **Independent code review of the `approval_policy` subsystem.** Does it work today for the paths where it IS consulted? A fix wiring approval_policy into gate-evaluator assumes approval_policy is correct; if approval_policy itself is buggy, wiring it up amplifies the bug. Read `cli/src/lib/approval-policy.js` end-to-end and run its tests.
  3. **Identify the "what should full-auto mean" question.** Full-auto is an identity, not just a gate-approval policy. Enumerate which gates/phases/run-boundaries a full-auto run should advance without human input, and which it should NOT. Present as a matrix:

     | Gate/boundary | Under full-auto, should auto-advance? | Rationale | Override mechanism if no |
     |---|---|---|---|
     | planning_signoff | ? | ? | ? |
     | implementation_complete (verification-pass) | ? | ? | ? |
     | qa_ship_verdict | ? | ? | ? |
     | run_completion | ? | ? | ? |
     | phase transitions with failing gates | ? | ? | ? |
     | intake triage | ? | ? | ? |
     | proposal acceptance | ? | ? | ? |

     Fill in every cell with a concrete answer + justification. This becomes the basis for the config schema.
  4. **Propose the config schema in writing, not code.** What does "full-auto" look like in `agentxchain.json`? Top-level mode, nested flag, expansion of existing `approval_policy`, or a new `automation_mode` key? Pick one and justify. Include the failure modes of the others.
  5. **Identify the credentialed-gate escape hatch.** Even in full-auto, gates protecting external irreversible credentialed actions (publish to npm, deploy to prod, send money) MUST still require human input. Enumerate how a project declares which gates are credentialed.
  6. **Challenge Claude's trace.** Independently walk the tester's scenario through the code. If the traces disagree on even one step, neither turn can claim research is complete — a third turn reconciles before implementation.
  7. **Do NOT propose implementation in this turn.** Implementation approach is decided by a third turn (either agent) that synthesizes research + review + fix-option-space into a concrete plan, THEN a fourth turn (other agent) reviews the plan, THEN implementation begins.

  **Neither pre-work turn may alter `agentxchain.json`, `cli/src/lib/gate-evaluator.js`, or `cli/src/lib/approval-policy.js`.** These turns produce documentation only. Implementation gate: both research turns completed, both logged, both cross-referenced, and a plan turn agreed between agents.

  ---

  **Fix option space (for the plan turn to decide, not for research turns to execute):**

  **Option 1 — Couple approval_policy into gate-evaluator.** Remove the early return at `gate-evaluator.js:290-295`. Before returning `awaiting_human_approval`, consult the effective `approval_policy`. If a rule matches with `action: "auto_approve"` and conditions are met, return `'advance'` instead. Otherwise return human-approval action as today. Minimal schema change; leverages existing subsystems. **Risk:** existing projects with `requires_human_approval: true` + no `approval_policy` behave unchanged (default is require_human), but projects that HAD tried to configure `approval_policy` discover it now has actual effect — possibly surprising if they treated it as a no-op.

  **Option 2 — Add explicit `full_auto` top-level mode.** New enum value alongside `legacy` and `governed`. Under `full_auto`, gate evaluator has a different branch evaluating structural predicates + approval_policy + irreversibility-classification, only blocking on gates marked `credentialed: true`. **Risk:** third mode to maintain; semantics between `governed + approval_policy: auto_approve_all` and `full_auto` overlap. Documentation burden.

  **Option 3 — Per-gate `auto_approvable` classifier + mode-aware defaults.** Each gate declares `auto_approvable: true | false | "if_verification_passes"`. Under `governed` mode, defaults to false (human-gated). Under a new `full_auto` mode or `approval_policy.mode: "autonomous"`, defaults apply: `true` auto-closes when predicates pass, `if_verification_passes` auto-closes when verification pass evidence present, `false` always blocks (reserved for credentialed gates). **Risk:** most ceremony; needs migration for existing gate configs.

  The plan turn chooses between these (or proposes a fourth) based on research findings. Human's lean without having done the full research: Option 1 with a small extension for credentialed-gate tagging, because it minimizes schema surface and activates infrastructure that already exists but is disconnected. **Not binding — agents are explicitly expected to push back with evidence.**

  ---

  **Fix requirements — the plan turn and implementation turns MUST address all of these, in this order:**

  1. **Resolve the approval_policy ↔ gate-evaluator disconnect.** Whatever Option wins, the commit that lands must close the gap documented at `gate-evaluator.js:290-295`. The commit's primary test MUST be: a project with `requires_human_approval: true` + `approval_policy` configured with an auto_approve rule matching the current phase → gate closes without human input.

  2. **Preserve credentialed-gate safety.** There MUST exist a configuration where a gate is marked as protecting a credentialed action and NO auto-approval policy can override it — not even a catch-all rule. Implementation must demonstrate via a negative-case regression test: a gate tagged credentialed + approval_policy rule "auto_approve everything" → gate still blocks on human. This is Rule #13 territory (positive + negative regression tests required).

  3. **Document the policy-decision trace in state.** When a gate auto-closes by policy, state/event log MUST record which policy rule matched, what evidence was consulted, and at what timestamp. Operators need to debug "why did this release auto-ship?" A one-line `auto_approved_by_policy: {rule_id, conditions_matched, evidence_refs}` in the phase-transition event is the minimum.

  4. **Update `SPEC-GOVERNED-v5.md` and `PROTOCOL-v7.md`.** Both must describe auto-approval semantics. No code change lands without spec alignment (WAYS-OF-WORKING §3).

  5. **Add regression tests at two levels.** Unit: approval_policy evaluation with every condition combination. Command-chain (Rule #13): `agentxchain run --continuous` on a project configured for full-auto, from clean init through qa_ship_verdict, asserts zero human approval actions occur. Reproduces the tester's exact scenario (38 ACs pass + smoke exit 0 + no active turn → gate auto-closes).

  6. **Add a decision record.** `DEC-BUG59-APPROVAL-POLICY-GATE-COUPLING-001` documenting chosen option, trade-offs, and the call-site integration pattern. Any future gate added to the system must route through the same coupling.

  7. **Update the tester docs.** `website-v2/docs/` — specifically the page describing continuous/autonomous operation. Explain how to configure full-auto, what gates still require human input, how to declare credentialed-gate overrides. The tester's report exists because the docs currently imply full-auto means full-auto.

  8. **BUG-53 overlap.** This bug and BUG-53 (continuous session doesn't auto-chain after run completion) are sibling defects under the same root cause — "autonomous mode doesn't actually chain autonomously." Check whether fixing BUG-59's approval_policy coupling resolves BUG-53 as a side-effect. If yes, close BUG-53 with this fix. If no, explain why and what BUG-53's remaining scope is.

  ---

  **Acceptance criteria:**

  - Tester's exact scenario on v2.151.0 or later: full-auto run with `approval_policy` configured for auto-approval on qa→launch, 38/38 ACs pass, smoke tests exit 0 → run advances to launch phase WITHOUT human approval. Evidence: tester-quoted CLI output showing phase transition with `trigger: auto_approved_by_policy`.
  - Negative case: same config but gate tagged as credentialed → gate STILL blocks on human approval even with auto_approve rule configured. Evidence: tester or agent-run CLI output showing `blocked` status despite policy match.
  - Both research turns (Claude + GPT) logged in AGENT-TALK with `BUG-59-RESEARCH-CLAUDE` and `BUG-59-REVIEW-GPT` tags, committed before any implementation commit.
  - `DEC-BUG59-APPROVAL-POLICY-GATE-COUPLING-001` committed.
  - Spec docs (`SPEC-GOVERNED-v5.md`, `PROTOCOL-v7.md`) updated.
  - `bug-59-full-auto-gate-closure.test.js` in `cli/test/beta-tester-scenarios/` committed with positive + negative cases.
  - Docs page updated with full-auto configuration guide.

  ---

  **Process reminders:**
  - Do NOT skip the research turns. The Rule #12-alike ancestor here is "no architectural change ships without two agents' independent analysis." This is the first roadmap entry to formalize that; treat it as precedent.
  - Do NOT flip any checkbox without tester-quoted output on a published version showing the tester's scenario pass.
  - Do NOT touch `.planning/VISION.md`.

- [ ] **BUG-60 (architectural / missing feature): Continuous mode has no `perpetual` policy — when vision-derived work queue goes empty, the session idle-exits cleanly instead of dispatching a PM turn to synthesize the next increment from broader sources (VISION + ROADMAP + SYSTEM_SPEC + product state). For "full-auto product development" as currently marketed, `no_derivable_work_right_now ≠ vision_is_exhausted`.**

  **BEFORE WRITING ANY CODE: both agents must do an extensive research + code-review pass, logged in AGENT-TALK, before a single line of implementation lands. See "Required pre-work" block below. Same discipline as BUG-59. Sequenced AFTER BUG-59 — do not start BUG-60 implementation until BUG-59's gate-closure coupling is shipped and tester-verified. Rationale: BUG-60 depends on gates closing correctly in full-auto, because a PM-synthesized increment that runs through the full phase chain will hit qa_ship_verdict and launch_ready; if BUG-59 isn't fixed, BUG-60's perpetual chain stalls at the first gate.**

  ---

  **Tester report (2026-04-21, v2.150.0, real `tusq.dev` dogfood):**

  Tester ran: `npx --yes -p agentxchain@latest -c 'agentxchain run --continuous --vision .planning/VISION.md --max-runs 1 --max-idle-cycles 3 --poll-seconds 5 --triage-approval auto --auto-checkpoint --no-report'`

  Output:
  ```text
  Idle cycle 1/3 — no derivable work from vision.
  Idle cycle 2/3 — no derivable work from vision.
  Idle cycle 3/3 — no derivable work from vision.
  All vision goals appear addressed (3 consecutive idle cycles). Stopping.
  ```

  Status after: `cont-0fbd49b2 / completed / Runs: 0/1 / Idle cycles: 3/3`.

  **The tester's framing:** *"This is valid for bounded delivery mode, but insufficient for long-running product development mode. No derivable work right now is treated as The product has no more meaningful work. Those are different states."*

  **Tester's suggested schema:**
  ```json
  {
    "continuous": {
      "on_idle": "pm_derive_next_increment",
      "sources": [".planning/VISION.md", ".planning/ROADMAP.md", ".planning/SYSTEM_SPEC.md"],
      "stop_only_when": "vision_explicitly_satisfied_or_human_stops"
    }
  }
  ```

  Proposed modes: `bounded` (current — stop when no derivable work), `perpetual` (PM-derive-next on idle), `human-review` (stop + ask human). Tester workaround on tusq.dev: strengthened the heartbeat prompt. Their view: *"The framework should make this a first-class policy so users do not need prompt-level patches."*

  **Not a BUG-53 regression.** BUG-53's fix (previously-paused → now idle-exits cleanly) is correct for bounded mode. BUG-60 is a missing feature that sits on top of BUG-53's clean idle-exit, not a defect in it. The tester was explicit: *"This is not necessarily a bug in bounded continuous mode. It is a missing framework capability for full-auto product development."*

  ---

  **Current behavior audit (code audit, 2026-04-21, confirmed against live code):**

  | Surface | File:line | What it does today |
  |---|---|---|
  | Idle cycle counter increment | `cli/src/lib/continuous-run.js:468-469` | `session.idle_cycles += 1; log('Idle cycle N/M — no derivable work from vision.');` |
  | Terminal idle-exit check | `cli/src/lib/continuous-run.js:348-351` | `if (session.idle_cycles >= contOpts.maxIdleCycles) { session.status = 'completed'; return { status: 'idle_exit' }; }` — **THIS is the insertion point for perpetual-policy branch** |
  | User-facing idle-exit string | `cli/src/lib/continuous-run.js:94-96` | `All vision goals appear addressed (N consecutive idle cycles). Stopping.` — misleading for perpetual mode (conflates "queue empty" with "vision exhausted") |
  | Vision derivation | `cli/src/lib/vision-reader.js:176-217` `deriveVisionCandidates()` | **Reads VISION.md only.** Return shape: `{ ok, candidates: [{section, goal, priority}], error? }`. Compared against `loadCompletedIntentSignals()` + `loadActiveIntentSignals()`. **No integration with ROADMAP.md, SYSTEM_SPEC.md, .planning/* state, or .agentxchain/state.json.** |
  | Run-loop vs continuous-loop boundary | `cli/src/lib/continuous-run.js:337-486` `advanceContinuousRunOnce()` | Continuous loop owns the 3-cap decision (max_runs / idle_cycles / session_budget). Run-loop is unaware of idle detection. |
  | Budget cap enforcement | `cli/src/lib/continuous-run.js:354-362` | `per_session_max_usd` — categorical block, not warning. Terminates session when hit. Evidence: `session.budget_exhausted = true; return { status: 'completed', stop_reason: 'session_budget' }`. **Perpetual mode MUST respect this same cap.** |
  | Continuous config schema | `cli/src/lib/normalized-config.js:1279-1292` `normalizeContinuousConfig()` | `enabled, vision_path, max_runs, max_idle_cycles, triage_approval, per_session_max_usd`. Plus runtime-only options in `resolveContinuousOptions()` at `continuous-run.js:302-317`: `poll_seconds`, `cooldown_seconds`, `auto_checkpoint`. **No `on_idle` or `continuous_policy` field exists.** |
  | Intake record entry | `cli/src/lib/intake.js:328-387` `recordEvent()` | Sources: `manual, ci_failure, git_ref_change, schedule, vision_scan` (line 32). **Adding `vision_idle_expansion` as a new source classifier fits the existing pattern.** Schema at `intake.js:365-382`. |
  | Intake triage | `cli/src/lib/intake.js:393-466` `triageIntent()` | detected → triaged. Requires priority, template, charter, acceptance_contract. |
  | Intake approve | `cli/src/lib/intake.js:793-854` `approveIntent()` | triaged → approved. Stamps `approved_run_id` or `cross_run_durable`. |
  | Intake plan | `cli/src/lib/intake.js:860-929` `planIntent()` | approved → planned. Generates `.planning/` artifacts from template. |
  | Intake start | `cli/src/lib/intake.js:935-1136` `startIntent()` | planned → executing. Creates governed run + turn assignment. |
  | PM dispatch + prompt override | `cli/src/lib/dispatch-bundle.js:184-205` `renderPrompt()` | `config.prompts[roleId]` points to prompt file; customPrompt injected at line 417-423. **This IS the override mechanism for "derive from broader sources" — swap `prompts.pm` for the idle turn, or inject an additional mandate block.** |
  | Role mandate rendering | `cli/src/lib/dispatch-bundle.js:221-225` | Pulls from `config.roles[roleId].mandate`. Could accept a per-dispatch mandate override as an alternative to swapping the whole prompt file. |
  | ROADMAP.md references | `cli/src/lib/init.js:197, 235-236`, `governed-templates.js:327-328, 341-359`, `validation.js:17, 66-71`, `planning-artifacts.js:6-7, 72, 77, 90`, `prompt-core.js:98` | ROADMAP.md is already a canonical artifact — templates reference it, doctor validates structure, prompts mention it. **But `deriveVisionCandidates()` does not read it.** The integration work is small. |
  | SYSTEM_SPEC.md references | `cli/src/lib/workflow-gate-semantics.js:5, 91, 106`, `planning-artifacts.js` | `SYSTEM_SPEC_PATH` is referenced in gate semantics for planning exit. Same situation — canonical, but not in vision derivation. |
  | Test fixtures — continuous + idle | `cli/test/vision-reader.test.js:117-155` (AT-VCONT-001..003), `cli/test/continuous-3run-proof-content.test.js` | Existing tests mock vision + intents. **No test today covers "idle cycle → PM dispatch → new intent → run resumes."** The BUG-60 regression test must add this. |

  **`on_idle` / `idle_policy` / `continuous_policy` string does NOT appear anywhere in the codebase.** This is a greenfield feature. No partial implementation to respect or replace.

  ---

  **Four guardrails the tester's proposed schema needs that they didn't spell out:**

  1. **Dispatch mechanism must be explicit.** Tester says "PM should inspect sources and produce next increment." Two viable paths:
     - **Option A — via intake pipeline.** Continuous loop calls `recordEvent({ source: 'vision_idle_expansion', ... })` synthesizing an intent whose CHARTER is "inspect vision/roadmap/spec/state, produce next increment as a new intake intent with acceptance criteria." Runs through `triageIntent → approveIntent → planIntent → startIntent` naturally. PM turn dispatches via standard run-loop. Advantage: every idle-expansion is a first-class auditable intent. Disadvantage: adds a layer of indirection — the synthesized intent's output is itself another intent.
     - **Option B — direct special-case dispatch.** Continuous loop directly materializes a PM turn with an override prompt (leveraging `dispatch-bundle.js:184-205`'s prompt-override mechanism) outside the intake pipeline. Advantage: simpler, one-step. Disadvantage: bypasses governance audit trail; adds a special-case code path to continuous-run.js.
     - **Recommendation to research turns:** Option A is architecturally cleaner. Pick and justify with evidence, don't assume.

  2. **Infinite-loop and budget safeguards for perpetual mode.** A misbehaving PM that keeps producing non-executable increments would burn through budget forever. Required safeguards:
     - **Honor existing `per_session_max_usd`** (already categorical block at `continuous-run.js:354-362` — verify perpetual mode doesn't bypass it).
     - **New `max_idle_expansions` cap** (e.g., default 5): after N consecutive PM idle-expansions with no run reaching launch, stop with status `vision_expansion_exhausted`. Distinct from `max_idle_cycles` which counts vision-scan polls that found no work; this counts PM expansions that failed to produce executable work.
     - **Explicit PM output schema.** PM turn's acceptance criterion is either (a) produce a structured "new increment" artifact (the minimum: a new intake intent with charter + acceptance_contract + priority), OR (b) produce a structured "vision_exhausted" declaration with reasoning citing which vision goals are complete vs deferred. Anything else is acceptance_failure, re-dispatch once, then abort.

  3. **"Concrete increment" has a canonical form.** The tester's list ("new roadmap item, new system-spec section, new intake intent, new acceptance criteria, new implementation task, new launch/release task") conflates outputs and side-effects. The continuous loop needs ONE canonical form it knows how to consume. Proposal: **the PM turn MUST produce at least one new intake intent** (schema at `intake.js:365-382`, with triageIntent-ready fields: priority, template, charter, acceptance_contract). Roadmap updates and spec sections are supporting evidence, not the required deliverable. Without a new intent, the run-loop has nothing to dispatch.

  4. **VISION.md immutability constraint.** `.planning/VISION.md` is immutable per WAYS-OF-WORKING — never modified by agents. The PM turn's mandate MUST include an explicit read-only clause for VISION.md. ROADMAP.md and SYSTEM_SPEC.md are mutable; PM can modify them as part of producing the next increment. This constraint must live in the PM-idle-expansion prompt override, NOT be left to the static PM prompt which wasn't written for this purpose.

  ---

  **Proposed config schema (for research turns to sharpen, not adopt verbatim):**

  ```json
  {
    "continuous": {
      "enabled": true,
      "vision_path": ".planning/VISION.md",
      "max_runs": 50,
      "max_idle_cycles": 3,
      "per_session_max_usd": 25,
      "on_idle": "exit",

      "on_idle_perpetual": {
        "sources": [".planning/VISION.md", ".planning/ROADMAP.md", ".planning/SYSTEM_SPEC.md"],
        "max_idle_expansions": 5,
        "pm_mandate_override_path": ".agentxchain/prompts/pm-idle-expansion.md",
        "output_schema": "intake_intent",
        "stop_when_pm_declares_exhausted": true
      }
    }
  }
  ```

  With `on_idle` accepting `"exit" | "perpetual" | "human_review"` (research turns may propose other names). `on_idle_perpetual` block only relevant when `on_idle: "perpetual"`.

  ---

  **Related existing artifacts the agents must read before touching code:**

  - `cli/src/lib/continuous-run.js` — entire file, not just cited lines; understand the main loop at `:692-712` that consumes `advanceContinuousRunOnce()` results
  - `cli/src/lib/vision-reader.js` — entire file; understand current VISION.md-only parsing
  - `cli/src/lib/intake.js:1-200` — lifecycle state machine; understand which transitions are allowed
  - `cli/src/lib/dispatch-bundle.js:180-260` — prompt and mandate override mechanics
  - `.agentxchain/prompts/pm.md` (in the main repo, not fixtures) — current PM prompt; understand how it's written and whether an idle-expansion prompt would be a replacement or a supplemental block
  - `cli/test/vision-reader.test.js` — AT-VCONT-001..003 fixtures; understand test shape for candidate derivation
  - `cli/test/continuous-3run-proof-content.test.js` — live continuous proof; understand how a 3-run test is structured (BUG-60's regression test will extend this pattern)
  - `.planning/BUG_52_FALSE_CLOSURE.md` — prior reconcile-path bug; understand lesson about "fix covers synthetic path but not operator path"
  - BUG-59 roadmap entry (above this one) — share research methodology; BUG-60's two-agent gate mirrors BUG-59's

  ---

  **Required pre-work — BOTH agents must complete before either writes implementation code:**

  **Pre-work turn A — Claude Opus 4.7 research pass** (~one full turn dedicated, no code, log in AGENT-TALK with tag `BUG-60-RESEARCH-CLAUDE`):

  1. **Verify the code audit table above.** Every file:line reference. Confirm or challenge. If live behavior differs from the roadmap's description, flag it — this entry may be wrong in places.
  2. **Choose Option A (intake pipeline) vs Option B (direct dispatch) with evidence.** Don't pick based on aesthetic preference. Read both paths, cite the pros/cons concretely, pick one.
  3. **Specify the PM idle-expansion prompt.** Write the full prompt text that would be injected via the override mechanism. What artifacts does it read? What does "produce next increment" mean in concrete acceptance terms? What does "vision_exhausted" look like structurally? Drop a complete draft prompt in the turn log.
  4. **Trace a full perpetual-mode scenario through the code.** Starting state: a project where run 1 has just completed, queue is empty. Walk through: idle-cycle detection → (new branch) PM dispatch → PM synthesizes new intent → intake pipeline → new run starts → run completes. Quote every state transition. Identify every place where state could diverge from intended behavior.
  5. **Map every test that would need to change.** `cli/test/continuous-*.test.js`, `cli/test/vision-reader.test.js`, `cli/test/intake-*.test.js` — which tests assert current bounded-only behavior that would need updating (not breaking — updating) to accommodate perpetual mode?
  6. **Answer four specific questions in writing:**
     a. Can a PM turn dispatched via Option A (intake pipeline) carry a prompt override, or does it always use the static PM prompt? If not, which intake field or dispatch mechanism would need to be added?
     b. Does `per_session_max_usd` enforcement at `continuous-run.js:354-362` fire BEFORE or AFTER a PM idle-expansion would dispatch? Trace the ordering.
     c. What happens today if `deriveVisionCandidates()` is called with VISION.md deleted or malformed? Is the error path resilient, or does continuous mode crash? Perpetual mode needs to handle this gracefully.
     d. BUG-59 overlap check: if BUG-59 ships approval_policy coupling and a PM-synthesized increment's qa_ship_verdict gate is configured to auto-approve, does the perpetual chain survive run-to-run cleanly? Or is there a race between continuous-run.js's next-run-start and governed-state.js's gate-closure events?
  7. **Do NOT propose implementation.** Research only.

  **Pre-work turn B — GPT 5.4 code-review pass** (~one full turn, reads Claude's research + does independent code review, log in AGENT-TALK with tag `BUG-60-REVIEW-GPT`):

  1. **Adversarial review of Claude's research.** Find at least one factual error or missed path. Same requirement as BUG-60-REVIEW-GPT.
  2. **Challenge the guardrail set.** Are the four guardrails above (dispatch mechanism, safeguards, canonical form, VISION.md immutability) sufficient? Missing guardrails? Over-engineered? Specifically address: what prevents a PM turn from producing an intent that describes work OUTSIDE the project's vision (scope creep via idle-expansion)? Is vision-coherence itself a required PM acceptance check?
  3. **Independent config schema proposal.** Compare against the tester's suggestion and the roadmap's proposal. Propose the schema you'd ship. Justify field names. Propose deprecation path if any existing field changes semantic meaning.
  4. **Write the acceptance matrix for perpetual mode.** Similar to BUG-59's matrix but for idle behavior:

     | Condition | Perpetual-mode action | Rationale |
     |---|---|---|
     | Queue empty, vision has candidates | ? | ? |
     | Queue empty, vision has no candidates, ROADMAP has items | ? | ? |
     | Queue empty, no vision/roadmap/spec candidates | ? | ? |
     | PM idle-expansion produces "vision_exhausted" | ? | ? |
     | PM idle-expansion fails acceptance (malformed output) | ? | ? |
     | Budget cap hit mid-PM-turn | ? | ? |
     | max_idle_expansions hit | ? | ? |
     | Run started from PM-expansion fails at qa_ship_verdict | ? | ? |
     | User Ctrl-C during idle-expansion | ? | ? |

  5. **Verify the BUG-59 dependency.** Is BUG-60's perpetual chain actually blocked on BUG-59's gate-closure fix, or can it ship independently? Trace a hypothetical perpetual run's first qa_ship_verdict under the current (unfixed) gate-evaluator behavior. If it blocks, the sequence holds. If it can somehow advance, the dependency is looser than claimed and BUG-60 could ship in parallel.
  6. **Reconciliation check.** If Claude's research and GPT's review disagree on even one material point (dispatch option, schema field, guardrail set), a third turn reconciles before implementation begins.
  7. **Do NOT propose implementation.**

  **Neither pre-work turn may alter `cli/src/lib/continuous-run.js`, `cli/src/lib/vision-reader.js`, `cli/src/lib/intake.js`, or `cli/src/lib/normalized-config.js`.** Documentation only. Implementation gate: both research turns completed, both logged, both cross-referenced, plan turn agreed between agents, AND BUG-59 shipped + tester-verified.

  ---

  **Fix requirements — the plan turn and implementation turns MUST address all of these:**

  1. **New `on_idle` config field** with at minimum `exit | perpetual | human_review` values. Default = `exit` for backward compatibility. Projects that explicitly set `perpetual` opt into the new behavior.
  2. **Perpetual branch at `continuous-run.js:348-351`** — when `idle_cycles >= maxIdleCycles` AND `on_idle === "perpetual"`, do NOT set `status = 'completed'`; instead dispatch the PM idle-expansion path.
  3. **Extend `deriveVisionCandidates()`** (or add a sibling `deriveRoadmapCandidates()` + `deriveSpecCandidates()`) to read ROADMAP.md and SYSTEM_SPEC.md when configured in `on_idle_perpetual.sources`. Preserve current VISION.md-only behavior as the default.
  4. **PM idle-expansion prompt shipped** at the canonical path (`.agentxchain/prompts/pm-idle-expansion.md`). Prompt must include VISION.md immutability clause, the canonical output schema (new intake intent), and the "vision_exhausted" escape schema. Template projects get this prompt in their scaffold.
  5. **Budget and loop safeguards.** New `max_idle_expansions` field (default 5). Existing `per_session_max_usd` MUST block perpetual-mode dispatches same as bounded-mode. Regression test for both.
  6. **Positive regression test (Rule #13).** Tester-sequence test at `cli/test/beta-tester-scenarios/bug-60-perpetual-idle-expansion.test.js`: start a continuous session with `on_idle: perpetual`, mock vision with initial work, let run 1 complete, assert PM idle-expansion fires, produces a new intake intent, run 2 starts, completes. **Use child-process `execFileSync('agentxchain', [...])` per Rule #12, not function-level seams.**
  7. **Negative regression test (Rule #13).** Same setup but with `max_idle_expansions: 1` and a mocked PM that produces malformed output → session stops with `vision_expansion_exhausted` status, NOT infinite loop.
  8. **Update `DEC-BUG59-APPROVAL-POLICY-GATE-COUPLING-001` to reference this bug** (perpetual mode assumes gates close correctly — test the cross-bug dependency).
  9. **New decision record** `DEC-BUG60-PERPETUAL-CONTINUOUS-POLICY-001` documenting the chosen option, schema, guardrails, and canonical PM output shape.
  10. **Spec updates** in `SPEC-GOVERNED-v5.md` and `PROTOCOL-v7.md` — describe perpetual mode semantics.
  11. **Docs update** in `website-v2/docs/` — specifically whichever page describes continuous operation. Explain three `on_idle` modes, when to use each, how to configure PM idle-expansion prompt override.
  12. **BUG-53 overlap.** BUG-53 is about post-run-completion auto-chain (currently goes paused → now idle-exits cleanly per BUG-53's fix). BUG-60 sits on top of BUG-53. Verify that with BUG-60 shipped AND `on_idle: perpetual`, a 3-run session completes run 1 → PM-expands → run 2 → PM-expands → run 3, never entering `paused`. This is BUG-53's sharpened acceptance criterion ALSO.

  ---

  **Acceptance criteria:**

  - Tester's exact reproduction on v2.152.0 or later (after BUG-59 + BUG-60 both ship): `agentxchain run --continuous --on-idle perpetual --max-runs 10` on a real project with VISION.md containing partial coverage → session completes at least 2 chained runs where run 2's intent was PM-synthesized on idle, not pre-existing. Tester-quoted output required.
  - Perpetual-mode stop case: when PM-idle-expansion produces a `vision_exhausted` declaration, session stops cleanly with status `vision_exhausted` (distinct from `completed` for bounded, and distinct from `idle_exit`). Tester-quoted output required.
  - Budget-cap case: `per_session_max_usd` hit during a PM idle-expansion → session stops with `session_budget` status, NOT perpetual-mode infinite spend. Regression test required.
  - `max_idle_expansions` cap case: 5 consecutive failed PM expansions → session stops with `vision_expansion_exhausted`, NOT infinite loop. Regression test required.
  - Both research turns (Claude + GPT) logged in AGENT-TALK with `BUG-60-RESEARCH-CLAUDE` and `BUG-60-REVIEW-GPT` tags, committed before any implementation commit.
  - `DEC-BUG60-PERPETUAL-CONTINUOUS-POLICY-001` committed.
  - Spec docs updated. Docs page updated. `.agentxchain/prompts/pm-idle-expansion.md` committed as a canonical scaffold artifact.
  - `bug-60-perpetual-idle-expansion.test.js` committed with positive + negative cases.
  - **BUG-59 closed first with tester-verified evidence.** Non-negotiable sequencing.

  ---

  **Process reminders:**
  - Do NOT skip the research turns. Same discipline as BUG-59 — this is the second roadmap entry to formalize the two-agent pre-work gate. If BUG-59 and BUG-60 both ship cleanly, promote the two-agent pre-work gate to a standing rule (Rule #14 candidate).
  - Do NOT flip this checkbox without tester-quoted output on a published version showing the perpetual chain actually completing at least 2 PM-expansion → run cycles.
  - Do NOT touch `.planning/VISION.md`. (This is especially important here since BUG-60 is ABOUT reading VISION.md — tempting to "fix" it as part of the work. Resist. Humans own VISION.md.)

- [ ] **BUG-61: Ghost-turn recovery requires manual operator intervention — full-auto loop stalls on every ghost turn. Compounds with BUG-54 to make lights-out unreliable.**

  **Tester report 2026-04-21 on v2.150.0 `tusq.dev` dogfood:**
  - `turn_97eee736ab49bab9`: `runtime_spawn_failed`, 58s dispatch with no subprocess output
  - `turn_ec72b780e6347d22`: `runtime_spawn_failed`, 101s dispatch with no subprocess output (was the current blocker)
  - `turn_70400ff1f07b8b74`: prior ghost PM turn, reissued to `turn_fae691907af78136`

  Every ghost turn requires manual `agentxchain reissue-turn --turn <id> --reason ghost`. Under current behavior, full-auto lights-out cannot proceed through any ghost turn without a human. Tester: *"Ghost turns should be rare and recover cleanly without requiring repeated manual intervention."*

  **Relationship to BUG-54:** BUG-54 addresses the FREQUENCY of false ghost turns (watchdog threshold was 30s, raised to 120s in v2.151.0). BUG-61 addresses the RECOVERY BEHAVIOR when a real ghost turn is detected. Different concerns: BUG-54 reduces how often ghosts fire; BUG-61 removes the manual step when they do fire. The two fixes together deliver "ghost turns are rare AND recover cleanly."

  **Note on v2.151.0 impact:** the tester's 58s and 101s ghost durations were both >30s (old watchdog) but <120s (new watchdog). Under v2.151.0 they might no longer classify as ghosts — might be slow-but-working Claude dispatches. Tester should re-test on v2.151.0 before assuming every BUG-61 repro scenario still reproduces. If v2.151.0 reduces ghost-turn rate enough, BUG-61 drops from "blocking" to "resilience improvement" — still worth shipping but less urgent.

  **Two fix paths — research turn decides which or both:**

  1. **Automatic retry with bounded budget.** When a turn is detected as ghost (watchdog fires + zero stdout received), automatically issue `reissue-turn --reason ghost` up to N times (default 2). Track retry count in state. If all retries produce ghosts, escalate to human with full diagnostic bundle.
  2. **Faster-fail diagnostic surface.** Keep the current "manual reissue" posture but make the diagnostic output actionable: subprocess exit code, captured stderr, spawn env boolean-presence, resolved binary path, watchdog threshold effective at dispatch time. So when the operator runs `reissue-turn`, they know WHY and whether reissuing is likely to help.

  Options are compatible — Option 1 is the lights-out fix, Option 2 is the diagnostic-quality fix. Both should ship.

  **Safeguards for Option 1 (auto-retry):**
  - **Per-run retry budget:** max 3 auto-retries per run, not per turn. Prevents cascading ghost loops.
  - **Retry fingerprinting:** if N consecutive ghosts have the same signature (same runtime, same role, same prompt shape), stop retrying and escalate — a pattern means something systematic, not transient.
  - **Preserve manual escape hatch:** `reissue-turn --reason ghost` remains operator-facing. Auto-retry must not hide diagnostic history; every auto-retry emits an event the operator can audit.
  - **Configurable:** `auto_retry_on_ghost: { enabled: true, max_retries_per_run: 3, cooldown_seconds: 5 }`, enabled by default for full-auto mode, disabled for manual mode.

  **Fix requirements:**
  1. Define "ghost turn" precisely in a decision record: `runtime_spawn_failed` AND zero stdout bytes received AND watchdog fired. Current detection signals at `cli/src/lib/adapters/local-cli-adapter.js:133,309,350` have the raw signal; the classification rule needs to be explicit for retry logic to key off of it reliably.
  2. Add `auto_retry_on_ghost` config block to `cli/src/lib/normalized-config.js`'s continuous section. Defaults as above.
  3. Implement retry mechanism in continuous-run loop. On ghost detection: check retry budget, issue `reissueTurn()` programmatically with `reason: 'auto_retry_ghost'`, reset watchdog, emit `auto_retried_ghost` event to `.agentxchain/events.jsonl`, increment run-scoped counter.
  4. On final escalation after retries exhausted: attach full diagnostic bundle (per-attempt subprocess state, resolved runtime config, watchdog threshold, stdin transport shape, any captured stderr).
  5. Positive + negative regression tests (Rule #13 / command-chain): (a) simulate 2 ghosts + 1 success in sequence → turn completes via auto-retry, `events.jsonl` shows two `auto_retried_ghost` entries + one success; (b) simulate 4 consecutive ghosts → session escalates to human with diagnostic bundle, `auto_retried_ghost` count = 3 (budget cap), `reason_escalated: "retry_budget_exhausted"` on the escalation.
  6. Update tester runbook to describe auto-recovery + opt-out.

  **Acceptance:** tester runs `tusq.dev` full-auto on a future shipped version. A ghost turn occurs → next event in `.agentxchain/events.jsonl` shows `auto_retried_ghost` → subsequent turn succeeds → session proceeds without operator intervention. Tester-quoted CLI output showing the recovery.

- [ ] **BUG-62: Operator-commit reconcile path is missing — any manual commit on top of an agent checkpoint produces `Git HEAD has moved since checkpoint` drift and blocks all further agent work. Compounds every other full-auto defect because the workarounds require manual commits which then cause this.**

  **Tester report 2026-04-21 on v2.150.0:**
  - After manual commit `e838d9f Add M16 manifest diff PM increment`, `agentxchain status` reported: `Drift: Git HEAD has moved since checkpoint: e838d9f1 -> 369972f4`
  - After subsequent manual commit `369972f Implement tusq manifest diff command`, the run was still BLOCKED on drift

  Compounds the full-auto problem: every operator intervention for other bugs (BUG-52 third variant, BUG-61 ghost-turn, BUG-60 idle-expansion gap) creates drift that blocks further agent work, requiring ANOTHER manual intervention to recover. **Net effect: agents cannot make forward progress autonomously if ANY operator commit has ever landed on top of a checkpoint.**

  Tester: *"Operator commits should be reconciled cleanly into run state or restart context."*

  **Root cause hypothesis (research needed):** state.json records `checkpoint.git_sha` at the last agent-driven checkpoint. When operator commits on top of that SHA, agents detect drift and refuse to proceed because they can't prove the new HEAD is compatible with their state model. Today there is no command that says "accept the operator's commits as the new baseline." The ops workaround is to patch `.agentxchain/state.json` by hand, which is fragile and undocumented.

  **Safe vs unsafe operator commits — the fix must distinguish these:**
  - **Safe (auto-reconcile-able):** fast-forward commits on top of `checkpoint.git_sha` that don't rewrite history, don't modify `.agentxchain/` state files, don't delete accepted-turn artifacts, don't roll back completed phase evidence
  - **Unsafe (must still block):** force-pushes, history rewrites, `state.json` edits, deletion of `history.jsonl`/`events.jsonl`/`acceptance-matrix.md`, rollback of a checkpointed phase

  **Fix requirements:**

  1. **New command: `agentxchain reconcile-state --accept-operator-head`.** Reads current HEAD, walks commits between `checkpoint.git_sha` and HEAD, applies safety checks (fast-forward only, no `.agentxchain/` modifications, no state-file deletions, no history rewrite), updates `checkpoint.git_sha` to new HEAD, emits `state_reconciled_operator_commits` event listing the accepted commits with SHAs and paths-touched.

  2. **Automatic reconciliation for continuous / full-auto runs.** New config field: `reconcile_operator_commits: "manual" | "auto_safe_only" | "disabled"` in `normalized-config.js` continuous section. Default: `"manual"` for governed mode (preserve current block), `"auto_safe_only"` for full-auto mode (auto-run the reconcile command before each dispatch, but only if safety checks pass). Operator can override via flag or config.

  3. **Diagnostic output when reconciliation is refused.** Which commit, which rule tripped (e.g., "commit abc123 modifies .agentxchain/state.json — reconcile cannot auto-accept state-file edits. Manual recovery: ..."), concrete recovery recipe. This replaces today's generic "drift detected" message.

  4. **Positive + negative regression tests (Rule #13 / command-chain):**
     - (a) Agent checkpoints at SHA A → operator commits SHA B adding only product-code files → run `reconcile-state --accept-operator-head` → assert `checkpoint.git_sha === B`, event emitted with paths touched, next agent turn dispatches without drift block.
     - (b) Same setup but operator commit modifies `.agentxchain/state.json` → assert reconcile refuses with specific actionable error naming the offending file.
     - (c) Same setup but operator force-pushed (rewrote history such that `checkpoint.git_sha` is no longer an ancestor of HEAD) → assert reconcile refuses with "history-rewrite" error class.

  5. **Document the safety contract** in `website-v2/docs/` continuous-operation page. Explain what operator actions are safe to do mid-run, what requires `reconcile-state`, what requires a full session restart.

  **Acceptance:** tester's scenario reproduced on a future shipped version — manual commit on top of a checkpoint → `agentxchain status` shows drift → `agentxchain reconcile-state --accept-operator-head` succeeds → next agent turn proceeds without further intervention. OR under `reconcile_operator_commits: "auto_safe_only"`, the reconcile happens automatically and the next turn dispatches without operator running the command manually. Tester-quoted CLI output showing the flow.

  **Agent-side implementation surfaces are complete in v2.154.7 (awaiting tester quote-back):** `.planning/BUG_62_OPERATOR_COMMIT_RECONCILE_SPEC.md`, the manual `agentxchain reconcile-state --accept-operator-head` primitive (event `state_reconciled_operator_commits`), the automatic `run_loop.continuous.reconcile_operator_commits: "auto_safe_only"` policy with `maybeAutoReconcileOperatorCommits()` at `cli/src/lib/continuous-run.js:369+` and validation at `cli/src/lib/normalized-config.js:649+` (`VALID_RECONCILE_OPERATOR_COMMITS = ['manual', 'auto_safe_only', 'disabled']`), default promotion to `auto_safe_only` under full-auto approval policy, the `operator_commit_reconcile_refused` run event mirrored into `blocked_reason.recovery.detail`, command-chain tests at `cli/test/beta-tester-scenarios/bug-62-operator-commit-reconcile.test.js` (5/5 passing on HEAD 2026-04-22), normalized-config shape tests at `cli/test/continuous-run.test.js:275-323`, and docs in `website-v2/docs/lights-out-operation.mdx`. BUG-62 remains unchecked because tester quote-back per `.planning/TESTER_QUOTEBACK_ASK_V3.md` has not landed on a published `agentxchain@2.154.7+` session. If quote-back surfaces a previously unseen `auto_safe_only` refusal-class edge case, file it as a narrow BUG-62 follow-up slice rather than reopening the shipped auto-config work by default.

  **Cross-references:**
  - **BUG-52 third variant:** the tester's `d2ab914` and `77762c8` manual recovery commits (to unblock planning_signoff and launch_ready gates) are examples of operator commits that today create BUG-62 drift. Fixing BUG-62 reduces the blast radius of BUG-52 even if BUG-52 itself isn't closed.
  - **BUG-61 ghost-turn manual recovery:** any manual `reissue-turn` invocation that touches git state benefits from BUG-62's reconcile path.
  - **BUG-60 perpetual continuous:** perpetual mode that hits any of the above will inherit the drift problem unless BUG-62 is fixed.

- [ ] **BUG-54: local_cli runtime spawn/attach repeatedly fails — reliability bug, not detection. Agent-side fix surfaces shipped; tester quote-back still required.** Verified. `cli/src/lib/adapters/local-cli-adapter.js:133,309,350` emits `runtime_spawn_failed` / `stdout_attach_failed` — **detection works**. Tester's v2.148.0 clean-retest (fresh worktree, session, run) reproduced PM-turn failures and proved the bug was `local_cli` runtime-general, not QA-specific. Later shipped fixes addressed the diagnosed root cause and lifecycle gaps, but BUG-54 remains unchecked until literal tester quote-back proves the shipped package on real `tusq.dev`.
  - **Tester's v2.147.0 evidence (QA-specific):** run_4b24e171693ac091 had 6 consecutive QA startup failures alternating `runtime_spawn_failed` / `stdout_attach_failed`: `turn_81bbd843`, `turn_df73f5d4`, `turn_e95f8517`, `turn_1d93790`, `turn_75116ed7`, `turn_7763138`.
  - **Tester's v2.148.0 clean-retest evidence (PM-affected too):** isolated worktree `tusq.dev-21480-clean`, session `cont-68fcad95`, run `run_15787079e4eb9e07`. PM turns repeatedly fail with same 3 failure modes. Reissued repeatedly via native recovery, keeps reproducing. Bug is not role-specific and not state-corruption — it's `local_cli` runtime-general.
  - **AMPLIFIED EVIDENCE (tester's expanded report 2026-04-20):** **29 consecutive clean PM attempts in `tusq.dev-21480-clean` produced ZERO successful PM turns.** Quoted: *"No PM turn completed successfully. No turn was accepted, merged, or checkpointed as completed work. No implementation or QA phase started. The repeated 'work' was only framework recovery: `reissue-turn --reason ghost`, `step --resume`."* Every single attempt hit `runtime_spawn_failed` / `stdout_attach_failed` / `ghost_turn`. ~2.5 hours of framework time produced exactly one thing: more diagnostic evidence that v2.148.0 is broken. This rules out reliability-class hypotheses: it's not flaky (0% success, not 20%), it's not a race (deterministic reproduction), it's not file-descriptor exhaustion (first attempt fails, not just Nth). **This is a deterministic environmental or invocation-level failure.** Native recovery (`reissue-turn` + `step --resume`) does NOT help — every reissued turn hits the same spawn/attach failure. The path forward MUST start with running the adapter's exact spawn directly and capturing the full stderr/exit-code/signal. Remaining hypothesis probability:
    - Hypothesis 1 (FD exhaustion): **unlikely** — would get worse over attempts, but the tester sees consistent failure from attempt 1
    - Hypothesis 2 (stdout race): **unlikely** — races produce intermittent failures, tester sees deterministic
    - Hypothesis 3 (Claude CLI `-p` mode startup time): **possible** — 30s watchdog might fire before real first-byte
    - Hypothesis 4 (stdin handling / EPIPE): **possible** — deterministic failure mode fits
    - Hypothesis 5 (auth env not propagating to subprocess): **most likely** — explains 0% success, role-general, state-independent, deterministic
  - **STOP DOING CLASSIFICATION WORK.** The 27 post-v2.148.0 commits (`6dbc10cc`, `2ca1d543`, `34b5f358`, `e7da4f6f`, `ab130ebe`, `15cd166d`, `ae057781`, and others) all refine **how failures are reported/classified/timed**. None investigate why Claude CLI subprocesses fail to spawn/attach in the first place. This is the BUG-47→BUG-51 pattern repeating: improving observability while reliability stays broken. **If the next fix is another classification tweak, it will not close BUG-54.**
  - **Root cause hypotheses (INVESTIGATE THESE, do not ship classification fixes instead):**
    1. **Resource leak / file-descriptor exhaustion** — after one spawn failure, something isn't cleaned up, so subsequent spawns fail. Check if the adapter releases stdio file descriptors on subprocess failure. `3f1b74e2 fix(adapter): release stdio on spawn error` claims to address this — but tester evidence shows it didn't solve the problem. Re-audit that fix under tester-sequence conditions.
    2. **Race condition in stdout attachment** — the spawn succeeds but the stdout pipe attachment happens on a different event loop tick and races with process exit / first output. The classic symptom is `stdout_attach_failed` immediately after a successful spawn — which matches the tester's evidence perfectly.
    3. **Claude CLI `-p` mode behavior** — when invoked as `claude -p "..." --output-format stream-json --verbose`, does the CLI need time to authenticate / load config / start before producing output? If yes, the 30-second watchdog may fire during normal startup. Test by running the exact command the adapter spawns (pulled from `ASSIGNMENT.json`) directly in a terminal and timing first-byte-out.
    4. **stdin handling for `prompt_transport: stdin`** — if the prompt is written to stdin but the subprocess exits before reading it all, EPIPE could kill the spawn silently. Does the adapter properly handle the stdin close timing?
    5. **ANTHROPIC_API_KEY or auth-chain issue specific to subprocess environment** — the parent process may have Claude auth in a keychain/keyring that the subprocess can't read. Check if `claude -p` subprocess gets auth via `ANTHROPIC_API_KEY` env var or via the CLI's own keychain (which may not propagate across spawn).
  - **Fix requirements — in this order:**
    1. **DIAGNOSTIC PROOF FIRST.** Before any code fix, reproduce the failure on the agents' own dev box by running the exact spawn the adapter does. Capture: PID, exit code, first-byte-out timestamp, stdout content, stderr content, exit signal. If reproduction fails to reproduce, the bug is environmental — ask the tester to run a diagnostic subprocess capture.
    2. **Publish the reproduction script.** Add `cli/scripts/reproduce-bug-54.mjs` that runs the same spawn the adapter does with full logging. The tester can then run it in their environment and share output. This is the ONLY way to close the root-cause question without guessing. **(✅ Shipped Turn 95, 2026-04-20.** `cli/scripts/reproduce-bug-54.mjs` mirrors the adapter's `resolveCommand` + `spawn` shape exactly — same stdio, env, cwd, prompt transport. Captures per-attempt: PID, spawn_attached/first_stdout/first_stderr timestamps, watchdog_fired flag with elapsed time, exit_code/signal, raw FULL stdout + stderr (no truncation), spawn_error/process_error with code/errno/syscall, and an env_snapshot with PATH/HOME/PWD/SHELL/TMPDIR + boolean-only auth-key presence flags for ANTHROPIC_API_KEY/CLAUDE_API_KEY/CLAUDE_CODE_OAUTH_TOKEN/CLAUDE_CODE_USE_VERTEX/CLAUDE_CODE_USE_BEDROCK. Classifies each attempt into `spawn_attach_failed` / `watchdog_no_output` / `watchdog_stderr_only` / `exit_stderr_only` / `exit_no_output` / `exit_clean_with_stdout` / `exit_nonzero_with_stdout` / `spawn_unattached` / `spawn_error_pre_process`. Five-test classification contract locked in `cli/test/reproduce-bug-54-script.test.js`. **Tester action:** use the installed-package resolver in `.planning/BUG_52_53_54_55_TESTER_UNBLOCK_RUNBOOK.md` / `.planning/BUG_54_REPRO_SCRIPT_TESTER_RUNBOOK.md` (local `npm root` first, global `npm root -g` fallback), then run `node "$REPRO" --attempts 10` (or add `--synthetic "Say READY and nothing else."` to isolate from prompt content) inside the failing worktree (`tusq.dev-21480-clean`) and attach the resulting `bug-54-repro-*.json` to AGENT-TALK or the bug thread. That JSON is the artifact required to discriminate hypotheses 1–5.)
    3. Only AFTER root cause is identified (hypothesis 1, 2, 3, 4, or 5): ship the actual reliability fix. Not a classification tweak. Not a better ghost detector. A fix that makes the spawn succeed.
    4. Add tester-sequence test that dispatches 10 consecutive `local_cli` turns (PM, dev, and QA) and asserts ≥9 complete successfully. Current single-turn tests don't catch this reliability class.
  - **Tester evidence on v2.150.0 (shipped-package dogfood, 2026-04-21 — Turn 137 diagnosis CONFIRMED, fix NOT YET SHIPPED):** Tester ran full-auto on real `tusq.dev` project with v2.150.0. Hit `stdout_attach_failed` on TWO distinct runtimes:
    - **Claude-based `local-pm` (`turn_cb1c94dc04b90c5a`)**: `running_ms: 30285, threshold_ms: 30000` — **exactly 285ms past the 30s watchdog**. This is precisely what Turn 137 diagnosed: the 30s default watchdog is too tight for realistic dispatch bundles. Turn 137 measured a 17,737-byte bundle producing first-stdout at 113,094ms with a 120s watchdog on the agents' dev box. The tester's 30285ms failure on Claude is **independent confirmation** of the Turn 137 diagnosis. **The fix has not shipped in v2.150.0.**
    - **Codex-based `local-product-marketing` (`turn_f5dae06aceb077c5`, reissued `turn_6e1004d805a29cb1`)**: repeated `stdout_attach_failed` / `ghost_turn`. Tester workaround: **rebind product-marketing from Codex to Claude Opus 4.7** (commit `ecdbdcf`), then reissue — `turn_60592eb9651f6728` succeeded. **This is a workaround, not a fix.** It tells us Claude happens to hit first-stdout faster than Codex on this prompt size; it does NOT prove Codex is broken in a different way.
  - **Updated diagnosis (supersedes the original 5 hypotheses):** the root cause is **watchdog threshold, not subprocess auth/spawn behavior.** The keychain-hang hypothesis (BUG-56 false-positive) was disproven by the tester's Claude Max smoke test. The startup-time hypothesis (formerly #3) is now confirmed by independent measurements on two machines. Hypotheses 1/2/4/5 are closed as unlikely.
  - **Agent-side implementation surfaces are complete in `agentxchain@2.154.7` (awaiting tester quote-back):** the startup watchdog default is no longer the old 30s false-kill path (`cli/src/lib/stale-turn-watchdog.js` documents and enforces a 180s default while preserving `run_loop.startup_watchdog_ms` and `runtimes.<id>.startup_watchdog_ms` overrides); realistic-bundle coverage uses the tester-observed `17,737` byte floor across Claude-style bundle-only, Codex-style bundle-only, and Codex-style stdin transports in `cli/test/beta-tester-scenarios/bug-54-realistic-bundle-watchdog.test.js`; the 31s old-threshold regression lives in `cli/test/beta-tester-scenarios/bug-54-watchdog-threshold-default.test.js`; Turn 278 added bounded startup-watchdog SIGTERM -> SIGKILL grace with diagnostic `startup_watchdog_sigkill` and `DEC-BUG54-STARTUP-WATCHDOG-SIGKILL-GRACE-001`; Turn 280 added abort SIGKILL fallback timer cleanup and `DEC-BUG54-ABORT-SIGKILL-TIMER-CLEANUP-001`; docs guard coverage lives in `cli/test/bug-54-startup-watchdog-docs-content.test.js` and website docs under `website-v2/docs/`. BUG-54 remains unchecked only because literal tester quote-back via `.planning/TESTER_QUOTEBACK_ASK_V2.md` has not landed on a published `agentxchain@2.154.7+` session.
  - **Acceptance:** tester runs `tusq.dev` full-auto on v2.151.x or later. Both Claude and Codex `local_cli` runtimes complete 10 consecutive turns without any `stdout_attach_failed` / `ghost_turn` events at the default watchdog threshold. Tester-quoted output required. Previous acceptance (10 consecutive `local_cli` dispatches succeed at >90% rate, not <20%) still stands.
  - **Historical acceptance text (preserved for reference):** tester's clean-retest scenario on vX.Y.Z — 10 consecutive PM/dev/QA `local_cli` dispatches succeed at >90% rate, not <20%.

- [x] **BUG-55: Checkpoint-turn doesn't fully clean the worktree — accepted+checkpointed work leaves dirty actor-owned files + verification side-effects.** ✅ **CLOSED 2026-04-21 with tester-verified shipped-package evidence on v2.150.0.** Tester's dogfood on `tusq.dev` (real project, not synthetic worktree) confirmed: (1) `agentxchain.json` runtime rebind correctly rejected as `undeclared_verification_outputs` — event `evt_c223ff55ee31cb4b`, error class `undeclared_verification_outputs`, turn `turn_60592eb9651f6728`, error text *"Verification was declared, but these files are dirty and not classified: agentxchain.json"*; (2) after separate commit `ecdbdcf Rebind product marketing runtime to Claude`, `agentxchain accept-turn --turn turn_60592eb9651f6728 --checkpoint` succeeded cleanly. Tester quote: *"BUG-55 appears fixed based on both tusq.dev dogfood behavior and targeted regression tests."* Targeted regression: `26 tests / 9 suites / 26 pass / 0 fail / 31.6s`. This is the **first clean tester-verified closure in the BUG-52/53/54/55 cluster.** Original failure detail preserved below — Two distinct sub-defects surfacing as one operational problem:
  - **Sub-defect A: Checkpoint doesn't commit all declared `files_changed`.** Tester's evidence from `run_5fa4a26c3973e02d`: after QA turn `turn_af4fdc071f440a23` accepted + checkpointed at SHA `9d06e5d1...`, these actor-owned files remained dirty: `.planning/RELEASE_NOTES.md`, `.planning/acceptance-matrix.md`, `src/cli.js`, `tests/smoke.mjs`. Had to manually `git commit` with message "checkpoint framework depth implementation and QA evidence" (`13ef927`) before `agentxchain restart` could proceed.
  - **Sub-defect B: Verification side-effects (fixture generation) break acceptance.** Same run, QA acceptance initially failed at `2026-04-20T11:52:24.291Z` because untracked fixture outputs appeared: `tests/fixtures/fastify-sample/.tusq/scan.json`, `tests/fixtures/fastify-sample/tusq.config.json`, `tests/fixtures/nest-sample/.tusq/scan.json`, `tests/fixtures/nest-sample/tusq.config.json`. These were produced by verification commands (e.g., `node tests/smoke.mjs` or tusq scans), not by the QA subprocess directly. BUG-46 hypothesis #4 was supposed to classify these, but coverage is still incomplete.
  - **Fix requirements:**
    1. **Checkpoint-turn must commit the entire declared `files_changed` set.** Audit `turn-checkpoint.js` — either it's silently skipping paths that fail some filter, or the `files_changed` stored in history isn't the full declared set. Verify that `git add <paths>` adds every declared file and fails loudly if any path doesn't exist.
    2. **Extend the `verification.produced_files` classification from BUG-46 to cover actual observed cases.** The agents added the schema field in BUG-46's fix, but apparently aren't requiring or generating the declaration for verification outputs that hit this pattern. Either auto-detect fixture-generating verification commands (e.g., any command that writes to `tests/fixtures/`) and auto-classify their outputs, OR force acceptance to reject turns where verification commands produce untracked files without declaration.
    3. **Tester-sequence test for sub-defect A:** seed a QA turn with `files_changed: ["a.md", "b.js", "c.json"]`, run accept + checkpoint, assert all 3 files are committed (not just some).
    4. **Tester-sequence test for sub-defect B:** seed a QA turn whose verification command produces untracked fixture files, run acceptance, assert either (a) turn is rejected with actionable error naming the undeclared files, OR (b) if `verification.produced_files` declared them, acceptance succeeds cleanly.
  - **Acceptance:** after `accept-turn` + `checkpoint-turn` on a real QA turn, `git status` shows clean tree (no dirty actor-owned files, no undeclared fixture outputs).

- [ ] **BUG-52: Phase-gate resolution doesn't advance phase — `unblock` redispatches same-phase role instead of transitioning** — **FALSE CLOSURE on v2.147.0.** Shipped fix `31e53de2 fix(governed): reconcile phase gates before redispatch` + qa→launch tester-sequence test (`a094eaaa`). Packaged claim-reality proof passed. **Tester reproduced the planning_signoff false-loop on BOTH v2.147.0 runs**, required manual state.json patching each time. The fix works in the synthetic test but not in the real operator flow — classic BUG-36 / BUG-39 / BUG-40 pattern: tests the seam, not the flow.
  - **Tester's evidence (two reproductions):**
    - `run_5fa4a26c3973e02d`: PM turn `turn_addce63aff584689` accepted 11:11:43, checkpointed 11:11:48 at `8b2c86d2...`, `hesc_76f8ace83bfea425` resolved 11:11:54 → new PM turn `turn_2435871a999d9386` dispatched in planning 11:11:54.9 (0.9s after unblock). Phase still planning.
    - `run_4b24e171693ac091`: PM turn `turn_dca9c6c9fe1063eb` accepted 12:35:57, checkpointed 12:36:09 at `a9ffb1e9...`, `hesc_f1ef7f2500523302` resolved 12:36:19 → new PM turn `turn_2a43417238e0f19c` dispatched 12:36:19.6 (0.6s after unblock). Phase still planning.
  - **Required false-closure retrospective:** `.planning/BUG_52_FALSE_CLOSURE.md`. What did `reconcile phase gates before redispatch` actually cover? What specific code path fires during `unblock → resume`? Which path does the tester hit that the test doesn't? The qa→launch tester-sequence test passes but planning→implementation real flow fails — why isn't the test catching this?
  - **New fix requirements:**
    1. **Reproduce the tester's EXACT sequence** — do not rely on seeded fixtures. Run `agentxchain init` + follow the tester's steps: PM dispatch, accept, checkpoint, unblock, observe next dispatch. That reproduction MUST fail on current HEAD before any fix lands.
    2. **The fix must handle the `gate_failed` lane.** Turn 44's diagnosis showed the tester lands in `gate_failed` with `last_gate_failure` populated — not the `pending_phase_transition` lane. Verify the fix actually reaches and handles this specific state.
    3. **Integration test at the command-sequence level**, not just function-call level. Run `accept-turn` → `checkpoint-turn` → `unblock` → `resume` as child processes, and assert the dispatched turn's phase is the NEXT phase, not the current one.
    4. **Consider a simpler model:** instead of "unblock clears escalation, then dispatcher re-evaluates gates," make unblock explicitly advance phase if the gate is now satisfied AND a `phase_transition_request` is pending. This eliminates the race between unblock completing and dispatcher reading stale state.
  - **Acceptance:** tester runs v2.148.0 with their exact command sequence — planning_signoff unblock AND qa_ship_verdict unblock both advance phase without manual state.json surgery. reproduces-on-tester-sequence: NO confirmed via tester-quoted output. Verified code gap. Zero matches in `cli/src/lib/` or `cli/src/commands/unblock*.js` for logic that consults gate status after escalation resolution to trigger phase advancement. `unblock` only clears the escalation; it does not cross-check whether the underlying gate is now satisfied and the run should advance. Result: after `accept-turn` + `checkpoint-turn` + `unblock`, the dispatcher re-runs its normal role-selection logic, sees the current phase is still marked as current, and dispatches the same-phase role again.
  - **Tester's evidence:**
    - PM turn `turn_360905c7f7c8ac1a` checkpointed at `ffb26736...`, `hesc_29db2799c2f4bca6` planning_signoff escalation resolved via `unblock` → system dispatched new PM turn `turn_ecb26fc55ead053d` in planning instead of moving to implementation.
    - Same pattern QA → launch: `turn_1e99db5881d4cad6` checkpointed at `3ba58238...`, `hesc_62f7df0b8b93d623` qa_ship_verdict resolved via `unblock` → system dispatched new QA turn `turn_c3b56a26e34c5e40` instead of launch role.
    - Manual recovery: patch `.agentxchain/state.json` to set next phase + mark gate as `passed` + clear redundant turn → restart → phase finally advances.
  - **Fix requirements:**
    1. After `unblock` resolves a human escalation, if the gate the escalation was tied to is now satisfied by current artifacts AND there's an approved `phase_transition_request` on the most-recent accepted turn, advance the phase atomically. Emit `phase_transitioned` event.
    2. Or: after `checkpoint-turn` completes AND the run is unblocked AND the phase exit gate passes, auto-advance phase even without a new dispatch. This is cleaner because the trigger is the gate pass, not the `unblock` command specifically.
    3. Prevent redundant same-phase redispatch: before `resume` / `step --resume` dispatches a role, check if the current phase's exit gate is now satisfied. If yes, do not dispatch — instead, advance phase and dispatch the next phase's entry role.
    4. Tester-sequence test: accept PM turn with `phase_transition_request: "implementation"` → checkpoint → unblock planning_signoff escalation → assert phase advances to implementation automatically AND next dispatched role is `dev`, not another PM.
  - **Acceptance:** tester's exact scenario on v2.147.0 — complete PM planning turn, checkpoint, unblock signoff escalation, next dispatch is `dev` in `implementation`, not another PM in `planning`. Same for qa → launch.
  - **THIRD VARIANT SURFACED BY TESTER 2026-04-21 ON v2.150.0 (not covered by either existing fix):** Tester's `tusq.dev` full-auto run hit `qa_ship_verdict` AND `launch_ready` gates with ALL evidence present (38/38 ACs pass, ship verdict = SHIP, smoke exit 0, no pending source changes, all required artifacts present). Neither the v2.147.0 fix (`reconcile phase gates before redispatch`) nor `DEC-BUG52-NEEDS-HUMAN-PHASE-ADVANCE-001` covers this failure mode. Symptom: native CLI commands have nothing to operate on:
    - **First occurrence — `qa_ship_verdict`**: QA accepted `turn_b0f37d0554c97960`, escalation `hesc_c2cf1172d66be2c7` raised. `agentxchain unblock hesc_c2cf1172d66be2c7` **resolved the escalation but did not close the gate**. Operator recovery required via manual commit `d2ab914 Approve QA gate and enter launch phase`.
    - **Second occurrence — `launch_ready`**: Launch role accepted `turn_60592eb9651f6728`, escalation `hesc_501d6d1118bcdab9` raised. `agentxchain approve-completion --dry-run` → **"No pending run completion to approve. Current phase: launch, status: blocked"** — the approve-completion command finds nothing to approve because no `pending_run_completion` object exists in state. `agentxchain unblock hesc_501d6d1118bcdab9` → **assigned another turn instead of completing the gate**. Operator recovery required via manual commit `77762c8 Complete AgentXchain launch gate`.
    - **Failure mode (tester's framing):** *"The fix may cover queued/requested transition paths, but it did not cover the tusq.dev full-auto gate path."* Specifically: the `needs_human` gate shape where there is **NO pending phase transition AND NO pending completion object** — just a standing human-approval gate and a resolved-but-unusable escalation.
    - **Cross-reference: relationship to BUG-59 (side-effect prediction RETRACTED 2026-04-21).** BUG-59 (shipped in v2.151.0) coupled `approval_policy` into `reconcilePhaseAdvanceBeforeDispatch()`. When I filed BUG-52 third variant, I predicted BUG-59's fix would resolve it as a side-effect. **That prediction was wrong.** Tester's v2.151.0 evidence (below) confirms the third variant persists under delegated human approval — BUG-59's auto-approval lane is never triggered because the tester's project doesn't configure `approval_policy`. The `unblock`-based manual-approval path bypasses the entire coupling and hits the same state shape: `pending_phase_transition: null` + `phase_gate_status.<gate>: pending`. **BUG-52 third variant requires its own fix, in a different code path than BUG-59 touched.** The defect is in how `unblock`'s escalation-resolution translates into phase-state mutation, not in how `approval_policy` auto-approval is consulted.

  - **AMPLIFIED TESTER EVIDENCE ON v2.151.0 (2026-04-21, run `run_8543d07bd34cc982`, session `cont-02626c54`, baseline `369972f Implement tusq manifest diff command`):** The tester's v2.151.0 re-test reproduced the third variant **seven times in sequence** on `tusq.dev`. Each time: `unblock <hesc>` marked the escalation resolved → instead of advancing phase, AgentXchain reassigned PM to the same `planning_signoff` gate → the new PM turn frequently became a ghost turn → another escalation was raised → operator approved → loop repeated.
    - **Escalations approved + looped back to PM:** `hesc_37d43f0e3908a30b`, `hesc_cccf32a1430eaed5`, `hesc_0e34b2c5c12f6f2b`, `hesc_c5ee0f264325e114`, `hesc_89c97a9477832e35`, `hesc_7143573d66bbf1ea`, `hesc_a0c5bbfb4ad56e61`.
    - **Ghost PM turns observed during the loop:** `turn_719f9e187ae539fc`, `turn_a1e82454ecca3929`, `turn_73e99edc50407733`, `turn_3401760aa1a60052`, `turn_cc4fb94452048b4b`.
    - **Critical inconsistent state captured before manual repair** (verbatim from tester):
      ```json
      {
        "phase": "planning",
        "active_turns": {
          "turn_ca3b761e3ef9b949": {
            "assigned_role": "pm",
            "status": "dispatched"
          }
        },
        "pending_phase_transition": null,
        "phase_gate_status": {
          "planning_signoff": "pending",
          "implementation_complete": "pending",
          "qa_ship_verdict": "pending",
          "launch_ready": "pending"
        }
      }
      ```
    - **Command-surface inconsistency (the same defect visible in two CLI surfaces):** `agentxchain approve-transition --dry-run` returned `"No pending phase transition to approve. Current phase: planning"` while simultaneously `agentxchain gate show planning_signoff` showed `"Human approval: yes, Status: pending"`. Two commands disagree about whether there is something to approve. Either the gate IS pending (then `approve-transition` should handle it) or it isn't (then `gate show` should reflect that). Both cannot be true without breaking user trust.
    - **Injected next-work intent was marked `superseded`:** `intent_1776813936929_0827` (manual injection by operator) was not consumed by the stuck run.
    - **Manual state-repair recipe that DID work** (tester documented verbatim, useful as scaffolding for the fix's reference behavior):
      1. Set `state.phase` from `planning` to `implementation`
      2. Clear stale PM entries from `active_turns`
      3. Set `phase_gate_status.planning_signoff` from `pending` to `passed`
      4. Clear stale budget reservation for the ghost PM turn
      5. Set `next_recommended_role` to `dev`
      6. Update `session.phase` to `implementation`
      7. Clear `session.active_turn_ids`
      8. Clear stale dispatch directory
    - **After manual repair, the system moved forward cleanly** (proves product artifacts were valid and blocker was purely framework state): Dev turn `turn_8634538ce440e926` completed at checkpoint `1fb2cc0` → QA turn `turn_fa8b5ff6bc7e6a4c` at `65d5fde` → Dev repair turn `turn_344bc354dcd5f607` at `e292452` → QA turn `turn_bf08abe27778c3a4` → reached QA phase with `planning_signoff: passed` + `implementation_complete: passed` + `qa_ship_verdict: pending`.
    - Backups of pre-repair state live at `.agentxchain/operator-recovery/state.before-manual-planning-approval.json` and `.agentxchain/operator-recovery/session.before-manual-planning-approval.json` (on tester's machine).

  - **SHARPENED FIX REQUIREMENTS (supersede the original set for the third variant; priority: blocks full-auto lights-out TODAY, higher than BUG-60):**

    1. **Define the invariant precisely.** When `unblock <hesc>` resolves a human escalation tied to a phase-exit gate:
       - The tied gate's `phase_gate_status.<gate>` MUST transition `pending → passed`
       - A phase-transition MUST be materialized (either via `pending_phase_transition` creation + consumption, or via direct phase advance) exactly once
       - `state.phase` MUST advance to the next phase exactly once
       - `active_turns` for the completed role MUST be cleared
       - `next_recommended_role` MUST be set to the entry role of the new phase
       - No duplicate same-phase, same-role turn may be dispatched

    2. **Handle the null-`pending_phase_transition` case explicitly.** The current reconcile path assumes a `pending_phase_transition` object exists. When it's `null` but `phase_gate_status.<gate>` is `pending` AND a human escalation tied to that gate has just resolved, the reconcile path MUST materialize the transition itself. Do not rely on a prior dispatcher run to have created the object — the escalation resolution IS the trigger.

    3. **Fix the `approve-transition` / `gate show` UI inconsistency.** Either:
       - (a) `approve-transition` must detect the "pending gate with no pending transition" state and either materialize+approve OR emit a clear actionable error (e.g., "Gate planning_signoff is pending human approval but no phase transition has been prepared. Run: `agentxchain prepare-transition --to implementation` first, or use `agentxchain unblock <hesc_id>` if there is an open escalation."), OR
       - (b) `gate show` must not report a gate as "Human approval: yes, Status: pending" when no approvable transition exists — it must reflect the true state ("Gate is pending but no transition is prepared").
       - The two surfaces must converge on a consistent truth. The current disagreement IS the bug.

    4. **Clean up stale dispatch state on every phase advance.** When `state.phase` changes:
       - Clear `active_turns` for the prior phase's roles (if their status isn't `accepted` or `completed`)
       - Clear budget reservations for stale turns
       - Clear `session.active_turn_ids` matching the cleared turns
       - Clear any stale dispatch directories at `.agentxchain/dispatch/<turn_id>/`
       - Emit `phase_cleanup` event listing everything cleared, for operator audit

    5. **Positive + negative command-chain regression tests (Rule #13), tester-scenario shape:**
       - **Positive case (7-step tester reproduction):** Seed state with PM turn accepted + `planning_signoff` gate pending + `pending_phase_transition: null` + open `hesc_*` escalation tied to the gate. Run `agentxchain unblock <hesc_id>` as child-process via `execFileSync`. Assert: `state.phase === 'implementation'` AND `phase_gate_status.planning_signoff === 'passed'` AND `active_turns` has no PM entries AND `next_recommended_role === 'dev'` AND subsequent `agentxchain step` dispatches a `dev` turn in `implementation` phase. No manual state edits permitted between steps.
       - **Negative case:** Seed same state but with evidence-missing (e.g., `acceptance-matrix.md` absent). Run `unblock`. Assert: escalation resolves but phase does NOT advance, `status: blocked`, clear operator-facing message explains the missing evidence.
       - Both tests MUST use real CLI invocations (`execFileSync('agentxchain', [...])`), not function-level seams. This is exactly the rule-#12 shape BUG-52's false closure in v2.147.0 violated.

    6. **Two decision records:**
       - `DEC-BUG52-UNBLOCK-ADVANCES-PHASE-001`: `unblock` on a gate-tied escalation is the trigger that advances the phase, not a precondition for a separate dispatcher-driven advance. Any future escalation-resolution path must route through the same advance-on-resolve code.
       - `DEC-BUG52-STATE-CLEANUP-ON-PHASE-ADVANCE-001`: every phase advance emits a `phase_cleanup` event and clears stale `active_turns` / budget / session / dispatch state atomically with the phase change. No prior-phase artifacts may persist.

    7. **Spec + docs updates:**
       - `SPEC-GOVERNED-v5.md` — document the escalation-resolution-advances-phase invariant
       - `website-v2/docs/` — full-auto operation page must describe what `unblock` does end-to-end, how it differs from `approve-transition`, and when to use each
       - Tester runbook — add the 7-step reproduction + the expected (post-fix) clean-flow output

  - **Acceptance (third variant, strengthened by tester v2.151.0 evidence):** tester runs the exact 7-step reproduction on a future shipped version (v2.152.x or later):
    1. PM completes planning and returns `needs_human` for `planning_signoff`
    2. Operator runs `agentxchain unblock <hesc_id>` (or `agentxchain approve-transition`)
    3. `agentxchain status` reports `Phase: implementation`
    4. `agentxchain gate show planning_signoff` reports `Status: passed`
    5. Next turn routes to `dev`
    6. No duplicate PM turn assigned
    7. No ghost PM recovery required

    Tester-quoted CLI output showing steps 1-7 succeed without manual `state.json` editing.

  - **Priority call-out:** BUG-52 third variant is now the **critical-path defect for full-auto lights-out operation**. Seven loops × manual state surgery per tester run = full-auto is unusable today on any project that doesn't configure `approval_policy` with auto-approve rules. Most new users won't configure `approval_policy` on day one. **This should ship before BUG-60 (perpetual continuous mode) because perpetual mode inherits this defect** — a PM idle-expansion that produces a new intent will hit the same manual-unblock trap when its gate fires. Fixing BUG-52 third variant is a precondition for BUG-60 being operationally useful.
  - **Agent-side implementation surfaces are complete in `agentxchain@2.154.7` (awaiting tester quote-back):** Turn 274 shipped command-surface convergence so `unblock` on a gate-tied escalation produces the same phase-advance side effects as the dedicated approve-transition path when `pending_phase_transition` is `null`; Turn 276 added the `phase_reconciled` session checkpoint so `.agentxchain/session.json` no longer carries stale `active_turn_ids` across the repaired transition. The beta command-chain coverage lives in `cli/test/beta-tester-scenarios/bug-52-gate-unblock-phase-advance.test.js`, and the frozen decision is `DEC-BUG52-STATE-CLEANUP-ON-PHASE-ADVANCE-001`. BUG-52 remains unchecked only because literal tester quote-back via `.planning/TESTER_QUOTEBACK_ASK_V1.md` has not landed on a published `agentxchain@2.154.7+` session.
  - **Acceptance (third variant, supersedes if BUG-59 is not the fix vehicle):** tester's exact `tusq.dev` dogfood scenario on a future shipped version — run reaches `qa_ship_verdict` with all evidence present → gate closes without manual `git commit` recovery. Same for `launch_ready`. Tester-quoted output showing the gate closure event with either `auto_approved_by_policy` or a working `approve-completion` / `unblock` path.

- [ ] **BUG-53: Continuous session doesn't auto-chain after run completion — pauses instead of deriving next vision objective** — Verified code gap. `cli/src/lib/continuous-run.js:600` increments `session.runs_completed` and logs "Run X/Y completed" but does NOT unconditionally loop back to vision scan. The session transitions to `paused` or exits instead of re-entering the vision-candidate-derivation path. Tester's evidence: session `cont-5d436a8f` ended up paused after `run_78133e963b912f46` completed cleanly (all 4 gates passed, final checkpoint `32a38b0a3bbd5e1e6ce82d7271ee45e4b6e5a44b`), no new `vision_scan` run created, no next objective derived.
  - **Fix requirements:**
    1. After `session.runs_completed += 1`, the continuous loop must:
       - Check against `contOpts.maxRuns` — if reached, exit cleanly with status `completed`
       - If not reached, call `deriveVisionCandidates()` again to find the next unaddressed vision goal
       - If a candidate exists, seed a new intent via the standard `intake record → triage → approve` pipeline and start the next run
       - If no candidate exists (all vision goals addressed), exit with status `idle_exit` (clean termination, NOT paused)
    2. `paused` status should only be used for real blockers (`needs_human`, `blocked`), never for "I finished a run and didn't know what to do next."
    3. Cold-start vs warm-completion parity: the same vision-scan code path that runs at session startup must run at post-completion. Extract into a shared helper to prevent divergence.
    4. Emit `session_continuation` event with payload `{previous_run_id, next_objective, next_run_id}` so the operator has a clear audit trail of the auto-chain.
    5. Tester-sequence test: start continuous session with `--max-runs 3`, complete first run (mock or real), assert session immediately seeds next intent from vision candidates, starts run 2, does NOT pause. Repeat through 3 runs, then assert clean exit at max_runs.
  - **Acceptance:** tester's exact scenario on v2.147.0 — `run --continuous --max-runs 5` where first run completes, second run is automatically created from the next vision candidate without any operator intervention. Session status stays `running`, never `paused`, until either max_runs is hit or no vision candidates remain.
  - **Partial validation on v2.150.0 (2026-04-21):** Tester ran `npx --yes -p agentxchain@latest -c 'agentxchain run --continuous --vision .planning/VISION.md --max-runs 1 --max-idle-cycles 3 --poll-seconds 5 --triage-approval auto --auto-checkpoint --no-report'` on `tusq.dev`. Result: `Status: completed, Runs: 0/1, Idle cycles: 3/3` — session cleanly idle-exited after 3 consecutive "no derivable work from vision" cycles, did NOT hang in `paused`. **This validates the clean idle-exit case** (previously paused incorrectly). Tester quote: *"Continuous mode exited cleanly when no derivable work remained, but tusq.dev did not exercise a real multi-run auto-chain after that."*
  - **What is still NOT proven:** the chain-to-next-run case. Tester ran with `--max-runs 1` and got 0 runs (no derivable work existed), so the actual "after run N completes, does run N+1 start?" behavior remains unverified on shipped package. A `--max-runs 1` session that completes 0 runs is not the same as a `--max-runs 3+` session that completes run 1 and chains into run 2.
  - **Sharpened acceptance (supersedes the original for closure purposes):** tester runs `--continuous --max-runs 3` or higher on a project where vision has at least 2 derivable candidates. Run 1 completes, **run 2 automatically starts from the next vision candidate** (no human intervention, session status never enters `paused`), run 3 exits cleanly either by hitting max_runs or by running out of candidates. Tester-quoted output required showing the `session_continuation` event between run 1 and run 2 with `{previous_run_id, next_objective, next_run_id}` payload.

### Implementation notes for BUG-52/53/54/55

- **The cycle has a new false closure.** BUG-52's fix was the first proved-via-packaged-claim-reality-preflight closure to still fail on tester reproduction. That means rule #9 (packaged preflight) is necessary but not sufficient — the test itself needs to use the tester's exact command sequence, not just the right code paths. **Rule #12 has now been added** to the Active Discipline section below: command-chain integration tests are mandatory for any CLI workflow bug.
- **Ordering (v2.148.0):**
  1. **BUG-54 first** — QA runtime reliability is blocking every QA turn. Without QA completing, nothing else reaches launch. This is the operator's biggest pain point.
  2. **BUG-52** — false-closure retrospective + real-flow fix. Can proceed in parallel with BUG-54.
  3. **BUG-55** — checkpoint completeness + verification side-effects. Smaller scope, can ship with either.
  4. **BUG-53** stays open awaiting explicit tester evidence of the session-pause pattern. The tester had two runs in this retest, so auto-chain MAY be working.
- **BUG-52 needs a different shape of test this time.** Not a function-call seam test — a child-process command-chain test. Spawn `agentxchain accept-turn` then `checkpoint-turn` then `unblock` then `resume` as separate CLI invocations against a real governed state, and assert the final dispatched turn's phase is the next phase. That's the only shape of test that would have caught this.
- **Coverage matrix update:** `BUG_31_33_COVERAGE_GAP_POSTMORTEM.md` needs (a) command-chain integration tests as a first-class category (separate from function-call tests and packaged preflight), (b) a "repeated-dispatch reliability" column for spawn-path defects (BUG-54 class), (c) a "checkpoint completeness" row (BUG-55 sub-A), (d) an "undeclared verification outputs" row (BUG-55 sub-B).
- **Do NOT broadcast publicly.** Release notes: matter-of-fact. No acknowledgment of BUG-52's false closure.

---

## Active discipline (MUST follow on every fix going forward)

Established across the 2026-04-18/20 beta cycle after 8 false closures (BUG-17/19/20/21, BUG-36, BUG-39, BUG-40, BUG-41, BUG-52). All 12 rules remain in force:

1. **No bug closes without live end-to-end repro.** Unit tests + "code path covered" is not sufficient.
2. **Every previously-closed beta bug is a permanent regression test** in `cli/test/beta-tester-scenarios/`. CI runs on every release; single failure blocks release.
3. **Release notes describe exactly what shipped** — no overclaiming, no "partial fix" marketing.
4. **Internal `false_closure` retrospectives live in `.planning/`**, never on website.
5. **Do NOT broadcast limitations publicly.** Make the product do what we say, quietly.
6. **Every bug close must include:** tester-sequence test file (committed before fix), test output showing PASS on fresh install, CLI version + commit SHA, closure line "reproduces-on-tester-sequence: NO".
7. **Slow down.** 3 days to close correctly beats 1 day that reopens.
8. **Use REAL emission formats** in tester-sequence tests — no synthetic strings.
9. **"Claim-reality" gate in release preflight** — tester-sequence tests run against shipped CLI binary, not source tree. Now mechanically enforced via `test(claim-reality): packaged behavioral proof` commits.
10. **Startup-path coverage matrix** in `BUG_31_33_COVERAGE_GAP_POSTMORTEM.md` — every dispatch code path × every lifecycle stage has tester-sequence test.
11. **Tester-sequence tests must seed realistic accumulated state**, not just clean fixtures. `createLegacyRepoFixture()` helper.

12. **Command-chain integration tests are mandatory for any CLI workflow bug** (added 2026-04-20 after BUG-52's false closure, the 8th of the cycle). Function-call tests that exercise an internal seam are NOT sufficient for bugs where the operator's reproduction is a chain of CLI commands (`accept-turn` → `checkpoint-turn` → `unblock` → `resume`, etc.). The tester-sequence test MUST spawn each step as a separate child-process CLI invocation against a governed state, and assert the observed behavior after the full chain — not just assert that a function returns the right value. BUG-52 shipped with a unit-style test + packaged claim-reality preflight that both passed, but the tester's CLI-chain reproduction still failed because the test didn't exercise the invocation sequence the operator runs. Every tester-sequence test file in `cli/test/beta-tester-scenarios/` must have at least one assertion that uses `execFileSync('agentxchain', [...])` (or equivalent child-process spawn) to mirror the operator's real command chain. Rule 9 (packaged preflight) + rule 12 (command-chain integration) together form the full "ship only what the operator actually gets" contract.

13. **No preflight gate ships without a positive-case regression test that proves the gate passes for at least one real valid configuration** (added 2026-04-21 after BUG-56, the 9th false closure of the cycle). A test that only asserts the gate's failure output for the failure-case input is green in CI but says nothing about whether emitting that failure is the correct behavior. For gates that make predictive claims about subprocess behavior ("this will hang," "this will fail to authenticate," "this will exhaust file descriptors"), the positive-case test must exercise a real or shim subprocess that demonstrates the predicted failure does NOT occur for the supported-configuration input, and the negative-case test must exercise a shim that demonstrates the predicted failure DOES occur for the failure-case input. BUG-56 shipped an `auth_preflight` gate whose static shape-check ("no env auth + no `--bare` = hang risk") was false for every Claude Max user with keychain-based OAuth. Two release cycles (v2.149.0 warning-ordering fix, v2.149.1 hotfix for the same warning ordering) standardized the defective contract across four call-sites without anyone ever running `printf '...' | claude --print` to reality-check the gate's prediction. This is Rule #12's seam-vs-flow failure generalized from CLI command chains to preflight predictive claims. Closure for BUG-56 requires both a positive-case shim test (working Claude subprocess, gate must pass) and a negative-case shim test (hanging Claude subprocess, gate must fail) — committed to `cli/test/beta-tester-scenarios/` before the replacement gate lands.

*(Historical note: the original rule 12 — "no bug closes without the beta tester's verified output" — was removed 2026-04-20. Tester verification remains valuable evidence but is no longer a hard blocker on closure. Rules 1, 2, 6, 9, 12 and 13 above still gate closure via tests and packaged proof.)*

---

## Recent closures (see `HUMAN-ROADMAP-ARCHIVE.md` for full detail)

### Beta cycle 2026-04-20 — closed
- ✅ **BUG-47, BUG-48, BUG-49, BUG-50, BUG-51** — stale-turn watchdog + intent lifecycle + checkpoint ref update + run-history contamination + fast-startup watchdog. All 5 tester-verified on v2.146.0. Second triple-or-more close of the cycle.
- Release: v2.145.0 (BUG-47..50), v2.146.0 (BUG-51 + hardening)

### Earlier 2026-04-18/19 clusters (details in archive)
- ✅ **BUG-44/45/46** — phase-scoped intent retirement, retained-turn reconciliation, post-acceptance deadlock resolved (tester-verified on v2.144.0)
- ✅ **BUG-42/43** — phantom intent detection, checkpoint ephemeral path filtering (first non-false closure after 7 false ones)
- ✅ **BUG-31..41** — iterative planning, intake integration, state reconciliation, full-auto checkpoint handoff, false-closure fixes
- ✅ **BUG-1..30** — acceptance/validation, drift recovery, intake integration, etc.
- ✅ **B-1..B-11** — CLI version safety, runtime matrix, authority model, Codex recipes, etc.
- ✅ **Framework capabilities** — full-auto vision-driven operation, human priority injection, last-resort escalation, live 3-run proof
- ✅ **DOC-1** — website sidebar Examples → Products/Proofs split

---

## Completion Log

- **2026-04-21**: BUG-55 closed with tester-verified shipped-package evidence on v2.150.0 (tester dogfood on real `tusq.dev` project, event `evt_c223ff55ee31cb4b`, 26/26 targeted regression tests green). First clean closure in the BUG-52/53/54/55 cluster. Tester report on the same day: BUG-52 still open (new third variant surfaced — standing human-approval gate with no pending object, `approve-completion` finds nothing to approve), BUG-53 partially validated (clean idle-exit works; multi-run chain unverified), BUG-54 still open (Turn 137 watchdog-threshold diagnosis confirmed by tester evidence on both Claude and Codex, fix not shipped in v2.150.0). BUG-59 filed as the architectural substrate for BUG-52's third variant (full-auto mode doesn't actually change gate-approval behavior because `approval_policy` is disconnected from `requires_human_approval` at `gate-evaluator.js:290-295`).
- **2026-04-20**: BUG-47/48/49/50/51 closed with tester-verified output on v2.146.0. Second triple-or-more close of the cycle. Claude Opus 4.7 + GPT 5.4 with high-effort config active. BUG-52 and BUG-53 opened from tester report #18 — last two full-auto blockers.
- **2026-04-19**: BUG-44/45/46 closed with tester-verified output on v2.144.0. First non-false closure after 7 false ones.
- **2026-04-18**: 64-item beta-tester bug cluster closed through v2.138.0. Discipline rules 1–12 now in force. Internal postmortems: `BUG_31_33_COVERAGE_GAP_POSTMORTEM.md`, `BUG_36_FALSE_CLOSURE.md`, `BUG_39_FALSE_CLOSURE.md`, `BUG_40_FALSE_CLOSURE.md`.
- **2026-04-17**: Framework full-auto vision-driven operation shipped with 3-run live proof.
- **2026-04-03**: Original 7 priority queue items completed. Docusaurus migration, vision alignment, v2.2.0 release-ready.
