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
echo "[1/7] Checking release-prep tree state..."
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
echo "[2/7] Checking current version..."
CURRENT_VERSION=$(node -e "console.log(JSON.parse(require('fs').readFileSync('package.json','utf8')).version)")
if [[ "$CURRENT_VERSION" == "$TARGET_VERSION" ]]; then
  echo "FAIL: package.json is already at ${TARGET_VERSION}. Cannot double-bump." >&2
  exit 1
fi
echo "  OK: current version is ${CURRENT_VERSION}, bumping to ${TARGET_VERSION}"

# 3. Assert tag does not already exist
echo "[3/7] Checking for existing tag..."
if git rev-parse "v${TARGET_VERSION}" >/dev/null 2>&1; then
  echo "FAIL: tag v${TARGET_VERSION} already exists. Delete it first or choose a different version." >&2
  exit 1
fi
echo "  OK: tag v${TARGET_VERSION} does not exist"

# 4. Update version files (no git operations)
echo "[4/7] Updating version files..."
npm version "$TARGET_VERSION" --no-git-tag-version
echo "  OK: package.json updated to ${TARGET_VERSION}"

# 5. Stage version files
echo "[5/7] Staging version files..."
git add -- package.json
if [[ -f package-lock.json ]]; then
  git add -- package-lock.json
fi
for rel_path in "${ALLOWED_RELEASE_PATHS[@]}"; do
  stage_if_present "$rel_path"
done
echo "  OK: version files and allowed release surfaces staged"

# 6. Create release commit
echo "[6/7] Creating release commit..."
git commit -m "${TARGET_VERSION}"
RELEASE_SHA=$(git rev-parse HEAD)
COMMIT_MSG=$(git log -1 --format=%s)
if [[ "$COMMIT_MSG" != "$TARGET_VERSION" ]]; then
  echo "FAIL: commit message is '${COMMIT_MSG}', expected '${TARGET_VERSION}'" >&2
  exit 1
fi
echo "  OK: commit ${RELEASE_SHA:0:7} with message '${TARGET_VERSION}'"

# 7. Create annotated tag
echo "[7/7] Creating annotated tag..."
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
