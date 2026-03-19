#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APPLESCRIPT_PATH="${SCRIPT_DIR}/agentxchain-autonudge.applescript"

PROJECT_ROOT="$(pwd)"
AUTO_SEND="false"
INTERVAL_SECONDS="3"

usage() {
  cat <<'EOF'
Usage: bash scripts/run-autonudge.sh [options]

Options:
  --project <path>     Project root that contains lock.json
  --send               Auto-send message (presses Enter after paste)
  --paste-only         Paste only (default, no Enter)
  --interval <seconds> Poll interval in seconds (default: 3)
  -h, --help           Show help

Example:
  bash scripts/run-autonudge.sh --project "$(pwd)" --send --interval 2
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --project)
      PROJECT_ROOT="$2"
      shift 2
      ;;
    --send)
      AUTO_SEND="true"
      shift
      ;;
    --paste-only)
      AUTO_SEND="false"
      shift
      ;;
    --interval)
      INTERVAL_SECONDS="$2"
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown option: $1"
      usage
      exit 1
      ;;
  esac
done

if ! command -v osascript >/dev/null 2>&1; then
  echo "osascript not found. This script requires macOS."
  exit 1
fi

if ! command -v jq >/dev/null 2>&1; then
  echo "jq not found. Install with: brew install jq"
  exit 1
fi

if [[ ! -f "${PROJECT_ROOT}/lock.json" ]]; then
  echo "lock.json not found in: ${PROJECT_ROOT}"
  echo "Run this from your AgentXchain project root, or pass --project <path>."
  exit 1
fi

if [[ ! -f "${APPLESCRIPT_PATH}" ]]; then
  echo "AppleScript not found: ${APPLESCRIPT_PATH}"
  exit 1
fi

WATCH_READY="false"
for _ in {1..10}; do
  if pgrep -f "agentxchain.*watch" >/dev/null 2>&1; then
    WATCH_READY="true"
    break
  fi
  sleep 1
done

if [[ "${WATCH_READY}" != "true" ]]; then
  echo "watch process not detected."
  echo "Run one of these first:"
  echo "  agentxchain watch"
  echo "  agentxchain supervise --autonudge"
  exit 1
fi

if [[ ! -f "${PROJECT_ROOT}/.agentxchain-trigger.json" ]]; then
  echo "warning: .agentxchain-trigger.json does not exist yet."
  echo "auto-nudge will start, but nudges begin only after watch writes a trigger."
fi

echo ""
echo "AgentXchain auto-nudge starting..."
echo "Project:   ${PROJECT_ROOT}"
echo "Mode:      $( [[ "${AUTO_SEND}" == "true" ]] && echo "auto-send" || echo "paste-only" )"
echo "Interval:  ${INTERVAL_SECONDS}s"
echo ""
echo "Requirements:"
echo "- Keep 'agentxchain watch' running in another terminal."
echo "- Grant Accessibility permission to Terminal and Cursor."
echo ""

osascript "${APPLESCRIPT_PATH}" "${PROJECT_ROOT}" "${AUTO_SEND}" "${INTERVAL_SECONDS}"
