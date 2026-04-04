# AgentXchain.dev Website

Public website and docs for `agentxchain.dev`, built with Docusaurus and deployed as static assets.

## Purpose

- Landing page aligned to `.planning/VISION.md`
- Public docs and comparison pages
- Static build output for GCS and GitHub Pages

## Local development

```bash
cd website-v2
npm ci
npm start
```

## Production build

```bash
cd website-v2
npm ci
npm run build
```

Build output is written to `website-v2/build/`.

## Deployment

Canonical production deploy is the GitHub Actions workflow:

```bash
.github/workflows/deploy-gcs.yml
```

It deploys `website-v2/build/` to the `agentxchain.dev` GCS bucket and is triggered by:

- pushes to `main` that change `website-v2/**`
- manual `workflow_dispatch`

The GCS workflow enforces:

- hashed assets under `build/assets/` get immutable long-cache headers
- HTML and other mutable files get short-cache headers
- `agentxchain.dev` is the canonical bucket

GitHub Pages remains a mirror through:

```bash
.github/workflows/deploy-pages.yml
```

It builds the same `website-v2/build/` output and supports the same two trigger modes:

- pushes to `main` that change `website-v2/**`
- manual `workflow_dispatch`
