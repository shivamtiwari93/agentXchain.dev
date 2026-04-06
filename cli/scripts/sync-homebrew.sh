#!/usr/bin/env bash
# Sync Homebrew formula from live npm registry metadata.
# Updates both the repo mirror (cli/homebrew/) and optionally the canonical tap.
# Usage: bash scripts/sync-homebrew.sh --target-version <semver> [--push-tap] [--dry-run]
set -uo pipefail

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
if [[ -f "$FORMULA_PATH" ]]; then
  CURRENT_URL="$(grep -E '^\s*url\s+"' "$FORMULA_PATH" | sed 's/.*url *"\([^"]*\)".*/\1/' || true)"
  CURRENT_SHA="$(grep -E '^\s*sha256\s+"' "$FORMULA_PATH" | sed 's/.*sha256 *"\([a-f0-9]*\)".*/\1/' || true)"
  if [[ "$CURRENT_URL" == "$TARBALL_URL" && "$CURRENT_SHA" == "$TARBALL_SHA" ]]; then
    echo "  Already in sync — no changes needed."
    if $PUSH_TAP; then
      echo "  Skipping tap push (already in sync)."
    fi
    echo "====================================="
    echo "SYNC COMPLETE — already up to date."
    exit 0
  fi
  echo "  Current URL: ${CURRENT_URL}"
  echo "  Current SHA: ${CURRENT_SHA}"
  echo "  Updating to match registry..."
else
  echo "  Formula not found at ${FORMULA_PATH} — will create."
fi

if $DRY_RUN; then
  echo ""
  echo "[DRY RUN] Would update:"
  echo "  ${FORMULA_PATH}:"
  echo "    url -> ${TARBALL_URL}"
  echo "    sha256 -> ${TARBALL_SHA}"
  echo "  ${README_PATH}:"
  echo "    version -> ${TARGET_VERSION}"
  echo "    tarball -> ${TARBALL_URL}"
  if $PUSH_TAP; then
    echo "  Canonical tap ${CANONICAL_TAP_REPO}:"
    echo "    Formula/agentxchain.rb -> same as above"
  fi
  echo "====================================="
  echo "DRY RUN COMPLETE — no files modified."
  exit 0
fi

# --- Step 4: Update repo mirror ---
echo "[4/5] Updating repo mirror..."

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

# --- Step 5: Push to canonical tap (optional) ---
if $PUSH_TAP; then
  echo "[5/5] Pushing to canonical tap ${CANONICAL_TAP_REPO}..."
  TAP_TMPDIR="$(mktemp -d "${TMPDIR:-/tmp}/homebrew-tap-sync.XXXXXX")"

  if ! git clone "https://github.com/${CANONICAL_TAP_REPO}.git" "$TAP_TMPDIR" 2>/dev/null; then
    echo "FAIL: could not clone ${CANONICAL_TAP_REPO}" >&2
    rm -rf "$TAP_TMPDIR"
    exit 1
  fi

  TAP_FORMULA="${TAP_TMPDIR}/Formula/agentxchain.rb"
  if [[ ! -f "$TAP_FORMULA" ]]; then
    mkdir -p "${TAP_TMPDIR}/Formula"
  fi

  cp "$FORMULA_PATH" "$TAP_FORMULA"

  (
    cd "$TAP_TMPDIR" || exit 1
    git add Formula/agentxchain.rb
    if git diff --cached --quiet; then
      echo "  Canonical tap already in sync — no push needed."
    else
      git commit -m "agentxchain ${TARGET_VERSION}"
      if ! git push origin main; then
        echo "FAIL: could not push to ${CANONICAL_TAP_REPO}" >&2
        rm -rf "$TAP_TMPDIR"
        exit 1
      fi
      echo "  Pushed to ${CANONICAL_TAP_REPO}"
    fi
  )

  rm -rf "$TAP_TMPDIR"
else
  echo "[5/5] Skipping tap push (--push-tap not set)."
fi

echo ""
echo "====================================="
echo "SYNC COMPLETE — Homebrew formula updated to ${PACKAGE_NAME}@${TARGET_VERSION}."
exit 0
