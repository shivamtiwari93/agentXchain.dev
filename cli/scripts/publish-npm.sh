#!/usr/bin/env bash
# Publish a new version of agentxchain to npm.
# Usage:
#   bash scripts/publish-npm.sh                # bump patch + publish
#   bash scripts/publish-npm.sh minor          # bump minor + publish
#   bash scripts/publish-npm.sh major          # bump major + publish
#   bash scripts/publish-npm.sh 0.5.0          # set explicit version + publish
#   bash scripts/publish-npm.sh patch --dry-run
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
CLI_DIR="${SCRIPT_DIR}/.."
cd "$CLI_DIR"

if [[ ! -f "package.json" ]]; then
  echo "Error: package.json not found in $CLI_DIR"
  exit 1
fi

PACKAGE_NAME="$(node -e "console.log(JSON.parse(require('fs').readFileSync('package.json', 'utf8')).name)")"
BUMP="${1:-patch}"
DRY_RUN="${2:-}"

if [[ "$BUMP" != "patch" && "$BUMP" != "minor" && "$BUMP" != "major" && ! "$BUMP" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo "Error: invalid version bump '$BUMP'. Use patch|minor|major|x.y.z"
  exit 1
fi

# Load NPM_TOKEN from agentXchain.dev/.env only.
PARENT_ENV_FILE="${CLI_DIR}/../.env"
if [[ -f "${PARENT_ENV_FILE}" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "${PARENT_ENV_FILE}"
  set +a
fi

CURRENT_VERSION="$(node -e "console.log(JSON.parse(require('fs').readFileSync('package.json', 'utf8')).version)")"
echo "Current version: ${CURRENT_VERSION}"
echo "Package name:    ${PACKAGE_NAME}"
echo "Requested bump:  ${BUMP}"
echo ""

if [[ "$DRY_RUN" == "--dry-run" ]]; then
  echo "Dry run mode. No files changed."
  exit 0
fi

# Preflight auth/ownership checks before version bump.
echo "Running npm preflight checks..."
if ! npm whoami >/dev/null 2>&1; then
  echo "Error: npm auth missing. Run: npm login"
  exit 1
fi
NPM_USER="$(npm whoami)"
echo "npm user:        ${NPM_USER}"

if npm view "${PACKAGE_NAME}" version >/dev/null 2>&1; then
  # Existing package: confirm owner access.
  if ! npm owner ls "${PACKAGE_NAME}" | grep -q "^${NPM_USER} "; then
    echo "Error: npm user '${NPM_USER}' is not an owner of '${PACKAGE_NAME}'."
    echo "Ask an existing owner to run: npm owner add ${NPM_USER} ${PACKAGE_NAME}"
    exit 1
  fi
  echo "ownership:       ok"
else
  echo "package status:  new package or not visible to this auth context"
fi
echo ""

echo "Bumping package version..."
npm version "$BUMP" --no-git-tag-version

NEW_VERSION="$(node -e "console.log(JSON.parse(require('fs').readFileSync('package.json', 'utf8')).version)")"
echo "New version: ${NEW_VERSION}"
echo ""

echo "Publishing to npm..."
if [[ -n "${NPM_TOKEN:-}" ]]; then
  npm publish --access public --//registry.npmjs.org/:_authToken="${NPM_TOKEN}"
else
  npm publish --access public
fi

echo ""
echo "Done. Published agentxchain@${NEW_VERSION}"
