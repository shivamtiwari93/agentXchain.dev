# Human Roadmap — AgentXchain

Human-prioritized work for the agents.

Rules:
- Agents should read this file before acting.
- Unchecked items here take priority over general exploration in `AGENT-TALK.md`.
- When an item is complete, agents should mark it complete and briefly record what changed.
- If an item is too large, agents should split it into smaller checklist items and work them down in order.
- Only move an item back to `HUMAN_TASKS.md` if it truly requires operator-only action.

Current focus: pricing-model surface correction and product-boundary clarity

## Priority Queue

- [x] Fix logo alignment in the end-of-page CTA section (above footer) on the agentxchain.dev homepage — completed 2026-04-12: replaced CTA reuse of `.hero-logo` with CTA-specific `.cta-logo`, added `.planning/WEBSITE_HOMEPAGE_CTA_LOGO_ALIGNMENT_SPEC.md`, added `cli/test/homepage-cta-logo-content.test.js`, and verified the built homepage centers the icon at desktop (`1440x1200`, delta `0px`) and mobile (`390x844`, delta `0px`) widths.
  - The AgentXchain logo/icon in the section just above the footer ("Software is a team sport. Even when the team is AI.") is **left-aligned** instead of **center-aligned**.
  - The logo should be horizontally centered to match the centered text and buttons below it.
  - This is likely a CSS issue — check the `.hero-logo` or equivalent class in that section. The previous visual design sweep may have inadvertently broken the centering.
  - Verify the fix on both desktop and mobile viewports.

- [x] Publish the AgentXchain VS Code extension to the Marketplace
  - The publisher `agentXchain.dev` (ID `agentXchaindev`) is created and the `VSCE_PAT` secret is set on the GitHub repo.
  - The extension is fully packaged in `cli/vscode-extension/` and CI workflow `publish-vscode-on-tag.yml` is ready.
  - Verify the extension package is complete (icon, README, correct publisher name in `package.json`, feature descriptions).
  - Push a `vsce-v0.1.0` tag to trigger the CI publish workflow.
  - Verify the extension appears on the VS Code Marketplace and is installable.
  - Add a link to the Marketplace listing on the agentxchain.dev website (docs, homepage, or getting-started page).
  - **2026-04-13 completed:** Fixed publisher ID in `package.json` from `agentxchain` to `agentXchaindev` (matching the registered Marketplace publisher). Pushed `vsce-v0.1.0` tag, CI publish workflow succeeded (all steps green including "Publish to VS Code Marketplace"). Extension live at `https://marketplace.visualstudio.com/items?itemName=agentXchaindev.agentxchain`. Added Marketplace link to homepage Integrations section, getting-started page, and quickstart prerequisites. Updated marketplace readiness test assertion. Docusaurus build clean.

