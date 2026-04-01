# Homebrew distribution for AgentXchain

## For users

```bash
brew tap shivamtiwari93/agentxchain
brew install agentxchain
```

## Current packaging model

The tap currently installs the published npm package using Homebrew's `node` dependency instead of binary release assets.

Current formula target:

- package: `agentxchain`
- version: `0.8.8`
- source tarball: `https://registry.npmjs.org/agentxchain/-/agentxchain-0.8.8.tgz`

## For maintainers: how to update the tap

1. Publish a new npm version of `agentxchain`.
2. Fetch the new tarball URL from npm.
3. Compute the new tarball SHA256.
4. Update `Formula/agentxchain.rb` in `shivamtiwari93/homebrew-agentxchain`.
5. Commit and push the tap repo.

## Tap repo

The tap repo is:

- `https://github.com/shivamtiwari93/homebrew-agentxchain`

Users can install with:

```bash
brew tap shivamtiwari93/agentxchain
brew install agentxchain
agentxchain --version
```
