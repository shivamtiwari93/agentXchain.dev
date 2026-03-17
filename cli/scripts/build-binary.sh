#!/usr/bin/env bash
# Build standalone binaries for macOS and Linux using Bun.
# Requires: bun (install via `brew install oven-sh/bun/bun`)
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
CLI_DIR="${SCRIPT_DIR}/.."
cd "$CLI_DIR"

VERSION=$(node -e "console.log(require('./package.json').version)")
DIST="$CLI_DIR/dist"
mkdir -p "$DIST"

echo "Building agentxchain v${VERSION}..."
echo ""

echo "=== macOS arm64 ==="
bun build bin/agentxchain.js --compile --target=bun-darwin-arm64 --outfile="$DIST/agentxchain-macos-arm64"
echo "  → $DIST/agentxchain-macos-arm64"

echo ""
echo "=== macOS x64 ==="
bun build bin/agentxchain.js --compile --target=bun-darwin-x64 --outfile="$DIST/agentxchain-macos-x64"
echo "  → $DIST/agentxchain-macos-x64"

echo ""
echo "=== Linux x64 ==="
bun build bin/agentxchain.js --compile --target=bun-linux-x64 --outfile="$DIST/agentxchain-linux-x64"
echo "  → $DIST/agentxchain-linux-x64"

echo ""
echo "Creating tarballs..."
cd "$DIST"
tar -czf "agentxchain-${VERSION}-macos-arm64.tar.gz" agentxchain-macos-arm64
tar -czf "agentxchain-${VERSION}-macos-x64.tar.gz" agentxchain-macos-x64
tar -czf "agentxchain-${VERSION}-linux-x64.tar.gz" agentxchain-linux-x64

echo ""
echo "Done. Upload these to a GitHub release, then update the Homebrew formula with the URLs and SHA256 hashes."
echo ""
echo "SHA256 hashes:"
shasum -a 256 *.tar.gz