- [ ] Create polished integration guides for all supported agent platforms, local model runners, and API providers
  - AgentXchain is agent/IDE/LLM agnostic by design. The 5 adapters (`manual`, `local_cli`, `api_proxy`, `mcp`, `remote_agent`) already support virtually every connection pattern. What's missing is **polished, first-class onboarding documentation** so developers know exactly how to use AgentXchain with their preferred platform.
  - Create a docs section (e.g., `/docs/integrations/`) with a guide for each platform below. Each guide should cover: what the platform is, which adapter connects it, step-by-step setup, a minimal working example, and any platform-specific gotchas.
  
  **IDE / Agent Platforms:**
  1. Claude Code — `local_cli` via `claude -p`
  2. OpenAI Codex CLI — `local_cli` via `codex`
  3. Cursor — `local_cli`
  4. VS Code (+ Copilot, Cline, etc.) — Extension + `local_cli`
  5. Windsurf (Codeium) — `local_cli`
  6. Google Jules — `api_proxy` (Google)
  7. Devin — `remote_agent` (HTTP)
  
  **Local Model Runners:**
  8. Ollama — `api_proxy` via `localhost:11434/v1`
  9. MLX (Apple) — `api_proxy` via `mlx-lm.server`
  
  **API Providers (with latest coding models as of April 2026):**
  10. Anthropic — Claude Opus 4.6, Claude Sonnet 4.6, Claude Haiku 4.5
  11. OpenAI — GPT-5.4, GPT-5.3-Codex, GPT-5.2-Codex, GPT-OSS-120B, GPT-OSS-20B
  12. Google — Gemini 3.1 Pro, Gemini 3.0 Flash, Gemini 3.1 Flash-Lite, Gemma 4
  13. DeepSeek — DeepSeek-V3.2, DeepSeek-R2, DeepSeek Coder-V3
  14. Mistral AI — Devstral 2 (123B), Devstral Small 2 (24B), Codestral, Leanstral
  15. xAI — Grok 4.20 Beta 2, Grok 4.1 Fast, Grok Code Fast 1
  16. Amazon — Nova 2 Pro, Nova 2 Lite, Nova Premier
  17. Qwen (Alibaba) — Qwen3-Coder-480B-A35B, Qwen3-Coder-30B-A3B, Qwen3-Coder-Next, Qwen3.6-Plus
  18. Groq — inference platform hosting GPT-OSS-120B, Kimi K2, Qwen3 32B, Llama 4 Scout, Llama 3.3 70B, Codestral Mamba
  19. Cohere — Command A Reasoning, Command A, Command R+
  
  **MCP / Protocol Native:**
  20. Any MCP-compatible agent — `mcp` (stdio)
  
  - Add an Integrations dropdown or section in the docs sidebar, similar to the existing Examples section.
  - Each guide should be standalone — a developer using only Ollama + Cursor should be able to follow just those two guides without reading anything else.
  - Cross-link from the homepage architecture section (Layer 5 — Integrations) to the new docs section.
  - Keep model lists factual and current. If a model hasn't launched yet (DeepSeek V4, Grok 5), don't include it in the guide.

- [x] Create 5 new product examples under `/examples/` to prove AgentXchain can build software end-to-end without human intervention
  - Come up with 5 small but varied real-world product examples across different categories:
    1. **Consumer SaaS** — e.g., a habit tracker, expense splitter, or bookmark manager
    2. **Mobile app** — e.g., a React Native or Flutter app (weather, recipe, workout tracker)
    3. **B2B SaaS** — e.g., an invoice generator, team standup bot, or customer feedback tool
    4. **Developer tool** — e.g., a CLI tool, GitHub Action, API client library, or code formatter
    5. **Open source library** — e.g., a validation library, state machine lib, or markdown parser
  - Each example must be a **complete, working project** — not a stub or placeholder. It should have real code, tests, docs, and a governed `agentxchain.json` config with appropriate roles and workflow.
  - Each example should demonstrate different AgentXchain capabilities: different role configurations, different workflow phases, different artifact types, different team sizes.
  - Each example should include a `README.md` explaining what the product is, how to run it, and how AgentXchain governed its development.
  - The goal is to prove that AgentXchain can take a product idea from zero to shippable software across varied domains — not just todo apps.
  - Use `agentxchain run` or the governed workflow to actually build each example. The commit history should show the governed development process.
  - Delivery split (created 2026-04-09 so the queue can be worked honestly instead of hand-waved):
    - [x] `examples/habit-board` — consumer SaaS habit tracker: Node.js web app with REST API, JSON persistence, streak logic, responsive dark-theme vanilla JS frontend, 29 tests, 4-role designer-in-the-loop workflow with explicit workflow-kit, shipped in Turn 9
    - [x] `examples/trail-meals-mobile` — mobile meal-planning app: React Native (Expo) hiker meal planner with offline-first AsyncStorage, calorie/weight planner, platform matrix (iOS/Android/Expo Go), 6-role (pm/mobile_architect/rn_engineer/nutrition_analyst/ux_reviewer/qa) 5-phase workflow, 26 tests, shipped in Turn 11
    - [x] `examples/async-standup-bot` — B2B SaaS standup/status collector: Node.js web app with team/member management, async check-in upserts, summary markdown, reminder previews, retention prune operations, 15 tests, and a 5-role planning/integration/implementation/operations/qa workflow shipped in Turn 10
    - [x] `examples/decision-log-linter` — developer tool CLI with explicit workflow-kit, custom architecture/release phases, runnable tests, and `template validate` proof shipped in Turn 8
    - [x] `examples/schema-guard` — open source validation library: ESM package with declarative schema DSL, nested object validation, custom messages, composition helpers (`refine`/`transform`/`pipe`), `src/index.d.ts` TypeScript-friendly exports, API-review + release-engineering workflow-kit, 19 tests, and pack/template validation proof shipped in Turn 12
  - [x] Parent item complete (2026-04-09): all five governed product examples now ship with runnable code, tests, READMEs, `agentxchain.json`, `TALK.md`, category-specific workflow-kit artifacts, and repo-level governed provenance documented in `.planning/PRODUCT_EXAMPLES_GOVERNED_PROOF.md`

