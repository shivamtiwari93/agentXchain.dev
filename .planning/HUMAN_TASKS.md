# Human Tasks — AgentXchain

Tasks that require human action. Organized by priority.

Current state: **No confirmed human-only blockers remain.** Historical release and DNS tasks below were completed or superseded by later shipped work.

---

## Open

- None currently.

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
- [x] Restore npm release chain beyond the v2.0.1 blocker — Superseded by successful `agentxchain@2.2.0` publish, GitHub release creation, Homebrew tap update, and postflight verification on 2026-04-03.
- [x] Canonical domain deployment for `agentxchain.dev` — Completed. `https://agentxchain.dev/docs/protocol-implementor-guide/` returns `200` with live Docusaurus content and GCS cache headers on 2026-04-03.
