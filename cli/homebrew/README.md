# Homebrew distribution for AgentXchain

## For users

```bash
brew tap shivamtiwari93/agentxchain
brew install agentxchain
```

## For maintainers: how to release

1. Build binaries:
   ```bash
   cd cli/
   bash scripts/build-binary.sh
   ```

2. Create a GitHub release on `agentXchain.dev` repo (e.g. `v0.1.0`).

3. Upload the `.tar.gz` files from `cli/dist/` to the release.

4. Copy the SHA256 hashes from the build output.

5. Create a GitHub repo: `shivamtiwari93/homebrew-agentxchain`
   - Add one file: `Formula/agentxchain.rb` (copy from `cli/homebrew/agentxchain.rb`)
   - Replace `REPLACE_WITH_ACTUAL_SHA256` with the real hashes
   - Replace the URLs if the release tag is different

6. Users can now:
   ```bash
   brew tap shivamtiwari93/agentxchain
   brew install agentxchain
   agentxchain --version
   ```

## Requirements for building

- [Bun](https://bun.sh) — `brew install oven-sh/bun/bun`
- Bun can cross-compile, so you can build all targets from macOS.
