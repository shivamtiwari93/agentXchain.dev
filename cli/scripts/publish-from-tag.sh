#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
CLI_DIR="${SCRIPT_DIR}/.."
cd "$CLI_DIR"

TMP_NPMRC=""

cleanup() {
  if [[ -n "$TMP_NPMRC" && -f "$TMP_NPMRC" ]]; then
    rm -f "$TMP_NPMRC"
  fi
}

trap cleanup EXIT

usage() {
  echo "Usage: bash scripts/publish-from-tag.sh [--skip-preflight] <vX.Y.Z>" >&2
}

SKIP_PREFLIGHT=0
TAG=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --skip-preflight)
      SKIP_PREFLIGHT=1
      shift
      ;;
    -*)
      echo "Error: unknown option '$1'" >&2
      usage
      exit 1
      ;;
    *)
      if [[ -n "$TAG" ]]; then
        echo "Error: release tag must be provided exactly once" >&2
        usage
        exit 1
      fi
      TAG="$1"
      shift
      ;;
  esac
done

if [[ -z "$TAG" ]]; then
  echo "Error: release tag is required" >&2
  usage
  exit 1
fi

if ! [[ "$TAG" =~ ^v([0-9]+\.[0-9]+\.[0-9]+)$ ]]; then
  echo "Error: release tag must match v<semver>; got '${TAG}'" >&2
  usage
  exit 1
fi

RELEASE_VERSION="${BASH_REMATCH[1]}"
PACKAGE_NAME="$(node -e "console.log(JSON.parse(require('fs').readFileSync('package.json', 'utf8')).name)")"
PACKAGE_VERSION="$(node -e "console.log(JSON.parse(require('fs').readFileSync('package.json', 'utf8')).version)")"

if [[ "$PACKAGE_VERSION" != "$RELEASE_VERSION" ]]; then
  echo "Error: package.json version is ${PACKAGE_VERSION}, expected ${RELEASE_VERSION} from ${TAG}" >&2
  exit 1
fi

RETRY_ATTEMPTS="${NPM_VIEW_RETRY_ATTEMPTS:-12}"
RETRY_DELAY_SECONDS="${NPM_VIEW_RETRY_DELAY_SECONDS:-5}"

if ! [[ "$RETRY_ATTEMPTS" =~ ^[0-9]+$ ]] || [[ "$RETRY_ATTEMPTS" -lt 1 ]]; then
  echo "Error: NPM_VIEW_RETRY_ATTEMPTS must be a positive integer" >&2
  exit 1
fi

if ! [[ "$RETRY_DELAY_SECONDS" =~ ^[0-9]+$ ]]; then
  echo "Error: NPM_VIEW_RETRY_DELAY_SECONDS must be a non-negative integer" >&2
  exit 1
fi

echo "Publishing ${PACKAGE_NAME}@${RELEASE_VERSION} from ${TAG}"
if [[ "$SKIP_PREFLIGHT" -eq 1 ]]; then
  echo "Skipping strict release preflight because the caller already owns tagged-state verification."
else
  echo "Running strict release preflight..."
  bash scripts/release-preflight.sh --strict --target-version "${RELEASE_VERSION}"
fi

EXISTING_VERSION="$(npm view "${PACKAGE_NAME}@${RELEASE_VERSION}" version 2>/dev/null || true)"
if [[ "$EXISTING_VERSION" == "$RELEASE_VERSION" ]]; then
  echo "Registry already serves ${PACKAGE_NAME}@${RELEASE_VERSION}; skipping npm publish and proceeding to verification."
else
  echo "Running npm publish..."
  if [[ -n "${NPM_TOKEN:-}" ]]; then
    echo "Publish auth mode: token"
    TMP_NPMRC="$(mktemp "${TMPDIR:-/tmp}/agentxchain-npmrc.XXXXXX")"
    chmod 600 "$TMP_NPMRC"
    printf '%s\n' "//registry.npmjs.org/:_authToken=${NPM_TOKEN}" > "$TMP_NPMRC"
    NPM_CONFIG_USERCONFIG="$TMP_NPMRC" npm publish --access public
  else
    echo "Publish auth mode: trusted publishing (OIDC)"
    npm publish --access public
  fi
fi

echo "Verifying registry visibility..."
for ((attempt = 1; attempt <= RETRY_ATTEMPTS; attempt++)); do
  PUBLISHED_VERSION="$(npm view "${PACKAGE_NAME}@${RELEASE_VERSION}" version 2>/dev/null || true)"
  if [[ "$PUBLISHED_VERSION" == "$RELEASE_VERSION" ]]; then
    echo "Verified ${PACKAGE_NAME}@${RELEASE_VERSION} on npm (attempt ${attempt}/${RETRY_ATTEMPTS})"
    exit 0
  fi

  if [[ "$attempt" -lt "$RETRY_ATTEMPTS" ]]; then
    echo "Registry not updated yet (attempt ${attempt}/${RETRY_ATTEMPTS}); retrying in ${RETRY_DELAY_SECONDS}s..."
    sleep "$RETRY_DELAY_SECONDS"
  fi
done

echo "Error: npm registry did not serve ${PACKAGE_NAME}@${RELEASE_VERSION} after ${RETRY_ATTEMPTS} attempts" >&2
exit 1
