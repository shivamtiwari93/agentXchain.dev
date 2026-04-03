# Human Tasks — AgentXchain

Tasks that require human action. Organized by priority.

Current state: **npm publish authorization is the sole release blocker.** Both token-based and OIDC trusted publishing paths have been attempted and failed. The workflow, tests, preflight, and postflight are all correct. Only npm-side authorization is blocking the v2.0.1 corrective release.

---

## P0 — npm Publish Authorization

- [~] Fix npm publish authorization for v2.0.1 (Priority: P0) — Status: **blocked on human action**. Two auth paths have been tried:
  - **Token-based**: `NPM_TOKEN` is expired/invalid (`401 Unauthorized` locally and in CI run `23934512338`)
  - **OIDC trusted publishing**: returns `ENEEDAUTH` (CI run `23935427391`) — npm-side publisher authorization may not be configured for the package

  **Human must do ONE of:**
  1. Regenerate `NPM_TOKEN` on npmjs.com → update in both `.env` and GitHub Actions secrets (`Settings → Secrets → Actions → NPM_TOKEN`)
  2. OR configure npm trusted publishing for the `agentxchain` package to accept OIDC tokens from `shivamtiwari93/agentXchain.dev` repository

  **After fixing, agents retrigger with:**
  ```bash
  gh workflow run publish-npm-on-tag.yml --repo shivamtiwari93/agentXchain.dev --ref release/v2.0.1 -f tag=v2.0.1
  ```

  The workflow now runs `publish-from-tag.sh` → `release-postflight.sh` in sequence. after npm postflight passes, agents complete: GitHub release, Homebrew tap update, merge release/v2.0.1 → main.

---

## P1 — Post-Publish Follow-Through (Agent-Owned)

These become actionable immediately after v2.0.1 publishes:

- [~] Update Homebrew tap formula to published `agentxchain@2.0.1` tarball (Priority: P1) — Delegated to agents. Blocked on P0.
- [~] Create GitHub release for v2.0.1 with release notes (Priority: P1) — Draft ready. Blocked on P0.
- [~] Merge `release/v2.0.1` → `main` per `MERGE_PLAN_V201.md` (Priority: P1) — Plan documented. Blocked on P0.
- [~] Cut v2.1.0 from main after merge-back (Priority: P1) — All 3 features implemented and tested on main. Blocked on v2.0.1 merge-back.

---

## Completed

- [x] Prepare release workspace and bump version — Done. v2.0.0 tag pushed, v2.0.1 corrective tag on release branch.
- [x] Set `ANTHROPIC_API_KEY` environment variable — Configured in `.env`.
- [x] Verify `claude` CLI installed and authenticated — Verified.
- [x] Run full Scenario A dogfood with live LLM — Closed by agent concurrence (DEC-LIVE-001).
- [x] Decide npm package scope/name — Continuing with unscoped `agentxchain`.
- [x] Enable GitHub Actions and configure branch protection — Complete.
- [x] Review SPEC-GOVERNED-v4.md — Approved with minor corrections.
- [x] Review accepted_integration_ref semantics — Closed by agent concurrence (DEC-INTREF-002).
- [x] Decide approve-transition/approve-completion strictness — Closed by agent concurrence (DEC-APPROVAL-001).
- [x] Set up Homebrew tap — Created at `shivamtiwari93/homebrew-agentxchain`.
- [x] Add Twitter/X API credentials to `.env` — Completed by human. All keys present: `TWITTER_API_KEY`, `TWITTER_API_SECRET`, `TWITTER_ACCESS_TOKEN`, `TWITTER_ACCESS_TOKEN_SECRET`, `TWITTER_BEARER_TOKEN`.
- [x] Configure GitHub Pages — Enabled via API (Turn 9). Workflow at `.github/workflows/deploy-pages.yml` deploys `website/` on push to main.
