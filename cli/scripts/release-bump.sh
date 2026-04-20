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
CURRENT_VERSION=$(node -e "console.log(JSON.parse(require('fs').readFileSync('package.json','utf8')).version)")
REENTRY_MODE=0
ALLOWED_RELEASE_PATHS=(
  "cli/CHANGELOG.md"
  "${TARGET_RELEASE_DOC}"
  "website-v2/sidebars.ts"
  "website-v2/src/pages/index.tsx"
  ".agentxchain-conformance/capabilities.json"
  "website-v2/docs/protocol-implementor-guide.mdx"
  ".planning/LAUNCH_EVIDENCE_REPORT.md"
  ".planning/SHOW_HN_DRAFT.md"
  ".planning/MARKETING/TWITTER_THREAD.md"
  ".planning/MARKETING/LINKEDIN_POST.md"
  ".planning/MARKETING/REDDIT_POSTS.md"
  ".planning/MARKETING/HN_SUBMISSION.md"
  "website-v2/static/llms.txt"
  "website-v2/docs/getting-started.mdx"
  "website-v2/docs/quickstart.mdx"
  "website-v2/docs/five-minute-tutorial.mdx"
  "cli/homebrew/agentxchain.rb"
  "cli/homebrew/README.md"
)
ALLOWED_REENTRY_VERSION_PATHS=(
  "cli/package.json"
  "cli/package-lock.json"
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

# 1. Detect version/re-entry state before validating the tree
echo "[1/10] Checking current version..."
if [[ "$CURRENT_VERSION" == "$TARGET_VERSION" ]]; then
  REENTRY_MODE=1
  echo "  OK: package.json already targets ${TARGET_VERSION}; entering release re-entry mode"
else
  echo "  OK: current version is ${CURRENT_VERSION}, bumping to ${TARGET_VERSION}"
fi

# 2. Assert only allowed release-surface dirt is present
echo "[2/10] Checking release-prep tree state..."
DISALLOWED_DIRTY=()
while IFS= read -r status_line; do
  [[ -z "$status_line" ]] && continue
  path="${status_line#?? }"
  if is_allowed_release_path "$path"; then
    continue
  fi
  if [[ "$REENTRY_MODE" -eq 1 ]]; then
    for allowed in "${ALLOWED_REENTRY_VERSION_PATHS[@]}"; do
      if [[ "$path" == "$allowed" ]]; then
        continue 2
      fi
    done
  fi
  DISALLOWED_DIRTY+=("$path")
done < <(git -C "$REPO_ROOT" status --porcelain)

if [[ "${#DISALLOWED_DIRTY[@]}" -gt 0 ]]; then
  echo "FAIL: Working tree contains changes outside the allowed release surfaces:" >&2
  printf '  - %s\n' "${DISALLOWED_DIRTY[@]}" >&2
  exit 1
fi
echo "  OK: tree contains only allowed release-prep changes"

# 3. Assert tag does not already exist
echo "[3/10] Checking for existing tag..."
if git rev-parse "v${TARGET_VERSION}" >/dev/null 2>&1; then
  echo "FAIL: tag v${TARGET_VERSION} already exists. Delete it first or choose a different version." >&2
  exit 1
fi
echo "  OK: tag v${TARGET_VERSION} does not exist"

# 4. Pre-bump release-alignment guard
# Ensures all manual target-version surfaces already reference the target version
# BEFORE the bump commit is created. This catches stale drift that would
# otherwise only be discovered after minting local release identities.
#
# NOTE: Homebrew mirror formula and README are NOT checked here. They are
# auto-aligned in step 6 because the registry tarball URL is deterministic but
# the registry SHA256 is inherently post-publish truth.
echo "[4/10] Verifying release alignment for ${TARGET_VERSION}..."
if node "${CLI_DIR}/scripts/check-release-alignment.mjs" --target-version "${TARGET_VERSION}" --scope prebump; then
  :
else
  echo "" >&2
  echo "Fix these surfaces before running release-bump. The bump script refuses to" >&2
  echo "create release identity when governed surfaces are stale." >&2
  exit 1
fi

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
if [[ "$REENTRY_MODE" -eq 1 ]]; then
  npm version "$TARGET_VERSION" --no-git-tag-version --allow-same-version
else
  npm version "$TARGET_VERSION" --no-git-tag-version
fi
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

# 9. Create or reuse release commit
if git diff --cached --quiet --exit-code; then
  CURRENT_HEAD_SHA=$(git rev-parse HEAD)
  echo "[9/10] Resolving re-entry release identity..."
  COMMIT_MSG=$(git log -1 --format=%s)
  if [[ "$COMMIT_MSG" == "$TARGET_VERSION" ]]; then
    COMMIT_BODY=$(git log -1 --format=%B)
    if [[ "$COMMIT_BODY" != *"Co-Authored-By: ${COAUTHORED_BY}"* ]]; then
      echo "FAIL: existing HEAD commit for re-entry is missing the required Co-Authored-By trailer" >&2
      exit 1
    fi
    RELEASE_SHA=$(git rev-parse HEAD)
    echo "  OK: reusing existing release commit ${RELEASE_SHA:0:7}"
  elif [[ "$REENTRY_MODE" -eq 1 ]]; then
    echo "  No staged release-surface deltas remain; creating metadata-only release identity commit for ${CURRENT_HEAD_SHA:0:7}"
    git commit --allow-empty -m "${TARGET_VERSION}

Release-Base: ${CURRENT_HEAD_SHA}
Co-Authored-By: ${COAUTHORED_BY}"
    RELEASE_SHA=$(git rev-parse HEAD)
    COMMIT_BODY=$(git log -1 --format=%B)
    if [[ "$COMMIT_BODY" != *"Release-Base: ${CURRENT_HEAD_SHA}"* ]]; then
      echo "FAIL: metadata-only release identity commit is missing the required Release-Base line" >&2
      exit 1
    fi
    if [[ "$COMMIT_BODY" != *"Co-Authored-By: ${COAUTHORED_BY}"* ]]; then
      echo "FAIL: metadata-only release identity commit is missing the required Co-Authored-By trailer" >&2
      exit 1
    fi
    echo "  OK: metadata-only release identity commit ${RELEASE_SHA:0:7} recorded base ${CURRENT_HEAD_SHA:0:7}"
  else
    echo "FAIL: no staged release-identity changes remain, and HEAD is not already the ${TARGET_VERSION} release commit. Found commit message '${COMMIT_MSG}'." >&2
    exit 1
  fi
else
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
fi

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
