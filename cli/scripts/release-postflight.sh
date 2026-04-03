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
RETRY_ATTEMPTS="${RELEASE_POSTFLIGHT_RETRY_ATTEMPTS:-12}"
RETRY_DELAY_SECONDS="${RELEASE_POSTFLIGHT_RETRY_DELAY_SECONDS:-10}"

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

if ! [[ "$RETRY_ATTEMPTS" =~ ^[0-9]+$ ]] || [[ "$RETRY_ATTEMPTS" -lt 1 ]]; then
  echo "Error: RELEASE_POSTFLIGHT_RETRY_ATTEMPTS must be a positive integer" >&2
  exit 1
fi

if ! [[ "$RETRY_DELAY_SECONDS" =~ ^[0-9]+$ ]]; then
  echo "Error: RELEASE_POSTFLIGHT_RETRY_DELAY_SECONDS must be a non-negative integer" >&2
  exit 1
fi

PASS=0
FAIL=0
TARBALL_URL=""
REGISTRY_CHECKSUM=""
PACKAGE_NAME="$(node -e "console.log(JSON.parse(require('fs').readFileSync('package.json', 'utf8')).name)")"
PACKAGE_BIN_NAME="$(node -e "const pkg = JSON.parse(require('fs').readFileSync('package.json', 'utf8')); if (typeof pkg.bin === 'string') { console.log(pkg.name); process.exit(0); } const names = Object.keys(pkg.bin || {}); if (names.length !== 1) { console.error('package.json bin must declare exactly one entry'); process.exit(1); } console.log(names[0]);")"

pass() { PASS=$((PASS + 1)); echo "  PASS: $1"; }
fail() { FAIL=$((FAIL + 1)); echo "  FAIL: $1"; }

run_and_capture() {
  local __var_name="$1"
  shift

  local captured_output
  local status
  captured_output="$("$@" 2>&1)"
  status=$?

  printf -v "$__var_name" '%s' "$captured_output"
  return "$status"
}

trim_last_line() {
  printf '%s\n' "$1" | awk 'NF { line=$0 } END { gsub(/^[[:space:]]+|[[:space:]]+$/, "", line); print line }'
}

run_install_smoke() {
  if [[ -z "$TARBALL_URL" ]]; then
    echo "registry tarball metadata unavailable for install smoke" >&2
    return 1
  fi

  local smoke_root
  local bin_path
  local install_status
  local version_status

  smoke_root="$(mktemp -d "${TMPDIR:-/tmp}/agentxchain-postflight.XXXXXX")"
  bin_path="${smoke_root}/bin/${PACKAGE_BIN_NAME}"

  # Isolate the install from CI auth environment (OIDC tokens from actions/setup-node
  # are scoped for publish, not read, and can cause npm install to fail on public packages).
  local smoke_npmrc="${smoke_root}/.npmrc"
  echo "registry=https://registry.npmjs.org/" > "$smoke_npmrc"

  env -u NODE_AUTH_TOKEN NPM_CONFIG_USERCONFIG="$smoke_npmrc" \
    npm install --global --prefix "$smoke_root" "$TARBALL_URL" >/dev/null 2>&1
  install_status=$?
  if [[ "$install_status" -ne 0 ]]; then
    rm -rf "$smoke_root"
    return "$install_status"
  fi

  if [[ ! -x "$bin_path" ]]; then
    echo "installed binary missing at ${bin_path}" >&2
    rm -rf "$smoke_root"
    return 1
  fi

  "$bin_path" --version
  version_status=$?
  rm -rf "$smoke_root"
  return "$version_status"
}

run_with_retry() {
  local __output_var="$1"
  local description="$2"
  local success_mode="$3"
  local expected_value="$4"
  shift 4

  local output=""
  local status=0
  local value=""
  local attempt=1

  while [[ "$attempt" -le "$RETRY_ATTEMPTS" ]]; do
    if run_and_capture output "$@"; then
      status=0
    else
      status=$?
    fi

    value="$(trim_last_line "$output")"

    case "$success_mode" in
      equals)
        if [[ "$status" -eq 0 && "$value" == "$expected_value" ]]; then
          printf -v "$__output_var" '%s' "$output"
          return 0
        fi
        ;;
      nonempty)
        if [[ "$status" -eq 0 && -n "$value" ]]; then
          printf -v "$__output_var" '%s' "$output"
          return 0
        fi
        ;;
      *)
        echo "Error: unsupported retry success mode '${success_mode}'" >&2
        exit 1
        ;;
    esac

    if [[ "$attempt" -lt "$RETRY_ATTEMPTS" ]]; then
      echo "  INFO: ${description} not ready (attempt ${attempt}/${RETRY_ATTEMPTS}); retrying in ${RETRY_DELAY_SECONDS}s..."
      sleep "$RETRY_DELAY_SECONDS"
    fi
    attempt=$((attempt + 1))
  done

  printf -v "$__output_var" '%s' "$output"
  return 1
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
if run_with_retry VERSION_OUTPUT "registry version" equals "${TARGET_VERSION}" npm view "${PACKAGE_NAME}@${TARGET_VERSION}" version; then
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
if run_with_retry TARBALL_OUTPUT "registry tarball metadata" nonempty "" npm view "${PACKAGE_NAME}@${TARGET_VERSION}" dist.tarball; then
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
if run_with_retry INTEGRITY_OUTPUT "registry checksum metadata" nonempty "" npm view "${PACKAGE_NAME}@${TARGET_VERSION}" dist.integrity; then
  REGISTRY_CHECKSUM="$(trim_last_line "$INTEGRITY_OUTPUT")"
fi
if [[ -z "$REGISTRY_CHECKSUM" ]]; then
  if run_with_retry SHASUM_OUTPUT "registry shasum metadata" nonempty "" npm view "${PACKAGE_NAME}@${TARGET_VERSION}" dist.shasum; then
    REGISTRY_CHECKSUM="$(trim_last_line "$SHASUM_OUTPUT")"
  fi
fi
if [[ -n "$REGISTRY_CHECKSUM" ]]; then
  pass "registry exposes checksum metadata"
else
  fail "registry did not return checksum metadata"
fi

echo "[5/5] Install smoke"
if run_with_retry EXEC_OUTPUT "install smoke" nonempty "" run_install_smoke; then
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
