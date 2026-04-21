# Docs Stack Evaluation — OSS-First Pass

**Date:** 2026-04-21
**Author:** Claude Opus 4.7 (Turn 173)
**Status:** Advisory. Non-binding. Recommendation at bottom. A durable DEC is not written yet — promote to DEC only if a migration is actually selected.

## Why this evaluation exists

`WAYS-OF-WORKING.md` and the in-memory project instructions call out OSS-first discipline for commodity infrastructure and explicitly name docs stacks as a candidate for re-evaluation: *"do not assume the current hand-written static `/docs/` approach should continue forever. Evaluate established OSS options first. Docmost is one candidate to examine, along with other credible docs stacks."* GPT 5.4 reiterated the request in Turn 172 as an orthogonal work item while BUG-59/BUG-60 tester quote-back is pending.

This is a decision-ready survey, not a migration plan. It answers: *is Docusaurus still the right pick, or is there a credible OSS alternative whose benefit outweighs a 52-file migration?*

## Current stack (factual baseline)

| Dimension | Current state |
|---|---|
| SSG | Docusaurus 3.10.0 `preset-classic` |
| Rendering | MDX 3, React 19 |
| Language | TypeScript |
| Build acceleration | `@docusaurus/faster` (Rspack-based) |
| Search | `@easyops-cn/docusaurus-search-local` (fully client-side, no SaaS, no network egress) |
| Redirects | `@docusaurus/plugin-client-redirects` (13 redirects for compare pages) |
| Analytics | `gtag` (Google Analytics, `anonymizeIP: true`) |
| Sitemap | Built-in preset-classic sitemap |
| Content count | 52 MDX files in `website-v2/docs/`, plus `compare/`, `examples/`, `integrations/` subdirs, plus `src/pages/*.tsx` for landing |
| Versioning | Not enabled (docs are unversioned today; release notes live as individual pages under `docs/releases/`) |
| Deploy | GitHub Actions `.github/workflows/deploy-gcs.yml` → GCS bucket serving `agentxchain.dev` |
| License | Docusaurus MIT; search plugin MIT |
| Browser support | `>0.5%`, not dead, not op_mini (production); modern (dev) |
| i18n | `en` only, enabled-but-unused |
| Dark mode | Default dark, user-switchable |
| Authoring shape | MDX files + repo git commits by agents and the human |

**Observation:** this is already an OSS-first stack. The premise "replace hand-written static /docs/" is only partially true — the docs are authored by hand, but they are delivered by a mature OSS SSG, not a bespoke static pipeline. The real evaluation question is **Docusaurus vs other OSS SSGs**, not **OSS vs non-OSS**.

## What the stack must support (non-negotiables)

Derived from current usage patterns and VISION.md implications. Any alternative must match these or have a credible migration story.

1. **MDX with custom React components.** The docs use JSX inside markdown (e.g., `index.tsx` landing, in-docs components). Plain-markdown-only tools are disqualified.
2. **Repo-native authoring via git commits.** Agents and the human edit `.mdx` files, commit, push, deploy. Anything requiring a separate editing UI, database, or admin console is a mismatch.
3. **Static output deployable to GCS.** Current pipeline assumes static HTML/JS/CSS. Server-rendered-only tools are disqualified.
4. **Self-hosted search.** `docusaurus-search-local` produces no network egress beyond the page's own domain. Algolia DocSearch would add a SaaS dependency we don't have today.
5. **Client-side redirects.** 13 legacy `/compare/*` → `/docs/compare/*` redirects must survive migration.
6. **Zero-cost-to-add new content.** New MDX file → commit → deploy. No schema registration, no import map edit, no CMS entry.
7. **Runs in existing Node 20.x CI.** No Python/Ruby/Go runtime additions to the build pipeline.
8. **Open source, permissive license, mature enough for a production-visible public surface.**

## Candidates considered

### Tier 1 — Direct Docusaurus competitors (static MDX site generators)

#### Docusaurus 3.x (incumbent)
- **License:** MIT (Meta/Facebook).
- **Maturity:** v1 2017, v2 2022, v3 2023. Actively maintained, 58k+ GitHub stars, used by React, Jest, Babel, Redux.
- **Strengths:** MDX 3 + React 19 supported today; plugin ecosystem is the largest of any docs SSG; built-in versioning, i18n, search integrations, redirects, sitemap, blog. `@docusaurus/faster` closes most of the perf gap with Rspack/Turbopack-based alternatives.
- **Weaknesses:** Heaviest framework; cold builds of 52 docs today take ~15-25s (acceptable); client-side React hydration is comparatively heavy vs partial-hydration alternatives; TypeScript support is layered (works but not first-class the way it is in Fumadocs/Starlight).
- **Migration cost:** zero.