- [x] Add a dedicated docs page for each example on the website under `/docs/examples/`
  - Create a dropdown/section in the docs sidebar for "Examples" — similar to how the changelog/releases dropdown works.
  - Each example gets its own page (e.g., `/docs/examples/habit-board`, `/docs/examples/schema-guard`, etc.).
  - Each page should explain: what the product is, what roles/workflow were used, how AgentXchain governed the build, how to run it, and key takeaways.
  - Include **all** examples — both new ones (habit-board, trail-meals-mobile, async-standup-bot, decision-log-linter, schema-guard) and existing ones (governed-todo-app, ci-runner-proof, external-runner-starter, live-governed-proof, mcp-echo-agent, mcp-http-echo-agent, mcp-anthropic-agent, remote-agent-bridge, remote-conformance-server).
  - The Examples dropdown should be a first-class navigation item in the docs sidebar.
  - **2026-04-10 completed:** Added `.planning/EXAMPLES_DOCS_SURFACE_SPEC.md`, turned `Examples` into a first-class docs sidebar category, created the hub page plus 14 detail pages under `website-v2/docs/examples/`, updated `llms.txt` and `sitemap.xml` for the new public routes, and extended `cli/test/docs-examples-content.test.js` to guard the examples docs surface.

- [x] Add the LinkedIn company page link to the agentxchain.dev website alongside the existing X and Reddit links
  - LinkedIn page: https://www.linkedin.com/company/agentxchain-dev/
  - Add it everywhere X and Reddit already appear: navbar Community dropdown, footer Community column, homepage community cards.
  - Use the LinkedIn icon (similar to how X and Reddit have their icons).
  - Link should open in a new tab.
  - Note: X/Twitter (`@agentXchain_dev`) is currently **suspended** — consider removing the X link or marking it as inactive so visitors don't land on a suspended page.
  - **2026-04-11 completed:** Added LinkedIn to the navbar Community dropdown, footer Community column, and homepage community cards; added LinkedIn icon treatment in navbar/homepage; removed the public X destination from navbar/footer; rendered the homepage X card as a visible suspended/inactive status instead of a live broken link; updated the website community-links spec/tests and verified `node --test cli/test/community-links-content.test.js` plus `cd website-v2 && npm run build`.

- [x] Audit all public-facing content (website, npm README, GitHub repo README, Homebrew tap README) for first-time developer clarity
  - Our visitors are new developers encountering AgentXchain for the first time. They need to understand the **"why"** (what problem does this solve?) and the **"how"** (how do I get started?) within the first 60 seconds.
  - **Website (agentxchain.dev):** Review the homepage, `/docs/`, `/why`, quickstart, and comparison pages. Is the value proposition immediately clear? Can a new dev go from "what is this?" to "let me try it" without confusion?
  - **npm README (`cli/README.md`):** This is what shows on `npmjs.com/package/agentxchain`. Does it explain what AgentXchain is, how to install, and a minimal "hello world" example? Is it up to date with current CLI commands and features?
  - **GitHub repo README:** Does it match the current product state? Are install instructions accurate? Does it link to the right docs? Is the architecture summary current?
  - **Homebrew tap README (`homebrew-tap/README.md`):** Does it have correct install commands? Does it explain what you're installing?
  - **Cross-check consistency:** Are version numbers, feature descriptions, install commands, and positioning consistent across all four surfaces? A new dev might land on any one of these first — they should all tell the same story.
  - **Actionable output:** Fix any outdated, confusing, or missing content. If something requires human input (e.g., product positioning decisions), flag it in AGENT-TALK.md.
  - **2026-04-12 completed:** Audited all four surfaces. GitHub README: added five-layer Architecture table, added Homebrew install option. npm README: added plain-English opening paragraph explaining what AgentXchain does in human terms, added Homebrew install option. Homebrew README: added one-line product description with docs link. Website getting-started.mdx and quickstart.mdx: added Homebrew install alternative alongside npm. All install commands now consistent across all surfaces (npm, brew, npx). Version numbers aligned at 2.76.0. 3863 tests / 0 failures. Docusaurus build clean.

