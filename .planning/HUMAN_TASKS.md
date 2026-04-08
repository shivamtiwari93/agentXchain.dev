# Human Tasks — AgentXchain

Tasks that require human action. Organized by priority.

Current state: **Local npm auth is broken** (`npm whoami` returns 401 with the repo `.env` token). This is not a release blocker because the canonical publish path is the GitHub Actions trusted-publishing workflow (`publish-npm-on-tag.yml`), which works. One human-auth-gated marketing task remains: post the prepared HN/Reddit launch copy.

---

## Open

- [x] **Add `HOMEBREW_TAP_TOKEN` repo secret** — Done. Fine-grained PAT created and set via `gh secret set HOMEBREW_TAP_TOKEN --repo shivamtiwari93/agentXchain.dev` on 2026-04-08.
- [x] **Upgrade Twitter/X app to Read+Write permissions** — Done. App permissions changed to Read+Write via User Authentication Settings on 2026-04-08. Access Token regenerated with new scope. OAuth 2.0 client credentials (Client ID + Secret) also added to `.env`.
- [ ] **Post the prepared v2.24.3 launch copy to HN and Reddit (auth-gated operator task)** — Use the exact prepared assets:
  - HN: `.planning/MARKETING/HN_SUBMISSION.md` with submission URL `https://agentxchain.dev/launch`
  - Reddit: `.planning/MARKETING/REDDIT_POSTS.md` for `r/programming`, `r/artificial`, `r/LocalLLaMA`, and `r/ChatGPT`
  - Why human-only: no Hacker News or Reddit credentials/session cookies exist in the repo or `.env`, and those submission flows require authenticated browser sessions
  - Post only after confirming `https://agentxchain.dev/launch` is live (verified on 2026-04-08 after commit `2e7843e`)

## Agent Release Instruction

- Use the GitHub Actions trusted-publishing workflow for npm releases by default.
- Preferred sequence:
  - make sure release-blocking tests and preflight are green
  - bump the version
  - create and push the tag
  - let `.github/workflows/publish-npm-on-tag.yml` publish via trusted publishing
  - verify the npm version is live
  - update the Homebrew tap only after npm is live
- Do not treat local `NPM_TOKEN` renewal as a default human blocker if the GitHub Actions trusted-publishing path is available and functioning.
- Only add a human task for npm auth if the trusted-publishing workflow itself is broken and the package owner must change npm-side settings.

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
- [x] Set up Homebrew tap — Created at `shivamtiwari93/homebrew-tap` (renamed from `homebrew-agentxchain`).
- [x] Add Twitter/X API credentials to `.env` — Completed by human. All keys present: `TWITTER_API_KEY`, `TWITTER_API_SECRET`, `TWITTER_ACCESS_TOKEN`, `TWITTER_ACCESS_TOKEN_SECRET`, `TWITTER_BEARER_TOKEN`.
- [x] Configure GitHub Pages — Enabled via API (Turn 9). Workflow at `.github/workflows/deploy-pages.yml` builds and deploys `website-v2/build/` on pushes to `main` that change `website-v2/**`, with `workflow_dispatch` available for manual reruns.
- [x] Restore npm release chain beyond the v2.0.1 blocker — Superseded by successful `agentxchain@2.2.0` publish, GitHub release creation, Homebrew tap update, and postflight verification on 2026-04-03.
- [x] Canonical domain deployment for `agentxchain.dev` — Completed. `https://agentxchain.dev/docs/protocol-implementor-guide/` returns `200` with live Docusaurus content and GCS cache headers on 2026-04-03.
