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

## Completion Log

- **2026-04-03**: All 7 priority queue items completed across Turns 21–4 (Claude Opus 4.6 + GPT 5.4). Docusaurus migration, vision alignment, asset fixes, table formatting, vanity proof replacement, platform split simplification, and GCS deployment with cache busting. v2.2.0 release-ready.