- [x] Visual design sweep of the agentxchain.dev website
  - Do a thorough review of every page on the agentxchain.dev website looking for visual improvements.
  - Check: spacing consistency, typography hierarchy, color usage, dark mode rendering, mobile responsiveness, image quality, card/section alignment, hover states, transitions, and overall visual polish.
  - Look at competitor sites (Vercel, Linear, Supabase, Resend) for inspiration on what "polished developer tool website" looks like in 2026.
  - Pay special attention to: homepage hero section, architecture diagram section, comparison pages, docs sidebar, code blocks, and the examples pages.
  - Fix any issues found — CSS tweaks, layout improvements, spacing fixes, etc.
  - If larger redesigns are needed that go beyond CSS fixes, document recommendations in AGENT-TALK.md for human review.
  - **2026-04-12 completed:** Comprehensive visual audit of all CSS and homepage TSX. Created `.section-spaced` utility class replacing 10+ inline `padding: '5rem 0'` instances. Created dedicated CSS classes for examples cards (`.example-card`, `.example-category`, `.example-desc`, `.example-roles`), CTA section (`.cta-section`, `.cta-inner`), outcomes headings (`.outcome-title`), and step descriptions (`.step-desc`). Added mobile responsiveness for new classes. Fixed EndVision section centering. Removed ~20 inline style attributes from index.tsx. All inline styles that remain are one-off layout-specific overrides (layer card dynamic colors, link margin-top). 3863 tests / 0 failures. Docusaurus build clean. Larger recommendations logged in AGENT-TALK.md: consider standardizing the full spacing scale, extracting terminal colors to CSS vars, and adding a mid-size tablet breakpoint.

- [x] Restore the X/Twitter link on the agentxchain.dev website with the NEW account `@agentxchaindev`
  - The old `@agentXchain_dev` account was suspended. A new account `@agentxchaindev` (no underscore) is now active.
  - The homepage currently shows the X card as "suspended/inactive" — replace it with a live, clickable card linking to `https://x.com/agentxchaindev`.
  - Re-add X to the navbar Community dropdown and footer Community column (linking to `https://x.com/agentxchaindev`).
  - Update any references to the old handle `@agentXchain_dev` → `@agentxchaindev` across the website.
  - The X card should match the style of the LinkedIn and Reddit community cards (active, clickable, opens in new tab).
  - **2026-04-12 completed:** Restored live `@agentxchaindev` links in the navbar, footer, homepage community cards, and `llms.txt`; replaced the suspended placeholder card with a real X card plus icon; updated `.planning/WEBSITE_COMMUNITY_LINKS_SPEC.md`; verified `node --test cli/test/community-links-content.test.js` and `cd website-v2 && npm run build`.

- [x] Extract `r-browser` into its own private GitHub repo (like `x-browser`)
  - Currently `r-browser` lives inside the `1008apps` monorepo at `/Users/shivamtiwari.highlevel/VS Code/1008apps/r-browser/`.
  - `x-browser` is already its own standalone private repo — `r-browser` should follow the same pattern.
  - Create a new **private** GitHub repo (e.g., `shivamtiwari93/r-browser` or similar).
  - Move the `r-browser/` directory contents into the new repo with full history if possible (or a clean initial commit if not).
  - Ensure `.venv/` is in `.gitignore`, `pyproject.toml` / `setup.py` is correct, and the CLI entry point (`r-browser` command) works after install.
  - Update any references in `agentXchain.dev` (e.g., `marketing/post-reddit.sh`) to point to the correct path if it changes.
  - **2026-04-10 completed:** Rewrote `shivamtiwari93/r-browser` from a one-shot initial snapshot to real split history from `1008apps`, added repo-local `.gitignore` (including `.venv/`), removed tracked `src/r_browser/__pycache__/*.pyc`, preserved the latest source/docs changes, verified `pip install -e .` plus `r-browser --help`, and converted `1008apps/r-browser` into a proper git submodule at the same path so `marketing/post-reddit.sh` did not need a path change.

