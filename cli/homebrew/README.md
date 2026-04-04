# Homebrew distribution for AgentXchain

## For users

```bash
brew tap shivamtiwari93/agentxchain
brew install agentxchain
```

## Current packaging model

The canonical Homebrew tap lives in `shivamtiwari93/homebrew-agentxchain`.

This folder mirrors the current tap formula inside the main repo so release docs and maintainer guidance stay auditable next to the code. It must match the released npm artifact and the canonical tap formula.

The tap currently installs the published npm package using Homebrew's `node` dependency instead of binary release assets.

Current formula target:

- package: `agentxchain`
- version: `2.11.0`
- source tarball: `https://registry.npmjs.org/agentxchain/-/agentxchain-2.11.0.tgz`

## For maintainers: how to update the tap

1. Publish a new npm version of `agentxchain`.
2. Fetch the new tarball URL from npm.
3. Compute the new tarball SHA256.
4. Update `Formula/agentxchain.rb` in `shivamtiwari93/homebrew-agentxchain`.
5. Mirror the same version and tarball URL in `cli/homebrew/agentxchain.rb` and this README.
6. Commit and push both repos.

## Tap repo

The tap repo is:

- `https://github.com/shivamtiwari93/homebrew-agentxchain`

Users can install with:

```bash
brew tap shivamtiwari93/agentxchain
brew install agentxchain
agentxchain --version
```
