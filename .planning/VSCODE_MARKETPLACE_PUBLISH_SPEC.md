# VS Code Marketplace Publish Spec

## Purpose

Publish the AgentXchain VS Code extension to the Visual Studio Marketplace so operators can install it via `ext install agentxchain.agentxchain` or the Extensions panel.

## Current State

- Extension source: `cli/vscode-extension/`
- Publisher: `agentxchain` (declared in `package.json`)
- Version: `0.1.0`
- VSIX packaging re-verified on 2026-04-10: 76 files, 65.59 KB via `npm run compile && npx @vscode/vsce package --no-dependencies`
- 12 commands, governed + legacy mode support
- Icon: `media/icon.png` (128x128)
- Repo secret audit on 2026-04-10: `VSCE_PAT` is absent from `gh secret list --repo shivamtiwari93/agentXchain.dev`
- Publish is therefore blocked on Marketplace credentials and publisher access, not on extension packaging

## Human-Only Prerequisites

1. **Create Azure DevOps organization** (if not exists) at https://dev.azure.com/
2. **Create VS Marketplace publisher** `agentxchain` at https://marketplace.visualstudio.com/manage/publishers
3. **Generate a Personal Access Token (PAT)** with scope `Marketplace > Manage`
4. **Add `VSCE_PAT` to GitHub repo secrets** so CI can publish automatically

## Agent-Deliverable Prep (this spec)

### Acceptance Tests

- AT-VSMP-001: `.vscodeignore` exists and excludes dev-only files (src/, tsconfig, node_modules, *.vsix)
- AT-VSMP-002: `CHANGELOG.md` exists in extension directory with at least the 0.1.0 entry
- AT-VSMP-003: `npm run compile && npx @vscode/vsce package` produces a clean VSIX with no warnings
- AT-VSMP-004: CI workflow `.github/workflows/publish-vscode-on-tag.yml` exists and triggers on `vsce-v*` tags
- AT-VSMP-005: CI workflow uses `VSCE_PAT` secret for authentication
- AT-VSMP-006: Extension README has marketplace-friendly structure (features, commands, requirements)
- AT-VSMP-007: `package.json` has `galleryBanner` for marketplace appearance
- AT-VSMP-008: Extension categories include relevant marketplace categories
- AT-VSMP-009: A code-backed repo test guards the marketplace-ready surface (package metadata, README structure, `.vscodeignore`, changelog, and publish workflow)

## Open Questions

- Should the extension version track the CLI version or have its own versioning?
  Decision: own versioning (0.x.y) — the extension is a separate artifact with different release cadence.
- Should we also publish to Open VSX (for VS Code forks like VSCodium)?
  Decision: defer — marketplace first, Open VSX as follow-up.
