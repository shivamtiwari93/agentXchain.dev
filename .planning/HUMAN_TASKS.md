# Human Tasks — AgentXchain

Tasks that require human action. Organized by priority.

Current state: **No release blockers.** Local npm auth uses the GitHub Actions trusted-publishing workflow. Social posting to X and Reddit is now automated via browser tools. One manual marketing task remains: HN launch post.

---

## Open

- [x] **Add `HOMEBREW_TAP_TOKEN` repo secret** — Done. Fine-grained PAT created and set via `gh secret set HOMEBREW_TAP_TOKEN --repo shivamtiwari93/agentXchain.dev` on 2026-04-08.
- [x] **Upgrade Twitter/X app to Read+Write permissions** — Done. App permissions changed to Read+Write via User Authentication Settings on 2026-04-08. Access Token regenerated with new scope. OAuth 2.0 client credentials (Client ID + Secret) also added to `.env`.
- [ ] **Post the prepared launch copy to HN (auth-gated operator task)** — Use `.planning/MARKETING/HN_SUBMISSION.md` with submission URL `https://agentxchain.dev/launch`. Why human-only: no HN credentials exist in the repo; HN submission requires an authenticated browser session.
- [ ] **Create VS Code Marketplace publisher and add `VSCE_PAT` secret** — The extension is fully packaged and CI-ready (`publish-vscode-on-tag.yml`), but the publisher `agentxchain` does not exist on the Marketplace (verified 2026-04-10, HTTP 404). Steps: (1) Create Azure DevOps org at https://dev.azure.com/ if not exists, (2) Create publisher `agentxchain` at https://marketplace.visualstudio.com/manage/publishers, (3) Generate PAT with `Marketplace > Manage` scope, (4) Run `gh secret set VSCE_PAT --repo shivamtiwari93/agentXchain.dev`. After this, agents can publish by pushing a `vsce-v0.1.0` tag.

## Agent Social Posting Instruction

Agents can and should post to X/Twitter and Reddit directly. **Do not add human tasks for social posting.**

- **X/Twitter**: run `bash marketing/post-twitter.sh "tweet text"` — uses x-browser (browser automation via Playwright + CDP, no API keys needed). The Chrome profile at `~/.config/x-browser/chrome-data/` has an active @agentXchain_dev session.
- **Reddit r/agentXchain_dev**: run `bash marketing/post-reddit.sh "title" "body"` — uses r-browser (browser automation via Playwright + CDP, no API keys needed). The Chrome profile at `~/.config/r-browser/chrome-data/` has an active u/agentXchain_dev session. **Note:** Reddit may show CAPTCHA for low-karma accounts. If the post fails silently, log it in AGENT-TALK.md and move on.
- **Both channels at once**: run `bash marketing/post-release.sh "vX.Y.Z" "one-line summary"`.
- See WAYS-OF-WORKING.md section 8 for the full social posting policy (when to post, what to post, rules).
- **HN is the only social channel that still requires human action** (no credentials, no API).

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
- [x] Configure GitHub Pages — Historical task completed in Turn 9, later retired on 2026-04-08 when GCS became the only repo-owned website deploy path and the dead mirror workflow was removed.
- [x] Restore npm release chain beyond the v2.0.1 blocker — Superseded by successful `agentxchain@2.2.0` publish, GitHub release creation, Homebrew tap update, and postflight verification on 2026-04-03.
- [x] Canonical domain deployment for `agentxchain.dev` — Completed. `https://agentxchain.dev/docs/protocol-implementor-guide/` returns `200` with live Docusaurus content and GCS cache headers on 2026-04-03.
