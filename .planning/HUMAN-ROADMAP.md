# Human Roadmap — AgentXchain

Human-prioritized work for the agents.

Rules:
- Agents should read this file before acting.
- Unchecked items here take priority over general exploration in `AGENT-TALK.md`.
- When an item is complete, agents should mark it complete and briefly record what changed.
- If an item is too large, agents should split it into smaller checklist items and work them down in order.
- Only move an item back to `HUMAN_TASKS.md` if it truly requires operator-only action.

Current focus: website/docs/product-surface correction

## Priority Queue

- [x] Reopen website live-site issues from real browser evidence
  - **Root causes found and fixed:**
    - Favicon was 32x27 (non-square) → regenerated from 280x280 source as proper 32x32 ICO + 32x32 PNG. Added `headTags` to Docusaurus config for PNG favicon.
    - Hero icon/badge alignment was fragile (relied on `text-align: center` on parent) → hero container now uses `display: flex; flex-direction: column; align-items: center`. Logo has explicit `display: block` via `.hero-logo` class. Badge uses `align-self: center`.
    - Hero messaging was generic → rewritten to lead with "Your AI agents are smart enough. The problem is coordination." — directly addresses the target audience.
  - **Verification methodology:**
    - Confirmed local build md5 matches GCS-served content (23830 bytes, hash `d474210743177cb6e8d199bdeed97c79` — prior deploy was identical)
    - Confirmed GCS `Cache-Control: public, max-age=300, s-maxage=60` means browser cache expires in 5min, CDN in 1min
    - After fix: rebuilt, redeployed via `deploy-websites.sh`, verified live `curl` returns new favicon (4414 bytes, updated 11:58:23 GMT), new PNG favicon (2142 bytes), new hero classes (`hero-logo`, `hero-content`), and new copy ("Your AI agents are smart enough")
  - **Test surface:** 1045 tests / 238 suites / 0 failures. Docusaurus: 11 pages, 0 warnings. `DEC-WEBSITE-FIX-001`.

- [x] Migrate website docs to a better OSS framework
  - Evaluated Docmost (wrong category: wiki/CMS, needs DB+server), Starlight (less mature), and Docusaurus. Chose Docusaurus: static output, MDX, versioning, dark mode, React ecosystem. `DEC-DOCS-MIGRATION-001`.
  - All 11 content pages migrated to `website-v2/`. Old `website/` preserved.

- [x] Update the website to match the current product vision
  - Hero: "Governed multi-agent software delivery" + "Built for long-horizon coding and lights-out software factories"
  - Architecture section: "Protocol + runners + connectors + integrations"
  - Platform split: explicit .dev (OSS) vs .ai (Cloud)
  - VISION.md updated with long-horizon coding and lights-out software factories (`DEC-VISION-CONTENT-002`)

- [x] Fix broken website assets in production
  - Image paths now use Docusaurus `useBaseUrl()` instead of hardcoded absolute paths.
  - Favicon, hero logo, and hero badge verified in build output and deployed to GCS.
  - Badge updated to v2.2.0.

- [x] Remove weak or low-signal homepage proof
  - Replaced "1,038 Tests passing" with "53 Conformance fixtures" per human instruction. `DEC-WEBSITE-CONTENT-002`.

- [x] Simplify the `.dev` / `.ai` section on the homepage
  - Collapsed from two-column feature-list layout to single centered CTA: "Don't want to self-host?" with link to agentxchain.ai. `DEC-WEBSITE-CONTENT-003`.

- [x] Fix the positioning table formatting
  - Replaced all inline styles with CSS classes (`comparison-table-wrap`, `comparison-table`, `highlight-col`, `row-label`).
  - Added hover states, responsive font sizing, and proper mobile breakpoints.
  - Table now scrolls horizontally on small screens.

- [x] Deploy website/docs to GCP GCS with cache busting
  - `deploy-websites.sh` upgraded with two-tier cache: hashed assets (1yr immutable), HTML (5min/1min). Post-sync metadata enforcement. Bash 3 compatibility fix. `DEC-GCS-DEPLOY-001`–`004`.
  - Deployed and verified: all assets live with correct `Cache-Control` headers.

- [x] Add Google Analytics (GA4) to the website and all pages including docs
  - **2026-04-04 verification refresh:** added repo guard coverage in `cli/test/launch-evidence.test.js`, added `.planning/WEBSITE_ANALYTICS_SPEC.md`, and re-verified live `https://agentxchain.dev/` HTML contains both `G-1Z8RV9X341` and `googletagmanager`.
  - **Tracking ID:** `G-1Z8RV9X341`
  - **How to implement (Docusaurus native plugin):**
    1. In `website-v2/docusaurus.config.ts`, add `gtag` to the `preset-classic` config:
       ```ts
       presets: [
         [
           'classic',
           {
             gtag: {
               trackingID: 'G-1Z8RV9X341',
               anonymizeIP: true,
             },
             // ... existing docs, blog, theme options
           },
         ],
       ],
       ```
       `@docusaurus/plugin-google-gtag` is bundled with `preset-classic` — no `npm install` needed.
    2. This automatically injects the gtag.js snippet into every page (landing, docs, comparison pages, `/why`, etc.) including client-side navigations.
    3. Verify locally: run `npm start`, open browser DevTools → Network tab, confirm requests to `https://www.googletagmanager.com/gtag/js?id=G-1Z8RV9X341`.
    4. After merge, redeploy via `deploy-websites.sh` and verify in Google Analytics Real-Time dashboard that pageviews are registering.
  - **Raw script (for reference only — use the Docusaurus plugin above, not manual injection):**
    ```html
    <!-- Google tag (gtag.js) -->
    <script async src="https://www.googletagmanager.com/gtag/js?id=G-1Z8RV9X341"></script>
    <script>
      window.dataLayer = window.dataLayer || [];
      function gtag(){dataLayer.push(arguments);}
      gtag('js', new Date());
      gtag('config', 'G-1Z8RV9X341');
    </script>
    ```

- [ ] Verify homebrew tap rename (`homebrew-agentxchain` → `homebrew-tap`) did not break anything
  - The GitHub repo `shivamtiwari93/homebrew-agentxchain` was renamed to `shivamtiwari93/homebrew-tap`.
  - This is now the **unified tap** for all projects: `brew tap shivamtiwari93/tap`.
  - **Check these locations for stale references to `shivamtiwari93/agentxchain` or `homebrew-agentxchain`:**
    - `cli/homebrew/README.md` (already updated)
    - `cli/homebrew/agentxchain.rb` (formula itself — no tap name inside, should be fine)
    - Any CI/CD workflows, GitHub Actions, or deploy scripts that reference the old tap name
    - npm `postinstall` scripts or docs that tell users to `brew tap shivamtiwari93/agentxchain`
    - Website docs pages that mention Homebrew installation
  - **After verifying**, update install instructions everywhere to: `brew tap shivamtiwari93/tap && brew install agentxchain`

## Completion Log

- **2026-04-03**: All 7 priority queue items completed across Turns 21–4 (Claude Opus 4.6 + GPT 5.4). Docusaurus migration, vision alignment, asset fixes, table formatting, vanity proof replacement, platform split simplification, and GCS deployment with cache busting. v2.2.0 release-ready.
