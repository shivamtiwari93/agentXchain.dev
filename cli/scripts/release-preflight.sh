#!/usr/bin/env bash
# Release preflight — run this before cutting a release.
# Verifies: clean tree, deps, tests, CHANGELOG entry, pack dry-run.
# Usage: bash scripts/release-preflight.sh [--strict] [--target-version <semver>]
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
CLI_DIR="${SCRIPT_DIR}/.."
cd "$CLI_DIR"

STRICT_MODE=0
TARGET_VERSION="2.0.0"

usage() {
  echo "Usage: bash scripts/release-preflight.sh [--strict] [--target-version <semver>]" >&2
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --strict)
      STRICT_MODE=1
      shift
      ;;
    --target-version)
      if [[ -z "${2:-}" ]]; then
        echo "Error: --target-version requires a semver argument" >&2
        usage
        exit 1
      fi
      if ! [[ "$2" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
        echo "Invalid semver: $2" >&2
        usage
        exit 1
      fi
      TARGET_VERSION="$2"
      shift 2
      ;;
    *)
      usage
      exit 1
      ;;
  esac
done

PASS=0
FAIL=0
WARN=0

pass() { PASS=$((PASS + 1)); echo "  PASS: $1"; }
fail() { FAIL=$((FAIL + 1)); echo "  FAIL: $1"; }
warn() { WARN=$((WARN + 1)); echo "  WARN: $1"; }

run_and_capture() {
  local __var_name="$1"
  shift

  local output
  local status
  output="$("$@" 2>&1)"
  status=$?

  printf -v "$__var_name" '%s' "$output"
  return "$status"
}

echo "AgentXchain v${TARGET_VERSION} Release Preflight"
echo "====================================="
if [[ "$TARGET_VERSION" == "1.0.0" ]]; then
  echo "Local checks only. Human-gated release items remain in .planning/V1_RELEASE_CHECKLIST.md."
else
  echo "Local checks only. Human-gated release items remain in .planning/V1_RELEASE_CHECKLIST.md (v1.0) or .planning/V1_1_RELEASE_CHECKLIST.md (v1.1+)."
fi
if [[ "$STRICT_MODE" -eq 1 ]]; then
  echo "Mode: STRICT (dirty tree and non-${TARGET_VERSION} package version are hard failures)"
else
  echo "Mode: DEFAULT (dirty tree and pre-bump package version are warnings)"
fi
echo ""

# 1. Clean working tree
echo "[1/6] Git status"
if git diff --quiet HEAD 2>/dev/null && [ -z "$(git ls-files --others --exclude-standard 2>/dev/null)" ]; then
  pass "Working tree is clean"
else
  if [[ "$STRICT_MODE" -eq 1 ]]; then
    fail "Working tree is not clean"
  else
    warn "Uncommitted or untracked files present"
  fi
fi

# 2. Dependencies
echo "[2/6] Dependencies"
if run_and_capture NPM_CI_OUTPUT npm ci --ignore-scripts; then
  pass "npm ci succeeded"
else
  fail "npm ci failed"
  printf '%s\n' "$NPM_CI_OUTPUT" | tail -20
fi

# 3. Tests
echo "[3/6] Test suite"
# Install MCP example deps — tests start example servers as subprocesses
for example_dir in "${CLI_DIR}/../examples/mcp-echo-agent" "${CLI_DIR}/../examples/mcp-http-echo-agent"; do
  if [[ -f "${example_dir}/package.json" && ! -d "${example_dir}/node_modules" ]]; then
    echo "  Installing deps for $(basename "$example_dir")..."
    (cd "$example_dir" && env -u NODE_AUTH_TOKEN -u NPM_CONFIG_USERCONFIG npm install --ignore-scripts --userconfig /dev/null 2>&1) || true
  fi
done
if run_and_capture TEST_OUTPUT env AGENTXCHAIN_RELEASE_TARGET_VERSION="${TARGET_VERSION}" AGENTXCHAIN_RELEASE_PREFLIGHT=1 npm test; then
  TEST_STATUS=0
else
  TEST_STATUS=$?
fi
TEST_PASS="$(printf '%s\n' "$TEST_OUTPUT" | awk '/^# pass / { print $3 }')"
TEST_FAIL="$(printf '%s\n' "$TEST_OUTPUT" | awk '/^# fail / { print $3 }')"
if [ "$TEST_STATUS" -eq 0 ] && [ "${TEST_FAIL:-0}" = "0" ]; then
  pass "${TEST_PASS} tests passed, 0 failures"
else
  fail "npm test failed"
  printf '%s\n' "$TEST_OUTPUT" | tail -20
fi

# 4. CHANGELOG has target version
echo "[4/6] CHANGELOG"
if grep -Fxq "## ${TARGET_VERSION}" CHANGELOG.md 2>/dev/null; then
  pass "CHANGELOG.md contains ${TARGET_VERSION} entry"
else
  fail "CHANGELOG.md missing ${TARGET_VERSION} entry"
fi

# 5. Package version
echo "[5/6] Package version"
PKG_VERSION=$(node -e "console.log(JSON.parse(require('fs').readFileSync('package.json','utf8')).version)")
echo "  Current version: ${PKG_VERSION}"
if [ "$PKG_VERSION" = "${TARGET_VERSION}" ]; then
  pass "package.json is at ${TARGET_VERSION}"
else
  if [[ "$STRICT_MODE" -eq 1 ]]; then
    fail "package.json is at ${PKG_VERSION}, expected ${TARGET_VERSION}"
  else
    warn "package.json is at ${PKG_VERSION}, not yet bumped to ${TARGET_VERSION}"
  fi
fi

# 6. Pack dry-run
echo "[6/6] npm pack --dry-run"
if run_and_capture PACK_OUTPUT npm pack --dry-run; then
  pass "npm pack --dry-run succeeded"
  PACK_SIZE_LINE="$(printf '%s\n' "$PACK_OUTPUT" | awk '/total files:/ { print; found=1 } END { if (!found) exit 1 }')"
  if [ -n "${PACK_SIZE_LINE:-}" ]; then
    echo "  ${PACK_SIZE_LINE}"
  else
    printf '%s\n' "$PACK_OUTPUT" | tail -5
  fi
else
  fail "npm pack --dry-run failed"
  printf '%s\n' "$PACK_OUTPUT" | tail -20
fi

# Summary
echo ""
echo "====================================="
echo "Results: ${PASS} passed, ${FAIL} failed, ${WARN} warnings"
if [ "$FAIL" -gt 0 ]; then
  echo "PREFLIGHT FAILED — fix failures before release."
  exit 1
elif [ "$WARN" -gt 0 ]; then
  echo "PREFLIGHT PASSED WITH WARNINGS — resolve warnings before release day."
  exit 0
else
  echo "PREFLIGHT PASSED — ready for release."
  exit 0
fi