#### Fumadocs 15.x
- **License:** MIT.
- **Maturity:** 2023+. Rising quickly; used by Turborepo docs, Million.js docs, several Vercel-team-adjacent projects. ~7k stars. Younger than Docusaurus but no longer experimental.
- **Strengths:** Next.js 15 App Router-native, server-components-first; TypeScript first-class; built-in full-text search (FlexSearch, self-hosted) with better UX than `docusaurus-search-local`; native OpenAPI/TypeDoc support; excellent dark mode out of the box; file-system-based routing maps cleanly to `docs/*.mdx` layout we have.
- **Weaknesses:** Requires Next.js in the build pipeline (vs Docusaurus's self-contained build); smaller plugin ecosystem (no direct client-redirects plugin — would need middleware); documentation of Fumadocs itself is less exhaustive than Docusaurus's; breaking changes more frequent than Docusaurus's stability contract.
- **Migration cost:** moderate. MDX files carry over with minor frontmatter edits; `sidebars.ts` becomes `meta.json` in each folder; redirects move to `next.config.js`; landing page (`src/pages/index.tsx`) becomes a Next route.

#### Astro Starlight 0.30.x
- **License:** MIT.
- **Maturity:** 2023+. First-class Astro docs framework. ~5k stars on Starlight; Astro itself has 45k+. Used by Bun docs (partial), several large OSS projects.
- **Strengths:** Smallest shipped JS bundle of any candidate (Astro's partial-hydration means most pages ship zero JS); blazing build times (linear in content size, ~5x faster than Docusaurus cold build at 52-file scale); MDX 3 supported; built-in search (Pagefind, self-hosted, excellent); i18n, versioning-via-sidebar, sitemap all built-in.
- **Weaknesses:** React components inside MDX require the `@astrojs/react` integration (works but is an extra config layer vs Docusaurus's native support); ecosystem smaller than Docusaurus's; landing page patterns more Astro-shaped than React-shaped (would need to port `index.tsx` to `.astro`).
- **Migration cost:** moderate-to-high. MDX files migrate cleanly; React components inside pages need integration setup; `src/pages/*.tsx` requires rewrite.

#### Nextra 4.x
- **License:** MIT.
- **Maturity:** 2021+. By a Vercel contributor. Used by SWR, Turbopack, Reactflow docs. ~12k stars.
- **Strengths:** Next.js App Router-native; MDX 3; built-in search (FlexSearch); first-class dark mode; good TypeScript support; Vercel deploy is trivial.
- **Weaknesses:** Documentation theme is the only well-maintained theme; more opinionated than Fumadocs; landing-page support is weaker (typically users add raw Next pages alongside Nextra docs).
- **Migration cost:** moderate. Similar shape to Fumadocs.

#### VitePress 1.x
- **License:** MIT.
- **Maturity:** 2022 stable. By the Vue team. ~14k stars. Used by Vue, Vite, Vitest, Pinia docs.
- **Strengths:** Fast builds (Vite); excellent default theme; built-in search; small bundle.
- **Weaknesses:** **Vue-ecosystem. Disqualifies it** — MDX inside Vue means a different component model, and our existing React MDX components would need to be rewritten. Violates non-negotiable #1 cost-wise.
- **Migration cost:** prohibitive.

#### MkDocs Material 9.x
- **License:** MIT (material theme); BSD (mkdocs core).
- **Maturity:** 2014+. Python-ecosystem. Used by huge OSS projects (FastAPI, Pydantic, Kubernetes partially).
- **Strengths:** Best-in-class default theme; extensive plugin ecosystem; mature.
- **Weaknesses:** **Python build pipeline** (violates non-negotiable #7); **markdown-only, no MDX/JSX** (violates non-negotiable #1); would require rewriting every in-docs React component as a Jinja macro or admonition.
- **Migration cost:** prohibitive.

### Tier 2 — Wiki / knowledge-base apps (different category)

#### Docmost
- **License:** AGPL-3.0 (note: copyleft; AGPL network-use clause applies to self-hosted web apps).
- **Maturity:** 2024+. ~11k stars. Confluence/Notion-style collaborative wiki.
- **Shape mismatch:** Docmost is a dynamic web application (Node.js backend + Postgres), NOT a static site generator. Pages are edited in a browser WYSIWYG, stored in a database, served server-side. This is the opposite shape from the project's current repo-native authoring model.
  - **Violates non-negotiable #2** (repo-native authoring via git commits — Docmost edits live in Postgres, not git).
  - **Violates non-negotiable #3** (static output to GCS — Docmost needs a live Node+DB deploy).
  - **Violates non-negotiable #6** (zero-cost-to-add — each page requires a create-in-UI step, not a file commit).
  - **Agent-native authoring regression:** the project's agents currently author docs by editing MDX files and committing. Docmost would require an API integration layer before an agent could write a page, and every page would be outside git history.
  - **License concern:** AGPL-3.0 copyleft is fine for internal wikis but creates a friction point if the docs site is ever merged into or embedded in the main MIT codebase.
- **Fit for AgentXchain:** poor for public product docs. **Potentially useful as an internal agent-collaboration wiki** (a separate, non-public surface where agents and humans write notes that aren't meant to be consumed by end users). Not a replacement for `website-v2/`.

#### Outline, BookStack, Wiki.js
- Same category as Docmost. Same shape mismatch. Same reasoning applies. None of them are drop-in replacements for a static MDX docs site.

### Tier 3 — Proprietary (excluded per OSS-first principle)

- **Mintlify:** closed-source hosted product; excellent UX; self-host exists but is paid. Excluded.
- **ReadMe:** closed-source; excluded.
- **GitBook:** closed-source; excluded.
- **Fern:** OpenAPI-first, not MDX-first. Excluded for fit.

## Decision matrix

Scoring: ✅ fully satisfied, ⚠️ partial, ❌ not satisfied. Migration cost: how much repo work to switch.

| Requirement | Docusaurus | Fumadocs | Starlight | Nextra | Docmost |
|---|---|---|---|---|---|
| MDX + React components | ✅ native | ✅ native | ⚠️ via integration | ✅ native | ❌ WYSIWYG, not MDX |
| Repo-native git authoring | ✅ | ✅ | ✅ | ✅ | ❌ DB-backed |
| Static output to GCS | ✅ | ✅ | ✅ | ⚠️ ideal deploy is Vercel; GCS works with static export | ❌ needs app server |
| Self-hosted search | ✅ docusaurus-search-local | ✅ FlexSearch | ✅ Pagefind (best UX) | ✅ FlexSearch | ⚠️ built-in but DB-scoped |
| Client-side redirects | ✅ plugin | ⚠️ next.config middleware | ⚠️ via Astro redirects | ⚠️ next.config | N/A |
| Zero-cost new content | ✅ | ✅ | ✅ | ✅ | ❌ UI-bound |
| Node 20.x-only pipeline | ✅ | ✅ | ✅ | ✅ | ❌ Node+Postgres+Redis |
| Open source, permissive | ✅ MIT | ✅ MIT | ✅ MIT | ✅ MIT | ⚠️ AGPL |
| Build perf at 52 files | ⚠️ 15-25s cold, <5s warm | ✅ fast (Rspack) | ✅ fastest | ✅ fast | N/A |
| Shipped JS bundle size | ⚠️ heavy | ✅ moderate | ✅ lightest | ✅ moderate | N/A |
| Versioning support | ✅ built-in | ✅ built-in | ⚠️ via sidebars | ✅ built-in | N/A |
| React 19 support | ✅ | ✅ | ⚠️ via integration | ✅ | N/A |
| Migration cost | **0** | Moderate | Moderate-High | Moderate | Prohibitive-shape |

## Migration cost estimate (if we moved)

For any Tier 1 alternative (Fumadocs, Starlight, Nextra), migration involves:

1. **52 MDX files** — mostly portable as-is; frontmatter syntax varies slightly; import paths for in-docs components change.
2. **`sidebars.ts`** — in Docusaurus today, must be ported to each tool's sidebar format (Fumadocs: `meta.json` per folder; Starlight: config file; Nextra: `_meta.json`).
3. **13 redirects** — move from `@docusaurus/plugin-client-redirects` to the target tool's redirect config or host-level redirects.
4. **`src/pages/*.tsx`** — 3-5 custom landing/why/launch pages. Each needs rewriting in the target tool's page model. Non-trivial.
5. **Search index regeneration** — new search tool means first-user search quality is untested until post-deploy.
6. **Broken-link discovery** — Docusaurus's `onBrokenLinks: 'throw'` catches these today. New tool may have different link graph and need re-audit.
7. **Analytics + sitemap + favicon + OG metadata** — all config-per-tool. Non-trivial.
8. **Deploy workflow (`deploy-gcs.yml`)** — currently tied to Docusaurus build output; would need adjusted build commands.
9. **Test surface** — any repo tests that grep or parse `/website-v2/docs/` content (e.g., release-note regression tests) may break depending on output-path changes.
10. **Cross-linking from release notes, CLI output, and marketing posts** — any hardcoded `/docs/foo` URL would need re-verification.

Realistic estimate: **1-2 full agent turns dedicated to migration + 1 turn for post-migration regression fixes**. Not catastrophic, but not free either.

## Recommendation

**Stay on Docusaurus. Do not migrate in this roadmap window.**

Rationale:
1. **Current stack already satisfies OSS-first.** Docusaurus is MIT, self-hosted, zero SaaS dependencies (search is `docusaurus-search-local`, no Algolia), and produces static output deployable to commodity infrastructure. The OSS-first principle is already honored.
2. **No named pain point on the incumbent.** Nothing in AGENT-TALK, HUMAN-ROADMAP, or recent turns points to a concrete Docusaurus limitation that's blocking work. "Evaluate OSS options" is a principle, not a pain report. Migration without a named pain is churn.
3. **Docmost is the wrong shape.** It's a wiki app, not a docs SSG. Including it in the original principle statement was likely a "candidate to examine" nudge rather than a directed recommendation. Examined and rejected for the public docs surface.
4. **Tier 1 competitors are credible but not dramatically better.** Fumadocs and Starlight would modestly improve bundle size and build time, but at a 1-2 turn migration cost plus an ongoing ecosystem-maturity tax (smaller plugin pools, fewer production references). Docusaurus's `@docusaurus/faster` closes most of the build-perf gap. The trade is not yet favorable.
5. **Agent-native authoring is already optimal.** Agents edit MDX and commit. Any migration preserves this; none of the Tier 1 alternatives meaningfully improves it.
6. **52 files is under the breakpoint.** Below ~100 docs, migration pain is moderate; above ~500 docs, pain is severe. We are comfortably in the "can migrate later if ever needed" zone. Doing it now is premature.

## When to re-evaluate

Re-evaluate if any of these land:
1. **Build time > 60s cold on the CI runner.** Currently ~15-25s; acceptable. At 60s, the `@docusaurus/faster` preset is saturating and Rspack/Turbopack-native tools become worth the migration.
2. **A specific Docusaurus limitation blocks a roadmap feature.** E.g., versioning story becomes required for protocol v8+ docs and Docusaurus's versioning is insufficient.
3. **Shipped JS bundle becomes a marketing problem.** If competitors (Fumadocs, Starlight) ship pages with 10x smaller JS and this becomes a visible DX/SEO differentiator.
4. **The agent-native workflow evolves to want a collaborative editing surface.** If agents want a wiki-like realtime-collab surface (not likely for the public product docs, but possible for an internal agent-collaboration knowledge base), re-examine Docmost or similar for that separate surface — do NOT replace the public docs with it.
5. **Docusaurus stagnates or abandons React 19+ support.** Backup plan: Fumadocs is the closest drop-in replacement today; upgrade path is known.

## Open follow-ups (not blocking)

1. **Consider a Docmost-style internal agent knowledge base as a SEPARATE surface** — not as a replacement for `website-v2/`. The agents already use `.planning/*.md` as a git-tracked shared memory; moving any of that to a Docmost instance would fragment the system-of-record. Deferred — not recommended unless the current `.planning/` surface develops concrete pain.
2. **Enable Docusaurus versioning for protocol docs** — `SPEC-GOVERNED-v5.md` and `PROTOCOL-v7.md` live in `.planning/`, but when they graduate to public docs with multiple protocol versions live simultaneously, Docusaurus's built-in versioning becomes the recommended approach. Deferred — not needed yet.
3. **Evaluate Pagefind as a drop-in replacement for `docusaurus-search-local`.** Starlight's search UX is noticeably better. Pagefind is framework-agnostic and could be integrated into Docusaurus as a standalone post-build step. Low-risk experiment if search UX becomes a complaint.

## Non-decisions (deliberately not made here)

- This document does NOT propose a migration. It is a survey with a stay-put recommendation.
- This document does NOT author a DEC. A DEC would only be warranted if (a) a migration is actually chosen, or (b) the stay-put recommendation is challenged and needs durable codification against future relitigation.
- This document does NOT touch BUG-59 or BUG-60 surfaces.
