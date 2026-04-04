# Docs Surface Spec — AgentXchain.dev

> Docusaurus migration, vision alignment, and GCS deployment contract.

---

## Purpose

Ship AgentXchain.dev on a mature OSS docs stack that can serve the current public site and scale to versioned protocol/workflow docs without maintaining a hand-written static HTML system.

## Decisions

**DEC-DOCS-MIGRATION-001**: The public docs surface is migrated from hand-written static HTML to Docusaurus.

**Rationale**: The site is now large enough that standalone HTML pages are a maintenance liability. We need structured docs navigation, MDX authoring, static output, and a credible path to versioned public documentation. Docmost was explicitly rejected because it is the wrong product category for a statically hosted OSS docs site.

**DEC-DOCS-MIGRATION-002**: The migration lands in `website-v2/` first. The legacy `website/` directory remains only as a rollback path until the Docusaurus surface is verified live on the canonical domain.

**DEC-DOCS-MIGRATION-003**: The public site must reflect the current product direction:

- long-horizon coding
- lights-out software factories
- protocol + runners + connectors + integrations + workflows
- explicit `agentxchain.dev` (OSS) vs `agentxchain.ai` (cloud) split
- released version reality (`2.1.1` at the time of this spec update)

**DEC-GCS-DEPLOY-001**: GCS deployment is the primary static hosting path. GitHub Pages remains a fallback/public mirror, not the canonical deployment target.

**DEC-GCS-DEPLOY-002**: Cache policy is enforced after sync, not merely implied during sync. Content-hashed Docusaurus assets receive immutable long-cache headers. HTML and all non-hashed mutable objects receive short-cache headers.

## Site Structure

### Landing pages

- `/` — product landing page
- `/why` — governance thesis / positioning page
- `/compare/vs-crewai`
- `/compare/vs-langgraph`
- `/compare/vs-openai-agents-sdk`

### Docs

- `/docs/quickstart`
- `/docs/cli`
- `/docs/protocol`
- `/docs/protocol-reference`
- `/docs/protocol-implementor-guide`
- `/docs/continuous-delivery-intake`
- `/docs/multi-repo`
- `/docs/protocol-v6`
- `/docs/adapters`
- `/docs/plugins`

### Normative source alias

- `PROTOCOL-v6.md` remains the canonical repo-native markdown source for the current normative protocol text.
- `/docs/protocol` is the stable public alias for the current protocol page.
- `/docs/protocol-reference` is the stable public alias for the current normative reference summary and boundary document.
- `/docs/protocol-v6` is the versioned public permalink for the current normative protocol revision.

## Design Constraints

1. Use a mature OSS static site generator, not a custom HTML-only stack.
2. Preserve clean public URLs without `.html` suffixes where the framework supports it.
3. Keep the site static-output compatible with GCS hosting.
4. Keep the docs/nav/content contract repo-native inside `website-v2/`.
5. Public copy must stay consistent with `.planning/VISION.md`, README, and released product state.

## Deployment Contract

### Build

```bash
cd website-v2
npm ci
npm run build
```

### Sync

1. Sync `build/assets/` to `gs://agentxchain.dev/assets/`
2. Sync the rest of `build/` to `gs://agentxchain.dev/`

### Cache policy

- `gs://agentxchain.dev/assets/**`
  - `Cache-Control: public, max-age=31536000, immutable`
- All other objects in `gs://agentxchain.dev/**`
  - `Cache-Control: public, max-age=300, s-maxage=60`

The important constraint is operational, not theoretical: headers must be corrected even when the object already existed with stale metadata from an earlier deployment regime.

## Behavior

1. Docusaurus is the only supported authoring/build path for the public docs surface.
2. Release/version references on the landing page must match the latest canonical released version.
3. Public docs URLs in README and linked surfaces must use the Docusaurus route structure.
4. Deployment scripts/workflows must not rely on cache-busting query strings when the build already emits hashed asset filenames.
5. Deployment verification must inspect the bucket after upload, not stop at local build success.
6. The docs surface must preserve the stable protocol overview alias (`/docs/protocol`), the stable protocol reference alias (`/docs/protocol-reference`), and the versioned permalink (`/docs/protocol-v6`) while the repo-native normative source remains `PROTOCOL-v6.md`.

## Acceptance Tests

1. `cd website-v2 && npm run build` succeeds with no broken links.
2. The generated site includes the expected landing, docs, and comparison routes.
3. `README.md` links point at the clean Docusaurus routes.
4. `gsutil stat gs://agentxchain.dev/index.html` shows short-cache metadata after deployment.
5. At least one object under `gs://agentxchain.dev/assets/` shows immutable long-cache metadata after deployment.
6. The landing page copy explicitly references long-horizon coding, lights-out software factories, and the `.dev` vs `.ai` split.
7. The docs/planning surface keeps `PROTOCOL-v6.md`, `/docs/protocol`, and `/docs/protocol-v6` aligned as the current normative protocol references.

## Open Questions

1. When the Docusaurus migration is fully verified in production, should `website-v2/` replace `website/` in-place or remain versioned as the canonical directory?
2. When docs volume increases further, do we introduce Docusaurus versioned docs or keep a single moving docs set plus protocol-version pages?
