#!/usr/bin/env bash
# Sync Homebrew formula from live npm registry metadata.
# Updates both the repo mirror (cli/homebrew/) and optionally the canonical tap.
# Usage: bash scripts/sync-homebrew.sh --target-version <semver> [--push-tap] [--dry-run]
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
CLI_DIR="${SCRIPT_DIR}/.."
REPO_ROOT="${CLI_DIR}/.."

TARGET_VERSION=""
PUSH_TAP=false
DRY_RUN=false

FORMULA_PATH="${CLI_DIR}/homebrew/agentxchain.rb"
README_PATH="${CLI_DIR}/homebrew/README.md"
CANONICAL_TAP_REPO="shivamtiwari93/homebrew-tap"
PACKAGE_NAME="agentxchain"

formula_url() {
  local formula_path="$1"
  grep -E '^\s*url\s+"' "$formula_path" | sed 's/.*url *"\([^"]*\)".*/\1/' || true
}

formula_sha() {
  local formula_path="$1"
  grep -E '^\s*sha256\s+"' "$formula_path" | sed 's/.*sha256 *"\([a-f0-9]*\)".*/\1/' || true
}

canonical_tap_matches_target() {
  local formula_path="$1"
  local expected_url="$2"
  local expected_sha="$3"
  [[ -f "$formula_path" ]] || return 1
  local remote_url
  local remote_sha
  remote_url="$(formula_url "$formula_path")"
  remote_sha="$(formula_sha "$formula_path")"
  [[ "$remote_url" == "$expected_url" && "$remote_sha" == "$expected_sha" ]]
}

usage() {
  echo "Usage: bash scripts/sync-homebrew.sh --target-version <semver> [--push-tap] [--dry-run]" >&2
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
    --push-tap)
      PUSH_TAP=true
      shift
      ;;
    --dry-run)
      DRY_RUN=true
      shift
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

echo "Homebrew Sync — ${PACKAGE_NAME}@${TARGET_VERSION}"
echo "====================================="

# --- Step 1: Fetch tarball URL from npm ---
echo "[1/5] Fetching tarball URL from npm registry..."
TARBALL_URL="$(npm view "${PACKAGE_NAME}@${TARGET_VERSION}" dist.tarball 2>/dev/null || true)"
if [[ -z "$TARBALL_URL" ]]; then
  echo "FAIL: npm registry does not serve ${PACKAGE_NAME}@${TARGET_VERSION}" >&2
  exit 1
fi
echo "  tarball: ${TARBALL_URL}"

