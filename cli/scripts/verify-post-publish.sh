#!/usr/bin/env bash
# Post-publish repo-mirror verification — the executable contract that
# ensures main is green after a release publish completes.
#
# Three-phase Homebrew lifecycle:
#   Phase 1 (pre-publish):  formula URL updated, SHA carried from previous version
#   Phase 2 (post-publish): npm live, but repo mirror SHA is stale
#   Phase 3 (post-sync):    repo mirror SHA matches published tarball — main is green
#
# This script transitions from Phase 2 → Phase 3 and verifies the result.
#
# Usage: bash scripts/verify-post-publish.sh [--target-version <semver>]
#   If --target-version is omitted, reads from package.json.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
CLI_DIR="${SCRIPT_DIR}/.."
cd "$CLI_DIR"

TARGET_VERSION=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --target-version)
      if [[ -z "${2:-}" ]]; then
        echo "Error: --target-version requires a semver argument" >&2
        exit 1
      fi
      TARGET_VERSION="$2"
      shift 2
      ;;
    *)
      echo "Unknown argument: $1" >&2
      exit 1
      ;;
  esac
done

if [[ -z "$TARGET_VERSION" ]]; then
  TARGET_VERSION="$(node -e "console.log(JSON.parse(require('fs').readFileSync('package.json','utf8')).version)")"
fi

echo "Post-Publish Verification: v${TARGET_VERSION}"
echo "============================================="
echo ""

# Step 1: Verify npm serves the version
echo "[1/4] Checking npm registry..."
NPM_VERSION="$(npm view "agentxchain@${TARGET_VERSION}" version 2>/dev/null || echo "")"
if [[ "$NPM_VERSION" != "$TARGET_VERSION" ]]; then
  echo "  FAIL: npm does not serve agentxchain@${TARGET_VERSION} (got: '${NPM_VERSION}')"
  echo "  This script must run AFTER npm publish completes."
  exit 1
fi
echo "  OK: npm serves v${TARGET_VERSION}"

# Step 2: Sync the repo mirror to the published tarball
echo "[2/4] Syncing repo mirror to published tarball..."
bash "${SCRIPT_DIR}/sync-homebrew.sh" --target-version "$TARGET_VERSION"
echo "  OK: repo mirror synced"

# Step 3: Run the full test suite WITHOUT the preflight skip
echo "[3/4] Running full test suite (no preflight skip)..."
echo "  This verifies the Homebrew mirror contract passes with the real SHA."
npm test
echo "  OK: full test suite green"

# Step 4: Summary
echo ""
echo "============================================="
echo "Post-publish verification PASSED."
echo "  - npm: agentxchain@${TARGET_VERSION} live"
echo "  - repo mirror: SHA synced to published tarball"
echo "  - test suite: green without preflight skip"
echo ""
echo "Main is now in Phase 3 (post-sync). Commit and push the mirror update."
