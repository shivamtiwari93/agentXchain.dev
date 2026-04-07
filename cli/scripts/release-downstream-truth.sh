#!/usr/bin/env bash
# Release downstream truth — run after all downstream surfaces are updated.
# Verifies: GitHub release exists, Homebrew tap SHA and URL match registry tarball.
# Usage: bash scripts/release-downstream-truth.sh --target-version <semver>
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
CLI_DIR="${SCRIPT_DIR}/.."
REPO_ROOT="${CLI_DIR}/.."
cd "$CLI_DIR"

TARGET_VERSION=""
RETRY_ATTEMPTS="${RELEASE_DOWNSTREAM_RETRY_ATTEMPTS:-3}"
RETRY_DELAY_SECONDS="${RELEASE_DOWNSTREAM_RETRY_DELAY_SECONDS:-5}"

usage() {
  echo "Usage: bash scripts/release-downstream-truth.sh --target-version <semver>" >&2
}

while [[ $# -gt 0 ]]; do
  case "$1" in
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

if [[ -z "$TARGET_VERSION" ]]; then
  echo "Error: --target-version is required" >&2
  usage
  exit 1
fi

PACKAGE_NAME="$(node -e "console.log(JSON.parse(require('fs').readFileSync('package.json', 'utf8')).name)")"
CANONICAL_HOMEBREW_FORMULA_URL="${AGENTXCHAIN_DOWNSTREAM_FORMULA_URL:-https://raw.githubusercontent.com/shivamtiwari93/homebrew-tap/main/Formula/agentxchain.rb}"
CANONICAL_HOMEBREW_FORMULA_REPO="${AGENTXCHAIN_DOWNSTREAM_FORMULA_REPO:-https://github.com/shivamtiwari93/homebrew-tap.git}"
CANONICAL_HOMEBREW_FORMULA_PATH="${AGENTXCHAIN_DOWNSTREAM_FORMULA_PATH:-Formula/agentxchain.rb}"

PASS=0
FAIL=0

pass() { PASS=$((PASS + 1)); echo "  PASS: $1"; }
fail() { FAIL=$((FAIL + 1)); echo "  FAIL: $1"; }

fetch_formula_content() {
  local content=""
  if [[ -n "${AGENTXCHAIN_DOWNSTREAM_FORMULA_URL:-}" ]]; then
    content="$(curl -fsSL "$CANONICAL_HOMEBREW_FORMULA_URL" 2>/dev/null || true)"
    printf '%s' "$content"
    return 0
  fi

  if ! command -v git >/dev/null 2>&1; then
    printf ''
    return 0
  fi

  local tmpdir
  tmpdir="$(mktemp -d)"
  if git clone --depth 1 "$CANONICAL_HOMEBREW_FORMULA_REPO" "$tmpdir" >/dev/null 2>&1; then
    if [[ -f "$tmpdir/$CANONICAL_HOMEBREW_FORMULA_PATH" ]]; then
      content="$(cat "$tmpdir/$CANONICAL_HOMEBREW_FORMULA_PATH")"
    fi
  fi
  rm -rf "$tmpdir"
  printf '%s' "$content"
}

echo "AgentXchain v${TARGET_VERSION} Downstream Release Truth"
echo "====================================="
echo "Checks downstream surfaces after publish: GitHub release, canonical Homebrew tap."
echo ""

# --- Check 1: GitHub Release ---
echo "[1/3] GitHub release"
if ! command -v gh >/dev/null 2>&1; then
  fail "gh CLI not available — cannot verify GitHub release"
else
  GH_FOUND=false
  for attempt in $(seq 1 "$RETRY_ATTEMPTS"); do
    GH_TAG="$(gh release view "v${TARGET_VERSION}" --json tagName -q '.tagName' 2>/dev/null || true)"
    if [[ "$GH_TAG" == "v${TARGET_VERSION}" ]]; then
      GH_FOUND=true
      break
    fi
    if [[ "$attempt" -lt "$RETRY_ATTEMPTS" ]]; then
      echo "  INFO: GitHub release not found (attempt ${attempt}/${RETRY_ATTEMPTS}); retrying in ${RETRY_DELAY_SECONDS}s..."
      sleep "$RETRY_DELAY_SECONDS"
    fi
  done
  if $GH_FOUND; then
    pass "GitHub release v${TARGET_VERSION} exists"
  else
    fail "GitHub release v${TARGET_VERSION} not found after ${RETRY_ATTEMPTS} attempts"
  fi
fi

# --- Get registry tarball URL and compute SHA ---
echo "[2/3] Canonical Homebrew tap SHA matches registry tarball"
REGISTRY_TARBALL_URL="$(npm view "${PACKAGE_NAME}@${TARGET_VERSION}" dist.tarball 2>/dev/null || true)"
FORMULA_CONTENT="$(fetch_formula_content)"
if [[ -z "$REGISTRY_TARBALL_URL" ]]; then
  fail "cannot fetch registry tarball URL for ${PACKAGE_NAME}@${TARGET_VERSION}"
elif [[ -z "$FORMULA_CONTENT" ]]; then
  fail "cannot fetch canonical Homebrew formula from ${CANONICAL_HOMEBREW_FORMULA_REPO}"
else
  REGISTRY_SHA="$(curl -sL "$REGISTRY_TARBALL_URL" | shasum -a 256 | awk '{print $1}')"
  if [[ -z "$REGISTRY_SHA" ]]; then
    fail "cannot compute SHA256 of registry tarball"
  else
    FORMULA_SHA="$(printf '%s\n' "$FORMULA_CONTENT" | grep -E '^\s*sha256\s+"' | sed 's/.*sha256 *"\([a-f0-9]*\)".*/\1/')"
    if [[ "$REGISTRY_SHA" == "$FORMULA_SHA" ]]; then
      pass "canonical Homebrew formula SHA256 matches registry tarball (${REGISTRY_SHA:0:16}...)"
    else
      fail "canonical Homebrew formula SHA256 mismatch: formula=${FORMULA_SHA:0:16}... registry=${REGISTRY_SHA:0:16}..."
    fi
  fi
fi

# --- Check 3: Homebrew tap URL matches registry tarball URL ---
echo "[3/3] Canonical Homebrew tap URL matches registry tarball"
if [[ -z "$REGISTRY_TARBALL_URL" ]]; then
  fail "cannot verify URL — registry tarball URL unavailable"
elif [[ -z "$FORMULA_CONTENT" ]]; then
  fail "cannot verify URL — canonical Homebrew formula unavailable"
else
  FORMULA_URL="$(printf '%s\n' "$FORMULA_CONTENT" | grep -E '^\s*url\s+"' | sed 's/.*url *"\([^"]*\)".*/\1/')"
  if [[ "$FORMULA_URL" == "$REGISTRY_TARBALL_URL" ]]; then
    pass "canonical Homebrew formula URL matches registry tarball"
  else
    fail "canonical Homebrew formula URL mismatch: formula=${FORMULA_URL} registry=${REGISTRY_TARBALL_URL}"
  fi
fi

echo ""
echo "====================================="
echo "Results: ${PASS} passed, ${FAIL} failed"
if [ "$FAIL" -gt 0 ]; then
  echo "DOWNSTREAM TRUTH FAILED — at least one downstream surface is inconsistent."
  exit 1
fi

echo "DOWNSTREAM TRUTH PASSED — all downstream surfaces are consistent."
exit 0
