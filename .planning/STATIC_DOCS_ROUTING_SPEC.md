# Static Docs Routing Spec

> **Status: SUPERSEDED** — This spec applied to the retired `website/` flat-HTML surface. The docs system migrated to Docusaurus (`website-v2/`) per `DEC-DOCS-MIGRATION-001`. Docusaurus handles routing natively via clean URLs (`/docs/quickstart/`, `/docs/adapters/`, etc.) and the build output deploys to GCS via `deploy-gcs.yml`. The `.html` extension contract described below no longer applies.

---

## Original Decision (Historical)

**DEC-DOCS-ROUTING-001**: Internal site links used explicit `.html` doc targets when the site was a flat-file static surface under `website/`. This decision was superseded by the Docusaurus migration, which generates clean URLs and handles routing internally.

## Current Contract

- Docs source: `website-v2/docs/*.mdx`
- Landing pages: `website-v2/src/pages/*.tsx` and `website-v2/src/pages/**/*.mdx`
- Build: `cd website-v2 && npm run build` → `website-v2/build/`
- Deploy: GitHub Actions `deploy-gcs.yml` and `deploy-pages.yml`
- URL format: `/docs/<page>/` (Docusaurus clean URLs, no `.html` extension needed)
