#!/usr/bin/env bash
# Release identity creation — replaces raw `npm version <semver>`.
# Creates version bump commit + annotated tag with fail-closed verification.
# Usage: bash scripts/release-bump.sh --target-version <semver> --coauthored-by "Name <email>" [--skip-preflight]
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
CLI_DIR="${SCRIPT_DIR}/.."
REPO_ROOT="$(cd "${CLI_DIR}/.." && pwd)"
cd "$CLI_DIR"

TARGET_VERSION=""
COAUTHORED_BY=""
SKIP_PREFLIGHT=0

usage() {
  echo "Usage: bash scripts/release-bump.sh --target-version <semver> --coauthored-by \"Name <email>\" [--skip-preflight]" >&2
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
    --coauthored-by)
      if [[ -z "${2:-}" ]]; then
        echo "Error: --coauthored-by requires a trailer value like \"Name <email>\"" >&2
        usage
        exit 1
      fi
      COAUTHORED_BY="$2"
      shift 2
      ;;
    --skip-preflight)
      SKIP_PREFLIGHT=1
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

if [[ -z "$COAUTHORED_BY" ]]; then
  echo "Error: --coauthored-by is required so the release commit carries the mandated trailer" >&2
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
  "website-v2/static/llms.txt"
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
#
# NOTE: Homebrew mirror formula and README are NOT checked here. They are
# auto-aligned in step 5 because the registry SHA256 is inherently a
# post-publish artifact. See DEC-HOMEBREW-SHA-SPLIT-001.
echo "[4/9] Verifying version-surface alignment for ${TARGET_VERSION}..."
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

# 4c. Docs sidebar auto-generates releases from dirName (release doc existence is sufficient)
if ! grep -q "dirName.*releases" "${REPO_ROOT}/website-v2/sidebars.ts" 2>/dev/null; then
  SURFACE_ERRORS+=("sidebars.ts does not auto-generate releases (missing dirName: 'releases')")
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

# 4h. llms.txt must list the current release notes route
CURRENT_RELEASE_ROUTE="/docs/releases/${RELEASE_DOC_ID}"
if ! grep -q "${CURRENT_RELEASE_ROUTE}" "${REPO_ROOT}/website-v2/static/llms.txt" 2>/dev/null; then
  SURFACE_ERRORS+=("website-v2/static/llms.txt does not list '${CURRENT_RELEASE_ROUTE}'")
fi

# 4i. sitemap.xml is now auto-generated by Docusaurus at build time — no static file check needed

if [[ "${#SURFACE_ERRORS[@]}" -gt 0 ]]; then
  echo "FAIL: ${#SURFACE_ERRORS[@]} version-surface(s) not aligned to ${TARGET_VERSION}:" >&2
  printf '  - %s\n' "${SURFACE_ERRORS[@]}" >&2
  echo "" >&2
  echo "Fix these surfaces before running release-bump. The bump script refuses to" >&2
  echo "create release identity when governed surfaces are stale." >&2
  exit 1
fi
echo "  OK: all 8 governed version surfaces reference ${TARGET_VERSION}"

# 5. Normalize release-note sidebar ordering
echo "[5/10] Normalizing release-note sidebar positions..."
node "${CLI_DIR}/scripts/normalize-release-note-sidebar-positions.mjs"
echo "  OK: release-note sidebar positions normalized newest-first"

# 6. Auto-align Homebrew mirror to target version
# The formula URL and README version/tarball are updated automatically.
# The SHA256 is carried from the previous committed formula — it is inherently a
# post-publish artifact (npm registry tarballs are not byte-identical to
# local npm-pack output). Any working-tree SHA edit is overwritten here.
# sync-homebrew.sh corrects the SHA after publish.
echo "[6/10] Auto-aligning Homebrew mirror to ${TARGET_VERSION}..."
HOMEBREW_MIRROR="${REPO_ROOT}/cli/homebrew/agentxchain.rb"
HOMEBREW_MIRROR_README="${REPO_ROOT}/cli/homebrew/README.md"
TARBALL_URL="https://registry.npmjs.org/agentxchain/-/agentxchain-${TARGET_VERSION}.tgz"
HOMEBREW_ALIGNED=false
COMMITTED_HOMEBREW_SHA=""