# --- Step 2: Download tarball and compute SHA256 ---
echo "[2/5] Computing SHA256 from registry tarball..."
TARBALL_SHA="$(curl -sL "$TARBALL_URL" | shasum -a 256 | awk '{print $1}')"
if [[ -z "$TARBALL_SHA" ]] || [[ ${#TARBALL_SHA} -ne 64 ]]; then
  echo "FAIL: could not compute valid SHA256 from tarball" >&2
  exit 1
fi
echo "  sha256: ${TARBALL_SHA}"

# --- Step 3: Check if already in sync ---
echo "[3/5] Checking repo mirror..."
MIRROR_IN_SYNC=false
if [[ -f "$FORMULA_PATH" ]]; then
  CURRENT_URL="$(formula_url "$FORMULA_PATH")"
  CURRENT_SHA="$(formula_sha "$FORMULA_PATH")"
  if [[ "$CURRENT_URL" == "$TARBALL_URL" && "$CURRENT_SHA" == "$TARBALL_SHA" ]]; then
    MIRROR_IN_SYNC=true
    echo "  Repo mirror already matches npm registry."
    if ! $PUSH_TAP; then
      echo "====================================="
      echo "SYNC COMPLETE — repo mirror already up to date."
      exit 0
    fi
    echo "  Repo mirror is current, but canonical tap verification is still required."
  fi
  if ! $MIRROR_IN_SYNC; then
    echo "  Current URL: ${CURRENT_URL}"
    echo "  Current SHA: ${CURRENT_SHA}"
    echo "  Updating to match registry..."
  fi
else
  echo "  Formula not found at ${FORMULA_PATH} — will create."
fi

if $DRY_RUN; then
  echo ""
  echo "[DRY RUN] Would update:"
  if $MIRROR_IN_SYNC; then
    echo "  Repo mirror already matches:"
    echo "    url -> ${TARBALL_URL}"
    echo "    sha256 -> ${TARBALL_SHA}"
  else
    echo "  ${FORMULA_PATH}:"
    echo "    url -> ${TARBALL_URL}"
    echo "    sha256 -> ${TARBALL_SHA}"
    echo "  ${README_PATH}:"
    echo "    version -> ${TARGET_VERSION}"
    echo "    tarball -> ${TARBALL_URL}"
  fi
  if $PUSH_TAP; then
    echo "  Canonical tap ${CANONICAL_TAP_REPO}:"
    echo "    Formula/agentxchain.rb -> ${TARBALL_URL}"
    echo "    Formula/agentxchain.rb sha256 -> ${TARBALL_SHA}"
  fi
  echo "====================================="
  echo "DRY RUN COMPLETE — no files modified."
  exit 0
fi

# --- Step 4: Update repo mirror ---
echo "[4/5] Updating repo mirror..."

if $MIRROR_IN_SYNC; then
  echo "  Repo mirror already in sync — no local file changes needed."
else
  # Update formula
  ESCAPED_URL="$(printf '%s' "$TARBALL_URL" | sed 's/[&/\]/\\&/g')"
  ESCAPED_SHA="$(printf '%s' "$TARBALL_SHA" | sed 's/[&/\]/\\&/g')"
  sed -i.bak -E "s|^([[:space:]]*url \").*(\")|\1${ESCAPED_URL}\2|" "$FORMULA_PATH"
  sed -i.bak -E "s|^([[:space:]]*sha256 \").*(\")|\1${ESCAPED_SHA}\2|" "$FORMULA_PATH"
  rm -f "${FORMULA_PATH}.bak"

  # Update README version and tarball lines
  if [[ -f "$README_PATH" ]]; then
    # Update version line: "- version: `X.Y.Z`"
    sed -i.bak -E "s|^(- version: \`).*(\`)|\1${TARGET_VERSION}\2|" "$README_PATH"
    # Update tarball line: "- source tarball: `URL`"
    sed -i.bak -E "s|^(- source tarball: \`).*(\`)|\1${TARBALL_URL}\2|" "$README_PATH"
    rm -f "${README_PATH}.bak"
  fi

  echo "  Updated ${FORMULA_PATH}"
  echo "  Updated ${README_PATH}"
fi

# --- Step 5: Push to canonical tap (optional) ---
if $PUSH_TAP; then
  echo "[5/5] Pushing to canonical tap ${CANONICAL_TAP_REPO}..."
  TAP_TMPDIR="$(mktemp -d "${TMPDIR:-/tmp}/homebrew-tap-sync.XXXXXX")"
  TAP_REMOTE_URL="https://github.com/${CANONICAL_TAP_REPO}.git"
  if [[ -n "${HOMEBREW_TAP_TOKEN:-}" ]]; then
    TAP_REMOTE_URL="https://x-access-token:${HOMEBREW_TAP_TOKEN}@github.com/${CANONICAL_TAP_REPO}.git"
  fi

  if ! git clone "$TAP_REMOTE_URL" "$TAP_TMPDIR" 2>/dev/null; then
    echo "FAIL: could not clone ${CANONICAL_TAP_REPO}" >&2
    rm -rf "$TAP_TMPDIR"
    exit 1
  fi

  TAP_FORMULA="${TAP_TMPDIR}/Formula/agentxchain.rb"
  if [[ ! -f "$TAP_FORMULA" ]]; then
    mkdir -p "${TAP_TMPDIR}/Formula"
  fi

  TAP_CURRENT_URL=""
  TAP_CURRENT_SHA=""
  if [[ -f "$TAP_FORMULA" ]]; then
    TAP_CURRENT_URL="$(formula_url "$TAP_FORMULA")"
    TAP_CURRENT_SHA="$(formula_sha "$TAP_FORMULA")"
  fi

  (
    cd "$TAP_TMPDIR" || exit 1
    if [[ "$TAP_CURRENT_URL" == "$TARBALL_URL" && "$TAP_CURRENT_SHA" == "$TARBALL_SHA" ]]; then
      echo "  Canonical tap already in sync — no push needed."
    else
      cp "$FORMULA_PATH" "$TAP_FORMULA"
      if ! git config user.name >/dev/null; then
        git config user.name "${HOMEBREW_TAP_GIT_NAME:-github-actions[bot]}"
      fi
      if ! git config user.email >/dev/null; then
        git config user.email "${HOMEBREW_TAP_GIT_EMAIL:-github-actions[bot]@users.noreply.github.com}"
      fi
      git add Formula/agentxchain.rb
      git commit -m "agentxchain ${TARGET_VERSION}"
      if ! git push origin HEAD:main; then
        echo "  Push rejected by ${CANONICAL_TAP_REPO}; verifying remote state..."
        git fetch origin main >/dev/null 2>&1 || true
        REMOTE_FORMULA="$(mktemp "${TMPDIR:-/tmp}/homebrew-tap-remote-formula.XXXXXX")"
        if git show origin/main:Formula/agentxchain.rb >"$REMOTE_FORMULA" 2>/dev/null \
          && canonical_tap_matches_target "$REMOTE_FORMULA" "$TARBALL_URL" "$TARBALL_SHA"; then
          rm -f "$REMOTE_FORMULA"
          echo "  Canonical tap already matches target after push rejection — treating sync as complete."
        else
          rm -f "$REMOTE_FORMULA"
          echo "FAIL: could not push to ${CANONICAL_TAP_REPO} and remote tap does not match target artifact" >&2
          exit 1
        fi
      else
        echo "  Pushed to ${CANONICAL_TAP_REPO}"
      fi
    fi
  )

  rm -rf "$TAP_TMPDIR"
else
  echo "[5/5] Skipping tap push (--push-tap not set)."
fi

echo ""
echo "====================================="
echo "SYNC STEP COMPLETE — Homebrew formula updated to ${PACKAGE_NAME}@${TARGET_VERSION}."
echo ""
echo "This is the Phase 2 -> Phase 3 transition step only. It does NOT prove"
echo "the public npx install path resolves, and it does NOT prove the canonical"
echo "tap / GitHub Release / repo-mirror downstream truth is consistent."
echo ""
echo "Do NOT declare the release complete from this script's exit code alone."
echo "Complete the release by running ONE of:"
echo "  - bash cli/scripts/verify-post-publish.sh --target-version ${TARGET_VERSION}"
echo "    (manual/operator path; includes npx smoke + repo-mirror SHA proof + full test suite)"
echo "  - bash cli/scripts/release-downstream-truth.sh --target-version ${TARGET_VERSION}"
echo "    (CI-equivalent path; requires release-postflight.sh to have already run the npx smoke)"
echo ""
echo "See DEC-VERIFY-POST-PUBLISH-NPX-001 and DEC-HOMEBREW-SYNC-LOOPHOLE-CLOSE-001."
exit 0
