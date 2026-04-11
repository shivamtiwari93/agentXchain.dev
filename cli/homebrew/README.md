# Homebrew distribution for AgentXchain

## For users

```bash
brew tap shivamtiwari93/tap
brew install agentxchain
```

## Current packaging model

The canonical Homebrew tap lives in `shivamtiwari93/homebrew-tap`.

This folder mirrors the current tap formula inside the main repo so release docs and maintainer guidance stay auditable next to the code. It must match the released npm artifact and the canonical tap formula.

The tap currently installs the published npm package using Homebrew's `node` dependency instead of binary release assets.

Current formula target:

- package: `agentxchain`
- version: `2.55.0`
- source tarball: `https://registry.npmjs.org/agentxchain/-/agentxchain-2.55.0.tgz`

## For maintainers: how to update the tap

1. Publish a new npm version of `agentxchain`.
2. Fetch the new tarball URL from npm.
3. Compute the new tarball SHA256.
4. Update `Formula/agentxchain.rb` in `shivamtiwari93/homebrew-tap`.
5. Mirror the same version and tarball URL in `cli/homebrew/agentxchain.rb` and this README.
6. Commit and push both repos.

## Tap repo

The tap repo is:

- `https://github.com/shivamtiwari93/homebrew-tap`

Users can install with:

```bash
brew tap shivamtiwari93/tap
brew install agentxchain
agentxchain --version
```

---

## IMPORTANT: Unified tap for all tools

> **For AI agents and maintainers:** `shivamtiwari93/homebrew-tap` is the
> **single unified Homebrew tap** for ALL tools, not just agentxchain. Other formulas
> in this tap include:
>
> - `Formula/agentxchain.rb` — AgentXchain CLI (npm package)
> - `Formula/x-browser.rb` — x-browser CLI (Python, browser-based X/Twitter automation)
>
> **Do NOT create separate `homebrew-*` repos for new formulas.** Add new formulas
> as new `.rb` files under `Formula/` in the same tap repo. The tap name
> `shivamtiwari93/tap` is kept for backwards compatibility.
>
> The repo was renamed from `homebrew-agentxchain` to `homebrew-tap` to reflect
> that it holds formulas for all projects, not just agentxchain.