extract_formula_sha() {
  sed -nE 's|^[[:space:]]*sha256 "([a-f0-9]{64})".*|\1|p' "$1" | head -n 1
}

if [[ -f "$HOMEBREW_MIRROR" ]]; then
  COMMITTED_FORMULA_TMP="$(mktemp "${TMPDIR:-/tmp}/agentxchain-homebrew-head.XXXXXX")"
  if ! git -C "$REPO_ROOT" show "HEAD:cli/homebrew/agentxchain.rb" >"$COMMITTED_FORMULA_TMP" 2>/dev/null; then
    rm -f "$COMMITTED_FORMULA_TMP"
    echo "FAIL: could not load HEAD:cli/homebrew/agentxchain.rb to carry the pre-publish SHA" >&2
    exit 1
  fi
  COMMITTED_HOMEBREW_SHA="$(extract_formula_sha "$COMMITTED_FORMULA_TMP")"
  rm -f "$COMMITTED_FORMULA_TMP"
  if [[ -z "$COMMITTED_HOMEBREW_SHA" ]]; then
    echo "FAIL: HEAD:cli/homebrew/agentxchain.rb does not contain a parseable sha256" >&2
    exit 1
  fi

  WORKTREE_HOMEBREW_SHA="$(extract_formula_sha "$HOMEBREW_MIRROR")"
  if [[ -z "$WORKTREE_HOMEBREW_SHA" ]]; then
    echo "FAIL: cli/homebrew/agentxchain.rb does not contain a parseable sha256" >&2
    exit 1
  fi

  ESCAPED_URL="$(printf '%s' "$TARBALL_URL" | sed 's/[&/\]/\\&/g')"
  ESCAPED_SHA="$(printf '%s' "$COMMITTED_HOMEBREW_SHA" | sed 's/[&/\]/\\&/g')"
  sed -i.bak -E "s|^([[:space:]]*url \").*(\")|\1${ESCAPED_URL}\2|" "$HOMEBREW_MIRROR"
  sed -i.bak -E "s|^([[:space:]]*sha256 \").*(\")|\1${ESCAPED_SHA}\2|" "$HOMEBREW_MIRROR"
  rm -f "${HOMEBREW_MIRROR}.bak"
  HOMEBREW_ALIGNED=true
  echo "  OK: formula URL -> ${TARBALL_URL}"
  if [[ "$WORKTREE_HOMEBREW_SHA" != "$COMMITTED_HOMEBREW_SHA" ]]; then
    echo "  OK: formula SHA normalized back to committed pre-publish SHA ${COMMITTED_HOMEBREW_SHA}"
  else
    echo "  OK: formula SHA carried from committed pre-publish SHA ${COMMITTED_HOMEBREW_SHA}"
  fi
fi

if [[ -f "$HOMEBREW_MIRROR_README" ]]; then
  sed -i.bak -E "s|^(- version: \`).*(\`)|\1${TARGET_VERSION}\2|" "$HOMEBREW_MIRROR_README"
  sed -i.bak -E "s|^(- source tarball: \`).*(\`)|\1${TARBALL_URL}\2|" "$HOMEBREW_MIRROR_README"
  rm -f "${HOMEBREW_MIRROR_README}.bak"
  echo "  OK: README version and tarball -> ${TARGET_VERSION}"
fi

if $HOMEBREW_ALIGNED; then
  echo "  Note: local npm pack output is not canonical release truth; sync-homebrew.sh will set the real registry SHA post-publish"
else
  echo "  Skipped: no Homebrew mirror files found"
fi

# 7. Update version files (no git operations)
echo "[7/10] Updating version files..."
npm version "$TARGET_VERSION" --no-git-tag-version
echo "  OK: package.json updated to ${TARGET_VERSION}"

# 8. Stage version files
echo "[8/10] Staging version files..."
git add -- package.json
if [[ -f package-lock.json ]]; then
  git add -- package-lock.json
fi
for rel_path in "${ALLOWED_RELEASE_PATHS[@]}"; do
  stage_if_present "$rel_path"
done
git -C "$REPO_ROOT" add -- website-v2/docs/releases
echo "  OK: version files and allowed release surfaces staged"

# 9. Create release commit
echo "[9/10] Creating release commit..."
git commit -m "${TARGET_VERSION}

