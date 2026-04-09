#!/usr/bin/env bash
# Release identity creation — replaces raw `npm version <semver>`.
# Creates version bump commit + annotated tag with fail-closed verification.
# Usage: bash scripts/release-bump.sh --target-version <semver>
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
CLI_DIR="${SCRIPT_DIR}/.."
REPO_ROOT="$(cd "${CLI_DIR}/.." && pwd)"
cd "$CLI_DIR"

TARGET_VERSION=""

usage() {
  echo "Usage: bash scripts/release-bump.sh --target-version <semver>" >&2
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
        echo "Error: invalid semver: $2" >&2
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

echo "AgentXchain Release Identity: ${TARGET_VERSION}"
echo "============================================="

TARGET_RELEASE_DOC="website-v2/docs/releases/v${TARGET_VERSION//./-}.mdx"
ALLOWED_RELEASE_PATHS=(
  "cli/CHANGELOG.md"
  "${TARGET_RELEASE_DOC}"
  "website-v2/sidebars.ts"
  "website-v2/src/pages/index.tsx"
  ".agentxchain-conformance/capabilities.json"
  "website-v2/docs/protocol-implementor-guide.mdx"
  ".planning/LAUNCH_EVIDENCE_REPORT.md"
  "cli/homebrew/agentxchain.rb"
  "cli/homebrew/README.md"
)

is_allowed_release_path() {
  local candidate="$1"
  local allowed
  for allowed in "${ALLOWED_RELEASE_PATHS[@]}"; do
    if [[ "$candidate" == "$allowed" ]]; then
      return 0
    fi
  done
  return 1
}

stage_if_present() {
  local rel_path="$1"
  if [[ -e "${REPO_ROOT}/${rel_path}" ]]; then
    git -C "$REPO_ROOT" add -- "$rel_path"
    return 0
  fi
  if git -C "$REPO_ROOT" ls-files --error-unmatch "$rel_path" >/dev/null 2>&1; then
    git -C "$REPO_ROOT" add -- "$rel_path"
  fi
}

# 1. Assert only allowed release-surface dirt is present
echo "[1/8] Checking release-prep tree state..."
DISALLOWED_DIRTY=()
while IFS= read -r status_line; do
  [[ -z "$status_line" ]] && continue
  path="${status_line#?? }"
  if ! is_allowed_release_path "$path"; then
    DISALLOWED_DIRTY+=("$path")
  fi
done < <(git -C "$REPO_ROOT" status --porcelain)

if [[ "${#DISALLOWED_DIRTY[@]}" -gt 0 ]]; then
  echo "FAIL: Working tree contains changes outside the allowed release surfaces:" >&2
  printf '  - %s\n' "${DISALLOWED_DIRTY[@]}" >&2
  exit 1
fi
echo "  OK: tree contains only allowed release-prep changes"

# 2. Assert not already at target version
echo "[2/8] Checking current version..."
CURRENT_VERSION=$(node -e "console.log(JSON.parse(require('fs').readFileSync('package.json','utf8')).version)")
if [[ "$CURRENT_VERSION" == "$TARGET_VERSION" ]]; then
  echo "FAIL: package.json is already at ${TARGET_VERSION}. Cannot double-bump." >&2
  exit 1
fi
echo "  OK: current version is ${CURRENT_VERSION}, bumping to ${TARGET_VERSION}"

# 3. Assert tag does not already exist
echo "[3/8] Checking for existing tag..."
if git rev-parse "v${TARGET_VERSION}" >/dev/null 2>&1; then
  echo "FAIL: tag v${TARGET_VERSION} already exists. Delete it first or choose a different version." >&2
  exit 1
fi
echo "  OK: tag v${TARGET_VERSION} does not exist"

# 4. Pre-bump version-surface alignment guard
# Ensures all governed version surfaces already reference the target version
# BEFORE the bump commit is created. This catches stale drift that would
# otherwise only be discovered after minting local release identities.
echo "[4/8] Verifying version-surface alignment for ${TARGET_VERSION}..."
SURFACE_ERRORS=()

# 4a. CHANGELOG top heading
CHANGELOG_TOP=$(grep -m1 -E '^## [0-9]+\.[0-9]+\.[0-9]+$' "${REPO_ROOT}/cli/CHANGELOG.md" 2>/dev/null | sed 's/^## //' || true)
if [[ "$CHANGELOG_TOP" != "$TARGET_VERSION" ]]; then
  SURFACE_ERRORS+=("CHANGELOG.md top heading is '${CHANGELOG_TOP:-missing}', expected '${TARGET_VERSION}'")
fi

# 4b. Release notes page exists
RELEASE_DOC_ID="v${TARGET_VERSION//./-}"
RELEASE_DOC_PATH="website-v2/docs/releases/${RELEASE_DOC_ID}.mdx"
if [[ ! -f "${REPO_ROOT}/${RELEASE_DOC_PATH}" ]]; then
  SURFACE_ERRORS+=("release notes page missing: ${RELEASE_DOC_PATH}")
fi

# 4c. Docs sidebar links the release page
if ! grep -q "'releases/${RELEASE_DOC_ID}'" "${REPO_ROOT}/website-v2/sidebars.ts" 2>/dev/null; then
  SURFACE_ERRORS+=("sidebars.ts does not link 'releases/${RELEASE_DOC_ID}'")
fi

# 4d. Homepage hero badge shows target version
if ! grep -q "v${TARGET_VERSION}" "${REPO_ROOT}/website-v2/src/pages/index.tsx" 2>/dev/null; then
  SURFACE_ERRORS+=("homepage index.tsx does not contain 'v${TARGET_VERSION}'")
fi

# 4e. Conformance capabilities version
CAPS_VERSION=$(node -e "try{console.log(JSON.parse(require('fs').readFileSync('${REPO_ROOT}/.agentxchain-conformance/capabilities.json','utf8')).version)}catch{console.log('missing')}" 2>/dev/null || echo "missing")
if [[ "$CAPS_VERSION" != "$TARGET_VERSION" ]]; then
  SURFACE_ERRORS+=("capabilities.json version is '${CAPS_VERSION}', expected '${TARGET_VERSION}'")
fi

# 4f. Protocol implementor guide example
if ! grep -q "\"version\": \"${TARGET_VERSION}\"" "${REPO_ROOT}/website-v2/docs/protocol-implementor-guide.mdx" 2>/dev/null; then
  SURFACE_ERRORS+=("protocol-implementor-guide.mdx does not contain '\"version\": \"${TARGET_VERSION}\"'")
fi

# 4g. Launch evidence report title
ESCAPED_VERSION="${TARGET_VERSION//./\\.}"
if ! grep -qE "^# Launch Evidence Report — AgentXchain v${ESCAPED_VERSION}" "${REPO_ROOT}/.planning/LAUNCH_EVIDENCE_REPORT.md" 2>/dev/null; then
  SURFACE_ERRORS+=("LAUNCH_EVIDENCE_REPORT.md title does not carry v${TARGET_VERSION}")
fi

# 4h. Homebrew mirror formula version
HOMEBREW_MIRROR="${REPO_ROOT}/cli/homebrew/agentxchain.rb"
if [[ -f "$HOMEBREW_MIRROR" ]]; then
  if ! grep -q "agentxchain-${TARGET_VERSION}\.tgz" "$HOMEBREW_MIRROR" 2>/dev/null; then
    SURFACE_ERRORS+=("homebrew mirror formula does not reference agentxchain-${TARGET_VERSION}.tgz")
  fi
fi

# 4i. Homebrew mirror maintainer README version
HOMEBREW_MIRROR_README="${REPO_ROOT}/cli/homebrew/README.md"
if [[ -f "$HOMEBREW_MIRROR_README" ]]; then
  if ! grep -q -- "- version: \`${TARGET_VERSION}\`" "$HOMEBREW_MIRROR_README" 2>/dev/null; then
    SURFACE_ERRORS+=("homebrew mirror README does not declare version ${TARGET_VERSION}")
  fi
  if ! grep -q "agentxchain-${TARGET_VERSION}\.tgz" "$HOMEBREW_MIRROR_README" 2>/dev/null; then
    SURFACE_ERRORS+=("homebrew mirror README does not reference agentxchain-${TARGET_VERSION}.tgz")
  fi
fi

if [[ "${#SURFACE_ERRORS[@]}" -gt 0 ]]; then
  echo "FAIL: ${#SURFACE_ERRORS[@]} version-surface(s) not aligned to ${TARGET_VERSION}:" >&2
  printf '  - %s\n' "${SURFACE_ERRORS[@]}" >&2
  echo "" >&2
  echo "Fix these surfaces before running release-bump. The bump script refuses to" >&2
  echo "create release identity when governed surfaces are stale." >&2
  exit 1
fi
echo "  OK: all 10 governed version surfaces reference ${TARGET_VERSION}"

# 5. Update version files (no git operations)
echo "[5/8] Updating version files..."
npm version "$TARGET_VERSION" --no-git-tag-version
echo "  OK: package.json updated to ${TARGET_VERSION}"

# 6. Stage version files
echo "[6/8] Staging version files..."
git add -- package.json
if [[ -f package-lock.json ]]; then
  git add -- package-lock.json
fi
for rel_path in "${ALLOWED_RELEASE_PATHS[@]}"; do
  stage_if_present "$rel_path"
done
echo "  OK: version files and allowed release surfaces staged"

# 7. Create release commit
echo "[7/8] Creating release commit..."
git commit -m "${TARGET_VERSION}"
RELEASE_SHA=$(git rev-parse HEAD)
COMMIT_MSG=$(git log -1 --format=%s)
if [[ "$COMMIT_MSG" != "$TARGET_VERSION" ]]; then
  echo "FAIL: commit message is '${COMMIT_MSG}', expected '${TARGET_VERSION}'" >&2
  exit 1
fi
echo "  OK: commit ${RELEASE_SHA:0:7} with message '${TARGET_VERSION}'"

# 8. Create annotated tag
echo "[8/8] Creating annotated tag..."
git tag -a "v${TARGET_VERSION}" -m "v${TARGET_VERSION}"
TAG_SHA=$(git rev-parse "v${TARGET_VERSION}")
if [[ -z "$TAG_SHA" ]]; then
  echo "FAIL: tag v${TARGET_VERSION} was not created" >&2
  exit 1
fi
TAG_TYPE=$(git cat-file -t "v${TARGET_VERSION}")
if [[ "$TAG_TYPE" != "tag" ]]; then
  echo "FAIL: v${TARGET_VERSION} is ${TAG_TYPE}, expected annotated tag object" >&2
  exit 1
fi
TAG_TARGET=$(git rev-parse "v${TARGET_VERSION}^{}")
if [[ "$TAG_TARGET" != "$RELEASE_SHA" ]]; then
  echo "FAIL: tag v${TARGET_VERSION} resolves to ${TAG_TARGET:0:7}, expected ${RELEASE_SHA:0:7}" >&2
  exit 1
fi
echo "  OK: annotated tag v${TARGET_VERSION} at ${TAG_SHA:0:7} -> ${TAG_TARGET:0:7}"

echo ""
echo "============================================="
echo "Release identity created successfully."
echo "  Version: ${TARGET_VERSION}"
echo "  Commit:  ${RELEASE_SHA:0:7}"
echo "  Tag:     v${TARGET_VERSION}"
echo ""
echo "Next: npm run preflight:release:strict -- --target-version ${TARGET_VERSION}"
echo "Then: git push origin main --follow-tags"
