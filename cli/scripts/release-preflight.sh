#!/usr/bin/env bash
# Release preflight — run this before cutting v1.0.0.
# Verifies: clean tree, deps, tests, CHANGELOG entry, pack dry-run.
# Usage: bash scripts/release-preflight.sh
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
CLI_DIR="${SCRIPT_DIR}/.."
cd "$CLI_DIR"

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

echo "AgentXchain v1.0.0 Release Preflight"
echo "====================================="
echo "Local checks only. Human-gated release items remain in .planning/V1_RELEASE_CHECKLIST.md."
echo ""

# 1. Clean working tree
echo "[1/6] Git status"
if git diff --quiet HEAD 2>/dev/null && [ -z "$(git ls-files --others --exclude-standard 2>/dev/null)" ]; then
  pass "Working tree is clean"
else
  warn "Uncommitted or untracked files present"
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
if run_and_capture TEST_OUTPUT npm test; then
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

# 4. CHANGELOG has 1.0.0
echo "[4/6] CHANGELOG"
if grep -q "^## 1.0.0" CHANGELOG.md 2>/dev/null; then
  pass "CHANGELOG.md contains 1.0.0 entry"
else
  fail "CHANGELOG.md missing 1.0.0 entry"
fi

# 5. Package version
echo "[5/6] Package version"
PKG_VERSION=$(node -e "console.log(JSON.parse(require('fs').readFileSync('package.json','utf8')).version)")
echo "  Current version: ${PKG_VERSION}"
if [ "$PKG_VERSION" = "1.0.0" ]; then
  pass "package.json is at 1.0.0"
else
  warn "package.json is at ${PKG_VERSION}, not yet bumped to 1.0.0"
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
