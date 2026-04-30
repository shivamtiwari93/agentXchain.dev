# Human Tasks — AgentXchain

Tasks that require human action. Organized by priority.

Current state: **DOGFOOD-100 is paused on an operator-only Anthropic credential refresh.** npm publishes via GitHub Actions trusted publishing. Social posting remains agent-run via browser tools. VS Code Marketplace publisher is set up and ready for first publish. HN launch deferred indefinitely.

---

## Open

- [ ] **Refresh Claude/Anthropic credentials for DOGFOOD-100** — As of 2026-04-30, `agentxchain@2.155.70` closed BUG-114 by auto-reissuing retained Tusq QA auth blocker `turn_aa521bedd41f1655 -> turn_c79ca73263c02085` without operator `step --resume`, but the fresh Claude subprocess still failed provider authentication. Dispatch evidence reported `apiKeySource: "ANTHROPIC_API_KEY"` and Anthropic 401, and direct compatible-runtime `claude --print` smoke checks with the loaded AgentXchain `.env` also returned Anthropic 401. GPT 5.5 repeatedly rechecked the blocker between 2026-04-30T03:20Z and 2026-04-30T06:52Z using manual compatible-runtime checks, the local repo helper, the published `agentxchain@2.155.71` tarball, and the public shipped `agentxchain@2.155.72` bin; every valid credential check returned `classification:"anthropic_auth_failed"` or equivalent Anthropic 401 with `ANTHROPIC_API_KEY` and `CLAUDE_CODE_OAUTH_TOKEN` present. Full historical detail is preserved in `AGENT-TALK.md` Turns 82-108 and the compressed Turns 89-106 block.

  Latest recheck: GPT 5.5 re-ran the public shipped `agentxchain@2.155.72` bin at 2026-04-30T09:11Z:
  `npx --yes -p agentxchain@latest -c 'agentxchain-dogfood-claude-smoke --credential-env-file "/Users/shivamtiwari.highlevel/VS Code/1008apps/agentXchain.ai/agentXchain.dev/.env" --cwd "/Users/shivamtiwari.highlevel/VS Code/1008apps/tusq.cloud/tusq.dev" --json'`.
  Result remained `classification:"anthropic_auth_failed"` with `ANTHROPIC_API_KEY:true`, `CLAUDE_CODE_OAUTH_TOKEN:true`, Node `/opt/homebrew/Cellar/node@20/20.20.2/bin/node` (`v20.20.2`), Claude `/opt/homebrew/bin/claude`, wrapper `claude_compatible_node`, process exit code 3, Claude exit code 1, stdout Anthropic 401 `authentication_error` / `Invalid authentication credentials` with request `req_011CaZhM1wuctncuz3rvmVGv`, stderr empty. Read-only Tusq sanity check still showed strict session `cont-7dc5b5df` paused on run `run_73ffb608f7c8a510`, `runs_completed:24`, phase `qa`, `blocked_on:"dispatch:claude_auth_failed"`, active QA turn `turn_c79ca73263c02085`, and counter tail `97 / 100` on `turn_f2827707dfc5e04a`. Tusq remains paused by instruction; agents must not resume, edit state, or run recovery commands until this same shipped helper returns `classification:"success"`. Human must rotate or replace the Anthropic/Claude credential in the local environment. After the shipped-package helper returns `classification:"success"`, agents should resume the same Tusq session `cont-7dc5b5df` on shipped `agentxchain@2.155.72+`; the human should not edit `.agentxchain` state, staging JSON, or run operator recovery commands.

- [ ] **X/Twitter account posting restriction** — As of 2026-04-17, the `@agentxchaindev` account cannot post tweets. Clicking the Post button on the compose page returns: "Something went wrong, but don't fret — let's give it another shot" and "Your account may not be allowed to perform this action. Please refresh the page and try again." Screenshot evidence: `/tmp/x-compose-after-click.png`. The account can read timelines fine. This is an account-level restriction (possibly verification, rate limit, or new-account probation). Human must: (1) log into X at https://x.com/settings/account and check for any account restrictions or verification requirements, (2) resolve whatever X requires to restore posting ability, (3) test with `bash marketing/post-twitter.sh "test"` to confirm posting works.

- [x] **Add `HOMEBREW_TAP_TOKEN` repo secret** — Done. Fine-grained PAT created and set via `gh secret set HOMEBREW_TAP_TOKEN --repo shivamtiwari93/agentXchain.dev` on 2026-04-08.
- [x] **Upgrade Twitter/X app to Read+Write permissions** — Done. App permissions changed to Read+Write via User Authentication Settings on 2026-04-08. Access Token regenerated with new scope. OAuth 2.0 client credentials (Client ID + Secret) also added to `.env`.
- [x] **Post the prepared launch copy to HN (auth-gated operator task)** — **Deferred indefinitely (2026-04-12).** Decision: not posting to HN at this time. Will revisit in the future. Launch copy remains in `.planning/MARKETING/HN_SUBMISSION.md` if needed later.
- [x] **Create VS Code Marketplace publisher and add `VSCE_PAT` secret** — Done (2026-04-12). Publisher `agentXchain.dev` (ID `agentXchaindev`) created on VS Code Marketplace. `VSCE_PAT` secret added to GitHub repo. Agents can now publish by pushing a `vsce-v0.1.0` tag — CI workflow `publish-vscode-on-tag.yml` handles the rest.

## Agent Social Posting Instruction

Agents can and should post to X/Twitter, LinkedIn, and Reddit directly. **Do not add human tasks for social posting.**

- **X/Twitter (@agentxchaindev)**: run `bash marketing/post-twitter.sh "tweet text"` — uses x-browser. Default mode is `--system-profile`; if Chrome is already running, close it first or rerun with `AGENTXCHAIN_X_USE_SYSTEM_PROFILE=0` after logging into the isolated `x-browser` profile once.
- **LinkedIn (company page)**: run `bash marketing/post-linkedin.sh "post text"` — uses li-browser (browser automation via Playwright + CDP, no API keys needed). Posts to the AgentXchain company page (ID `112883208`) using the isolated `li-browser` profile by default; set `AGENTXCHAIN_LINKEDIN_USE_SYSTEM_PROFILE=1` only if you explicitly need the live system Chrome profile. The wrapper verifies ambiguous composer-open outcomes against the company admin feed before failing and only retries on non-ambiguous errors.
- **Reddit r/agentXchain_dev**: run `bash marketing/post-reddit.sh "title" "body"` — uses r-browser (browser automation via Playwright + CDP, no API keys needed). Uses new Reddit (www.reddit.com) which handles CAPTCHA automatically.
- **All three channels at once**: run `bash marketing/post-release.sh "vX.Y.Z" "one-line summary"`.
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

- [x] **Remove the stale LinkedIn re-auth human task diagnosis** — completed 2026-04-15: `li-browser me notifications` from the isolated profile still returns authenticated results, so blanket re-auth was not proven. The repo wrappers now verify ambiguous LinkedIn submit states and only fallback profiles on non-ambiguous failures instead of escalating prematurely.

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
