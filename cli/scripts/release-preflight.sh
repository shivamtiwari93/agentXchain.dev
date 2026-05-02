#!/usr/bin/env bash
# Release preflight — run this before cutting a release.
# Verifies: clean tree, deps, tests, CHANGELOG entry, pack dry-run.
# Usage: bash scripts/release-preflight.sh [--strict] [--target-version <semver>]
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
CLI_DIR="${SCRIPT_DIR}/.."
cd "$CLI_DIR"

STRICT_MODE=0
PUBLISH_GATE=0
DRY_RUN=0
TARGET_VERSION="2.0.0"

usage() {
  echo "Usage: bash scripts/release-preflight.sh [--strict] [--publish-gate] [--dry-run] [--target-version <semver>]" >&2
  echo "  --publish-gate  Run only release-critical checks (no full test suite). Use in CI publish workflows." >&2
  echo "  --dry-run       Preview manual release-alignment surfaces without running the full gate." >&2
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --strict)
      STRICT_MODE=1
      shift
      ;;
    --publish-gate)
      PUBLISH_GATE=1
      STRICT_MODE=1
      shift
      ;;
    --dry-run)
      DRY_RUN=1
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

if [[ "$DRY_RUN" -eq 1 && "$STRICT_MODE" -eq 1 ]]; then
  echo "Error: --dry-run cannot be combined with --strict or --publish-gate" >&2
  usage
  exit 1
fi

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

if [[ "$DRY_RUN" -eq 1 ]]; then
  echo "Release Preflight Preview"
  echo "========================="
  echo "Mode: DRY RUN (manual release-alignment surfaces only; no git/npm gate checks executed)"
  echo ""
  ALIGNMENT_SCRIPT="${SCRIPT_DIR}/check-release-alignment.mjs"
  if [[ ! -f "$ALIGNMENT_SCRIPT" ]]; then
    echo "Error: release alignment preview requires ${ALIGNMENT_SCRIPT}" >&2
    exit 1
  fi
  if run_and_capture ALIGNMENT_REPORT node "$ALIGNMENT_SCRIPT" --scope prebump --target-version "$TARGET_VERSION" --report; then
    ALIGNMENT_STATUS=0
  else
    ALIGNMENT_STATUS=$?
  fi
  printf '%s\n' "$ALIGNMENT_REPORT"
  echo ""
  if [[ "$ALIGNMENT_STATUS" -eq 0 ]]; then
    echo "PREVIEW COMPLETE: manual release-alignment surfaces are ready for ${TARGET_VERSION}."
  else
    echo "PREVIEW COMPLETE: manual release-alignment surfaces still need updates before a real preflight/tag push."
  fi
  exit 0
fi

# 1. Clean working tree
echo "[1/7] Git status"
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
echo "[2/7] Dependencies"
if run_and_capture NPM_CI_OUTPUT npm ci --ignore-scripts; then
  pass "npm ci succeeded"
else
  fail "npm ci failed"
  printf '%s\n' "$NPM_CI_OUTPUT" | tail -20
fi

