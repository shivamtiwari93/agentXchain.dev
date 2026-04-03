#!/usr/bin/env bash
# Release postflight — run this after publish succeeds.
# Verifies: release tag exists, npm registry serves the version, metadata is present,
# and the published package can execute its CLI entrypoint.
# Usage: bash scripts/release-postflight.sh --target-version <semver> [--tag vX.Y.Z]
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
CLI_DIR="${SCRIPT_DIR}/.."
cd "$CLI_DIR"

TARGET_VERSION=""
TAG=""

usage() {
  echo "Usage: bash scripts/release-postflight.sh --target-version <semver> [--tag vX.Y.Z]" >&2
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
    --tag)
      if [[ -z "${2:-}" ]]; then
        echo "Error: --tag requires a git tag argument" >&2
        usage
        exit 1
      fi
      TAG="$2"
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

if [[ -z "$TAG" ]]; then
  TAG="v${TARGET_VERSION}"
fi

PASS=0
FAIL=0
TARBALL_URL=""
REGISTRY_CHECKSUM=""
PACKAGE_NAME="$(node -e "console.log(JSON.parse(require('fs').readFileSync('package.json', 'utf8')).name)")"

pass() { PASS=$((PASS + 1)); echo "  PASS: $1"; }
fail() { FAIL=$((FAIL + 1)); echo "  FAIL: $1"; }

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

trim_last_line() {
  printf '%s\n' "$1" | awk 'NF { line=$0 } END { gsub(/^[[:space:]]+|[[:space:]]+$/, "", line); print line }'
}

echo "AgentXchain v${TARGET_VERSION} Release Postflight"
echo "====================================="
echo "Checks release truth after publish: tag, registry visibility, metadata, and install smoke."
echo ""

echo "[1/5] Git tag"
if git rev-parse -q --verify "refs/tags/${TAG}" >/dev/null 2>&1; then
  pass "Git tag ${TAG} exists locally"
else
  fail "Git tag ${TAG} is missing locally"
fi

echo "[2/5] Registry version"
if run_and_capture VERSION_OUTPUT npm view "${PACKAGE_NAME}@${TARGET_VERSION}" version; then
  PUBLISHED_VERSION="$(trim_last_line "$VERSION_OUTPUT")"
  if [[ "$PUBLISHED_VERSION" == "$TARGET_VERSION" ]]; then
    pass "npm registry serves ${PACKAGE_NAME}@${TARGET_VERSION}"
  else
    fail "npm registry returned '${PUBLISHED_VERSION}', expected '${TARGET_VERSION}'"
  fi
else
  fail "npm registry does not serve ${PACKAGE_NAME}@${TARGET_VERSION}"
  printf '%s\n' "$VERSION_OUTPUT" | tail -20
fi

echo "[3/5] Registry tarball metadata"
if run_and_capture TARBALL_OUTPUT npm view "${PACKAGE_NAME}@${TARGET_VERSION}" dist.tarball; then
  TARBALL_URL="$(trim_last_line "$TARBALL_OUTPUT")"
  if [[ -n "$TARBALL_URL" ]]; then
    pass "registry exposes dist.tarball metadata"
  else
    fail "registry returned empty dist.tarball metadata"
  fi
else
  fail "registry did not return dist.tarball metadata"
  printf '%s\n' "$TARBALL_OUTPUT" | tail -20
fi

echo "[4/5] Registry checksum metadata"
if run_and_capture INTEGRITY_OUTPUT npm view "${PACKAGE_NAME}@${TARGET_VERSION}" dist.integrity; then
  REGISTRY_CHECKSUM="$(trim_last_line "$INTEGRITY_OUTPUT")"
fi
if [[ -z "$REGISTRY_CHECKSUM" ]]; then
  if run_and_capture SHASUM_OUTPUT npm view "${PACKAGE_NAME}@${TARGET_VERSION}" dist.shasum; then
    REGISTRY_CHECKSUM="$(trim_last_line "$SHASUM_OUTPUT")"
  fi
fi
if [[ -n "$REGISTRY_CHECKSUM" ]]; then
  pass "registry exposes checksum metadata"
else
  fail "registry did not return checksum metadata"
fi

echo "[5/5] Install smoke"
if run_and_capture EXEC_OUTPUT npm exec --yes --package "${PACKAGE_NAME}@${TARGET_VERSION}" -- agentxchain --version; then
  EXEC_VERSION="$(trim_last_line "$EXEC_OUTPUT")"
  if [[ "$EXEC_VERSION" == "$TARGET_VERSION" ]]; then
    pass "published CLI executes and reports ${TARGET_VERSION}"
  else
    fail "published CLI reported '${EXEC_VERSION}', expected '${TARGET_VERSION}'"
  fi
else
  fail "published CLI install smoke failed"
  printf '%s\n' "$EXEC_OUTPUT" | tail -20
fi

echo ""
echo "====================================="
echo "Results: ${PASS} passed, ${FAIL} failed"
if [[ -n "$TARBALL_URL" ]]; then
  echo "Tarball: ${TARBALL_URL}"
fi
if [[ -n "$REGISTRY_CHECKSUM" ]]; then
  echo "Checksum: ${REGISTRY_CHECKSUM}"
fi
if [ "$FAIL" -gt 0 ]; then
  echo "POSTFLIGHT FAILED — do not mark the release complete."
  exit 1
fi

echo "POSTFLIGHT PASSED — registry truth matches the release tag."
exit 0
