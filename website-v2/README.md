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

Primary deployment target is GCS via the shared helper:

```bash
cd /Users/shivamtiwari.highlevel/VS Code/1008apps
bash deploy-websites.sh
```

The deploy path assumes:

- hashed assets under `build/assets/` get immutable long-cache headers
- HTML and other mutable files get short-cache headers
- `agentxchain.dev` is the canonical bucket

GitHub Pages remains a fallback mirror through `.github/workflows/deploy-pages.yml`.