# 3. Tests
if [[ "$PUBLISH_GATE" -eq 1 ]]; then
  echo "[3/7] Release-gate tests (targeted subset)"
  # In publish-gate mode, run only release-critical tests to avoid CI hangs.
  # The full test suite is a pre-tag responsibility, not a publish-time gate.
  GATE_TEST_PATTERNS=(
    test/release-preflight.test.js
    test/release-docs-content.test.js
    test/release-notes-gate.test.js
    test/release-identity-hardening.test.js
    test/normalized-config.test.js
    test/protocol-conformance.test.js
    test/beta-scenario-emission-guard.test.js
    test/claim-reality-preflight.test.js
    test/beta-tester-scenarios/*.test.js
  )
  GATE_TEST_ARGS=()
  shopt -s nullglob
  for pattern in "${GATE_TEST_PATTERNS[@]}"; do
    for t in $pattern; do
      GATE_TEST_ARGS+=("$t")
    done
  done
  shopt -u nullglob
  if [[ ${#GATE_TEST_ARGS[@]} -eq 0 ]]; then
    fail "No release-gate test files found"
  else
    BETA_TEST_COUNT=0
    for t in "${GATE_TEST_ARGS[@]}"; do
      if [[ "$t" == test/beta-tester-scenarios/*.test.js ]]; then
        BETA_TEST_COUNT=$((BETA_TEST_COUNT + 1))
      fi
    done
    if [[ "$BETA_TEST_COUNT" -eq 0 ]]; then
      fail "No beta-tester scenario tests found for release-gate verification"
      TEST_OUTPUT=""
      TEST_STATUS=1
    elif run_and_capture TEST_OUTPUT env AGENTXCHAIN_RELEASE_TARGET_VERSION="${TARGET_VERSION}" AGENTXCHAIN_RELEASE_PREFLIGHT=1 npm test -- "${GATE_TEST_ARGS[@]}"; then
      TEST_STATUS=0
    else
      TEST_STATUS=$?
    fi
    VITEST_PASS="$(printf '%s\n' "$TEST_OUTPUT" | awk '/^[[:space:]]*Tests[[:space:]]+[0-9]+[[:space:]]+passed/ { for (i = 1; i <= NF; i++) if ($i ~ /^[0-9]+$/) { print $i; exit } }')"
    VITEST_FAIL="$(printf '%s\n' "$TEST_OUTPUT" | awk '/^[[:space:]]*Tests[[:space:]]+[0-9]+[[:space:]]+failed/ { for (i = 1; i <= NF; i++) if ($i ~ /^[0-9]+$/) { print $i; exit } }')"
    if [ "$TEST_STATUS" -eq 0 ] && [ "${VITEST_FAIL:-0}" = "0" ]; then
      pass "${VITEST_PASS:-?} release-gate tests passed, 0 failures"
    else
      fail "Release-gate tests failed"
      printf '%s\n' "$TEST_OUTPUT" | tail -20
    fi
  fi
else
  echo "[3/7] Test suite"
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
  if [ -z "${TEST_PASS:-}" ]; then
    VITEST_PASS="$(printf '%s\n' "$TEST_OUTPUT" | awk '/^[[:space:]]*Tests[[:space:]]+[0-9]+[[:space:]]+passed/ { for (i = 1; i <= NF; i++) if ($i ~ /^[0-9]+$/) { print $i; exit } }')"
    NODE_PASS="$(printf '%s\n' "$TEST_OUTPUT" | awk '/^ℹ tests / { print $3; exit }')"
    if [ -n "${VITEST_PASS:-}" ] && [ -n "${NODE_PASS:-}" ]; then
      TEST_PASS="$((VITEST_PASS + NODE_PASS))"
    elif [ -n "${NODE_PASS:-}" ]; then
      TEST_PASS="${NODE_PASS}"
    elif [ -n "${VITEST_PASS:-}" ]; then
      TEST_PASS="${VITEST_PASS}"
    fi
  fi
  if [ -z "${TEST_FAIL:-}" ]; then
    NODE_FAIL="$(printf '%s\n' "$TEST_OUTPUT" | awk '/^ℹ fail / { print $3; exit }')"
    if [ -n "${NODE_FAIL:-}" ]; then
      TEST_FAIL="${NODE_FAIL}"
    elif printf '%s\n' "$TEST_OUTPUT" | grep -Eq '^[[:space:]]*Tests[[:space:]]+[0-9]+[[:space:]]+passed'; then
      TEST_FAIL=0
    fi
  fi
  if [ "$TEST_STATUS" -eq 0 ] && [ "${TEST_FAIL:-0}" = "0" ]; then
    if [ -n "${TEST_PASS:-}" ]; then
      pass "${TEST_PASS} tests passed, 0 failures"
    else
      pass "npm test passed, 0 failures"
    fi
  else
    fail "npm test failed"
    printf '%s\n' "$TEST_OUTPUT" | tail -20
  fi
fi

# 4. CHANGELOG has target version
echo "[4/7] CHANGELOG"
if grep -Fxq "## ${TARGET_VERSION}" CHANGELOG.md 2>/dev/null; then
  pass "CHANGELOG.md contains ${TARGET_VERSION} entry"
else
  fail "CHANGELOG.md missing ${TARGET_VERSION} entry"
fi

# 5. Package version
echo "[5/7] Package version"
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

# 6. Release-alignment surfaces (shared manifest)
echo "[6/7] Release alignment (shared manifest)"
ALIGNMENT_SCRIPT="${SCRIPT_DIR}/check-release-alignment.mjs"
if [[ -f "$ALIGNMENT_SCRIPT" ]]; then
  if run_and_capture ALIGNMENT_OUTPUT node "$ALIGNMENT_SCRIPT" --scope current --target-version "$TARGET_VERSION"; then
    ALIGNED_COUNT="$(printf '%s\n' "$ALIGNMENT_OUTPUT" | awk -F'[,)]' '/surfaces/ { for (i=1;i<=NF;i++) if ($i ~ /[0-9]+ surfaces/) { gsub(/[^0-9]/,"",$i); print $i; exit } }')"
    pass "Release alignment OK (${ALIGNED_COUNT:-all} surfaces)"
  else
    fail "Release alignment failed"
    printf '%s\n' "$ALIGNMENT_OUTPUT" | head -20
  fi
else
  warn "check-release-alignment.mjs not found — skipping manifest validation"
fi

# 7. Pack dry-run
echo "[7/7] npm pack --dry-run"
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
