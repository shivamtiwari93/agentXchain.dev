#!/usr/bin/env bash
# Prepublish gate — local-first quality floor before `git tag`.
#
# Replaces per-commit remote CI coverage that `.github/workflows/ci.yml` will
# drop when CICD-SHRINK lands. Runs the same checks the GitHub-hosted runners
# ran, in-process on the agent's box, before any tag or publish-workflow is
# triggered. See .planning/CICD_REDUCTION_PLAN.md §7.
#
# Usage:
#   bash cli/scripts/prepublish-gate.sh <target-version>
#
# Exit 0 + prints "PREPUBLISH GATE PASSED for <version>" → safe to tag/push.
# Exit non-zero → do NOT tag, do NOT push. Fix the failure locally first.
#
# Discipline rule (CICD-SHRINK acceptance, new in DEC-RELEASE-CUT-AND-PUSH-AS-ATOMIC-001):
# the release-cut turn MUST include this script's "PREPUBLISH GATE PASSED" line
# in the turn's Evidence block before `git tag` is created.

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
CLI_DIR="${SCRIPT_DIR}/.."
cd "$CLI_DIR"

usage() {
  echo "Usage: bash cli/scripts/prepublish-gate.sh <target-version>" >&2
  echo "  <target-version>  Semver string (e.g., 2.150.0)." >&2
}

if [[ $# -ne 1 ]]; then
  usage
  exit 1
fi

TARGET_VERSION="$1"
if ! [[ "$TARGET_VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo "Error: invalid semver '${TARGET_VERSION}'" >&2
  usage
  exit 1
fi

echo "Prepublish gate — target version ${TARGET_VERSION}"
echo "================================================="
echo "cwd: ${CLI_DIR}"
echo ""

STEP_STATUS=0
step_fail() {
  echo ""
  echo "  FAIL: $1"
  STEP_STATUS=1
}

# ---------------------------------------------------------------------------
# Step 1 — Full test suite (replaces per-push CI).
#
# Runs via `npm test` so Vitest + Node test phases are both exercised, and the
# Node phase inherits the `--test-timeout=60000 --test-concurrency=4` caps from
# package.json (DEC-BUG57-FAILFAST-NODE-TEST-001). We pass `--test-timeout`
# explicitly too so the gate cannot be silently weakened by a future
# package.json change. The node runner honors the last `--test-timeout` wins.
# ---------------------------------------------------------------------------
echo "[1/4] Full test suite — cd cli && npm test -- --test-timeout=60000"
if npm test -- --test-timeout=60000; then
  echo "  PASS: full test suite green"
else
  step_fail "full test suite failed"
fi
echo ""

# ---------------------------------------------------------------------------
# Step 2 — Release preflight in publish-gate mode.
#
# `release-preflight.sh --publish-gate` enforces strict mode (clean tree,
# bumped package.json, CHANGELOG entry present, release-alignment manifest
# aligned, pack dry-run succeeds) and runs only the release-gate-critical
# test subset. Step 1 already ran the full suite; step 2 enforces the
# release-specific invariants.
# ---------------------------------------------------------------------------
echo "[2/4] Release preflight — bash scripts/release-preflight.sh --publish-gate"
if bash "${SCRIPT_DIR}/release-preflight.sh" --publish-gate --target-version "${TARGET_VERSION}"; then
  echo "  PASS: release-preflight gate green"
else
  step_fail "release-preflight gate failed"
fi
echo ""

# ---------------------------------------------------------------------------
# Step 3 — npm pack --dry-run (claim-reality coverage).
#
# Proves the tarball the publish workflow will upload is reproducible from
# HEAD. The publish workflow itself re-runs this; we catch pack failures here
# before the tag is even created, so a broken `files:` glob or missing dist
# artifact never reaches remote CI.
# ---------------------------------------------------------------------------
echo "[3/4] Pack dry-run — npm pack --dry-run"
if npm pack --dry-run >/dev/null 2>&1; then
  echo "  PASS: npm pack --dry-run succeeded"
else
  step_fail "npm pack --dry-run failed (rerun with streamed output for details)"
  npm pack --dry-run 2>&1 | tail -20 || true
fi
echo ""

# ---------------------------------------------------------------------------
# Step 4 — Release-alignment manifest (17-surface drift gate).
#
# `check-release-alignment.mjs` owns the shared manifest of every surface that
# must reference the target version (CHANGELOG, website release pages,
# capabilities.json, implementor guide, launch evidence, onboarding docs,
# marketing drafts, llms.txt, homebrew mirror, package.json). Step 2 runs the
# same check, but we invoke it directly so the final status line is visible
# in the gate's own output — agents reading this log get an explicit
# alignment-pass signal without having to scrape the preflight's mid-run
# block.
# ---------------------------------------------------------------------------
echo "[4/4] Release alignment — node scripts/check-release-alignment.mjs --scope current"
if node "${SCRIPT_DIR}/check-release-alignment.mjs" --scope current --target-version "${TARGET_VERSION}"; then
  echo "  PASS: release alignment green"
else
  step_fail "release alignment failed"
fi
echo ""

echo "================================================="
if [[ "${STEP_STATUS}" -ne 0 ]]; then
  echo "PREPUBLISH GATE FAILED for ${TARGET_VERSION} — do NOT tag, do NOT push."
  exit 1
fi

echo "PREPUBLISH GATE PASSED for ${TARGET_VERSION} — safe to tag and push."
exit 0