- [x] Redesign the "Architecture — Five layers. One governed delivery system." section on the agentxchain.dev homepage to use a **2-column layout** instead of the current single-column stacked layout. The five layers (Protocol, Runners, Connectors, Workflow Kit, Integrations) should be presented in a visually appealing 2-column grid (with the 5th item spanning full width or placed thoughtfully). Make it look clean and professional on both desktop and mobile.
  - **2026-04-09 completed:** Changed `.layers-grid` from `flex-direction: column` to `display: grid; grid-template-columns: 1fr 1fr`. 5th item (Integrations) spans full width via `.layer-card:nth-child(5) { grid-column: 1 / -1 }`. Mobile breakpoint (≤768px) collapses to single column and resets 5th-item span. Docusaurus build clean.

- [x] Create very liberal robots.txt, very liberal llms.txt, and a detailed sitemap for both agentxchain.dev and agentxchain.ai
  - **robots.txt**: Allow all crawlers, all paths, no restrictions. We want maximum discoverability.
  - **llms.txt**: Follow the llms.txt standard (https://llmstxt.org/). Be very generous — include all public docs, protocol spec, quickstart, CLI reference, comparison pages, release notes, examples, and any other content that helps LLMs understand AgentXchain.
  - **sitemap.xml**: Comprehensive sitemap listing every page on each site with proper `<lastmod>`, `<changefreq>`, and `<priority>` tags.
  - For agentxchain.dev: place files in `website-v2/static/` so Docusaurus includes them in the build output root.
  - For agentxchain.ai: place files in the `website/` directory (static site root).
  - After creating the files, push all repos using `bash "/Users/shivamtiwari.highlevel/VS Code/1008apps/push-with-token.sh" "Add robots.txt, llms.txt, and sitemap.xml for both sites"`.
  - Then deploy both sites using `export PATH="$HOME/google-cloud-sdk/bin:$PATH" && bash "/Users/shivamtiwari.highlevel/VS Code/1008apps/deploy-websites.sh"`.
  - **2026-04-08 completed:** Created all 6 files. agentxchain.dev: `robots.txt` (allow all), `llms.txt` (comprehensive — core concepts, all 49 page URLs, install/example, community links), `sitemap.xml` (49 URLs with per-page priority: homepage 1.0, docs/compare 0.7-0.9, releases 0.4-0.5). agentxchain.ai: `robots.txt` (allow all), `llms.txt` (cloud platform positioning, relationship to .dev, key differentiators), `sitemap.xml` (1 URL, priority 1.0). Disabled Docusaurus auto-sitemap to avoid conflict with static sitemap. Pushed all 3 repos, deployed both sites. All 6 URLs verified live with HTTP 200. 2622 tests / 562 suites / 0 failures. Docusaurus build clean.

- [x] Add community links to the agentxchain.dev website
  - Link the **Reddit community**: https://www.reddit.com/r/agentXchain_dev/
  - Link the **X/Twitter profile**: https://x.com/agentXchain_dev
  - Place these at appropriate locations on the website — e.g., footer, navbar, homepage community section, docs sidebar, or wherever they naturally fit.
  - Use recognizable icons (X logo, Reddit logo) where appropriate.
  - Make sure links open in a new tab.
  - **2026-04-08 completed:** Added `Community` navbar dropdown with icon-backed X/Reddit items, added footer `Community` column, added homepage community cards with explicit `target="_blank"` behavior, wrote `.planning/WEBSITE_COMMUNITY_LINKS_SPEC.md`, and added `cli/test/community-links-content.test.js`. Verified via targeted test + Docusaurus production build.

- [x] Fix website-v2 mobile / small-screen navigation collapse bug
  - **Human report:** after clicking the hamburger in mobile view or a narrow browser window, the menu opens but no usable nav options are visible or clickable.
  - **Evidence file:** [Screenshot 2026-04-08 at 05.28.43.png](/Users/shivamtiwari.highlevel/Desktop/Screenshot%202026-04-08%20at%2005.28.43.png)
  - **Local reproduction completed:** this is reproducible on the locally served production build at `http://127.0.0.1:4174/` using a narrow desktop viewport (`874x768`) in Playwright Chromium.
  - **Observed failure mode:**
    - `.navbar__toggle` exists and responds to click
    - `.navbar-sidebar` becomes visible, but its computed height is only `60px`
    - `.navbar-sidebar__brand` renders at `60px`
    - `.navbar-sidebar__items` exists but collapses to `height: 0px`
    - result: only the top bar / close icon is visible, while the actual nav links are effectively hidden
  - **Observed debug values from reproduction:**
    - `sidebarVisible=true`
    - `sidebarBox={\"x\":0,\"y\":0,\"width\":725.40625,\"height\":60}`
    - `panelVisible=false`
    - `panelBox={\"x\":0,\"y\":60,\"width\":725.40625,\"height\":0}`
    - `panelText=\"Docs\\nWhy\\nLaunch\\nCompare\\nGitHub\\nnpm\\n← Back to main menu\"`
  - **Important nuance:** mobile emulation with Playwright `iPhone 13` did show the menu opening correctly, so this looks like a **small-screen / narrow-window breakpoint bug**, not a universal mobile-nav failure.
  - **Required agent work:**
    - identify the CSS / layout interaction causing `.navbar-sidebar__items` to collapse to zero height
    - reproduce and verify on both homepage and docs pages
    - add a regression test or proof artifact so this does not silently return
    - do not mark complete until the menu options are visibly rendered and clickable on narrow desktop and mobile widths
  - **2026-04-08 completed:** Root cause: `backdrop-filter: blur(20px)` on `.navbar` creates a CSS containing block for `position: fixed` descendants, constraining `.navbar-sidebar` to the 60px navbar height instead of the viewport. Fix: `.navbar-sidebar--show { backdrop-filter: none; }` — sidebar overlay covers navbar so no visual impact. Regression guard added. 2503 tests / 540 suites / 0 failures. `DEC-MOBILE-NAV-FIX-001`.

- [x] Add a comparison page: AgentXchain vs Warp.dev
  - **Before writing anything**, do exhaustive research of Warp.dev's documentation, features, positioning, and capabilities.
  - Understand what Warp actually is (AI-native terminal, agentic coding features, team collaboration, etc.) and how it positions itself.
  - The comparison must be honest, specific, and grounded in real product facts — not strawman or hand-wavy.
  - Create a `website-v2/src/pages/compare/vs-warp.mdx` page following the same format as the existing comparison pages (vs CrewAI, vs LangGraph, vs OpenAI Agents SDK, vs AG2).
  - Add it to the comparison navigation alongside the others.
  - **2026-04-07 completed:** added `.planning/COMPARE_VS_WARP_SPEC.md`, created `website-v2/src/pages/compare/vs-warp.mdx`, updated compare navigation in the navbar/footer/homepage CTA, and verified with `cd website-v2 && npm run build`.

- [x] Research and identify additional competitors that need comparison pages
  - **Do proper web research** — search for "multi-agent orchestration frameworks", "AI coding agent coordination", "agentic software development platforms", "AI agent workflow tools", etc.
  - Look at: Devin, Factory, Cognition, Poolside, All Hands (OpenHands/OpenDevin), Sweep, Cosine (Genie), Codeium Windsurf, Amazon Q Developer Agent, Google Jules, Replit Agent, Bolt.new, Lovable, and any other relevant players.
  - For each candidate, assess whether they compete in the same space (governed multi-agent coordination) or a different space (single-agent coding assistant). Only create comparison pages for genuine competitors or products that users would reasonably compare against.
  - Produce a ranked list of recommended comparison pages with a one-line justification for each, then create the pages.
  - **2026-04-07 completed:** Researched 23 products across multi-agent orchestration, AI coding agents, AI IDEs, and app builders. Wrote ranked competitor memo (`.planning/COMPETITOR_RESEARCH_2026_04.md`). Created 4 new comparison pages: vs Devin (autonomous AI agent), vs MetaGPT (SOP-driven multi-agent, closest philosophical competitor), vs Codegen (enterprise code-agent platform), vs OpenHands (open-source agent platform/SDK). All pages added to navbar, footer, and homepage CTA. Test guards updated (12 tests / 0 failures). Docusaurus build clean.

- [x] Reassess the model-cost / budget surface before extending it further
  - **Human concerns to resolve explicitly:**
    1. OpenAI cost tables are already outdated. Agents should research the latest official OpenAI API model pricing before changing anything further.
    2. For coding usage, regular general-purpose OpenAI models are not the whole story. Agents must include Codex-family model coverage if the product is going to present OpenAI coding cost guidance at all.
    3. The current provider surface appears incomplete. Why are Anthropic, Kimi, DeepSeek, Qwen, and other plausible local/cloud providers missing from the budget/cost model?
    4. There is a product-strategy risk here: if AgentXchain tries to maintain a complete per-model/per-provider public pricing catalog, this becomes a permanent catch-up game and may never be truthful or complete.
  - **Required agent output:**
    - Decide whether AgentXchain should:
      - keep a curated cost catalog,
      - narrow cost support to a smaller truthfully-maintained subset,
      - move to a provider-agnostic budget model with optional provider plug-ins,
      - or treat pricing as external/operator-supplied metadata instead of first-party product truth.
    - If agents keep any first-party pricing support, they must justify:
      - scope boundary
      - update strategy
      - truth guarantees
      - how new providers/models enter the system
    - If agents research current model pricing, they must use official provider sources and update docs/specs/code together.
  - **Guardrail:** do not casually add more hardcoded provider/model prices without first resolving the strategic product question above.
  - **2026-04-07 completed:** Strategic decision (`DEC-COST-STRATEGY-001`): operator-supplied `cost_rates` in `agentxchain.json` override bundled defaults. No attempt to maintain a complete pricing catalog. Fixed wrong Anthropic prices (Opus 4.6: $15/$75 → $5/$25; Haiku 4.5: $0.80/$4.00 → $1.00/$5.00). Renamed `COST_RATES` → `BUNDLED_COST_RATES` with backward-compat alias. Added `getCostRates(model, config)` that checks `config.budget.cost_rates` first. New providers/models enter via operator config. 67 adapter tests + 28 budget tests + 50 docs tests = 0 failures.

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

- [x] Verify homebrew tap rename (`homebrew-agentxchain` → `homebrew-tap`) did not break anything
  - **Audit completed and all stale references fixed (2026-04-06):**
    - `cli/homebrew/README.md` — already updated (documents the rename)
    - `cli/homebrew/agentxchain.rb` — confirmed no tap name inside
    - CI/CD workflows (`.github/`) — no Homebrew references found
    - npm `postinstall` / `package.json` — no Homebrew references found
    - Website docs (`website-v2/`) — no Homebrew install references found
    - **Fixed stale references in:** `run-agents.sh`, `.planning/HOMEBREW_MIRROR_CONTRACT_SPEC.md`, `.planning/RELEASE_PLAYBOOK.md` (2 locations), `.planning/HUMAN_TASKS.md`, `.planning/V1_RELEASE_CHECKLIST.md`
    - **Fixed test assertion:** `cli/test/homebrew-mirror-contract.test.js` updated to assert `homebrew-tap` instead of `homebrew-agentxchain`
    - **Fixed pre-existing test drift:** `cli/test/launch-evidence.test.js` homepage fixture label assertion updated from stale "golden fixtures" to actual "Conformance fixtures"
    - All install instructions already use `brew tap shivamtiwari93/tap && brew install agentxchain`
  - **Verification:** 1913 node tests / 431 suites / 0 failures (including homebrew mirror contract test)

## Completion Log

- **2026-04-03**: All 7 priority queue items completed across Turns 21–4 (Claude Opus 4.6 + GPT 5.4). Docusaurus migration, vision alignment, asset fixes, table formatting, vanity proof replacement, platform split simplification, and GCS deployment with cache busting. v2.2.0 release-ready.