Co-Authored-By: ${COAUTHORED_BY}"
RELEASE_SHA=$(git rev-parse HEAD)
COMMIT_MSG=$(git log -1 --format=%s)
if [[ "$COMMIT_MSG" != "$TARGET_VERSION" ]]; then
  echo "FAIL: commit message is '${COMMIT_MSG}', expected '${TARGET_VERSION}'" >&2
  exit 1
fi
COMMIT_BODY=$(git log -1 --format=%B)
if [[ "$COMMIT_BODY" != *"Co-Authored-By: ${COAUTHORED_BY}"* ]]; then
  echo "FAIL: release commit body is missing the required Co-Authored-By trailer" >&2
  exit 1
fi
echo "  OK: commit ${RELEASE_SHA:0:7} with message '${TARGET_VERSION}'"

# 9.5. Inline preflight gate — tests, pack, and docs build must pass before tag
if [[ "$SKIP_PREFLIGHT" -eq 1 ]]; then
  echo ""
  echo "[9.5/11] Inline preflight gate SKIPPED (--skip-preflight)"
else
  echo ""
  echo "[9.5/11] Running inline preflight gate..."
  echo "  Running test suite..."

  # Install MCP example deps if needed (same as release-preflight.sh)
  for example_dir in "${CLI_DIR}/../examples/mcp-echo-agent" "${CLI_DIR}/../examples/mcp-http-echo-agent"; do
    if [[ -f "${example_dir}/package.json" && ! -d "${example_dir}/node_modules" ]]; then
      echo "  Installing deps for $(basename "$example_dir")..."
      (cd "$example_dir" && env -u NODE_AUTH_TOKEN -u NPM_CONFIG_USERCONFIG npm install --ignore-scripts --userconfig /dev/null 2>&1) || true
    fi
  done

  PREFLIGHT_FAILED=0

  # 8.5a. Full test suite with release env vars
  if env AGENTXCHAIN_RELEASE_TARGET_VERSION="${TARGET_VERSION}" AGENTXCHAIN_RELEASE_PREFLIGHT=1 npm test >/dev/null 2>&1; then
    echo "  OK: test suite passed"
  else
    echo "  FAIL: test suite failed" >&2
    echo "  Re-running with output for diagnostics..." >&2
    env AGENTXCHAIN_RELEASE_TARGET_VERSION="${TARGET_VERSION}" AGENTXCHAIN_RELEASE_PREFLIGHT=1 npm test 2>&1 | tail -30 >&2
    PREFLIGHT_FAILED=1
  fi

  # 8.5b. npm pack dry-run
  if npm pack --dry-run >/dev/null 2>&1; then
    echo "  OK: npm pack --dry-run passed"
  else
    echo "  FAIL: npm pack --dry-run failed" >&2
    PREFLIGHT_FAILED=1
  fi

  # 8.5c. Docs build
  if (cd "${REPO_ROOT}/website-v2" && npm run build >/dev/null 2>&1); then
    echo "  OK: docs build passed"
  else
    echo "  FAIL: docs build failed" >&2
    PREFLIGHT_FAILED=1
  fi

  if [[ "$PREFLIGHT_FAILED" -eq 1 ]]; then
    echo "" >&2
    echo "PREFLIGHT FAILED — release commit created but NOT tagged." >&2
    echo "  Commit: ${RELEASE_SHA:0:7}" >&2
    echo "  Fix the failures, amend the commit, and re-run:" >&2
    echo "    bash scripts/release-bump.sh --target-version ${TARGET_VERSION}" >&2
    echo "  Or skip preflight if already verified:" >&2
    echo "    bash scripts/release-bump.sh --target-version ${TARGET_VERSION} --skip-preflight" >&2
    exit 1
  fi

  echo "  Inline preflight gate passed — proceeding to tag"
fi

# 10. Create annotated tag
echo "[10/11] Creating annotated tag..."
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
if [[ "$SKIP_PREFLIGHT" -eq 1 ]]; then
  echo ""
  echo "WARNING: Inline preflight was skipped. Verify before pushing:"
  echo "  npm run preflight:release:strict -- --target-version ${TARGET_VERSION}"
fi
echo ""
echo "Homebrew mirror is in Phase 1 (stale SHA from previous version)."
echo "After npm publish completes, run sync-homebrew.sh to reach Phase 3."
echo ""
echo "Next: git push origin main --follow-tags"
