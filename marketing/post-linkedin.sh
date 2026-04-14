#!/usr/bin/env bash
# Post to AgentXchain LinkedIn company page via li-browser (browser automation, no API keys needed).
# Usage: bash marketing/post-linkedin.sh "post text"
set -euo pipefail

LIBROWSER_DIR="/Users/shivamtiwari.highlevel/VS Code/1008apps/li-browser"
LIBROWSER_BIN="${LIBROWSER_DIR}/.venv/bin/li-browser"
COMPANY_ID="112883208"
TEXT="${1:?Usage: bash marketing/post-linkedin.sh \"post text\"}"
USE_SYSTEM_PROFILE="${AGENTXCHAIN_LINKEDIN_USE_SYSTEM_PROFILE:-0}"

if [ ! -x "${LIBROWSER_BIN}" ]; then
  echo "li-browser binary not found at ${LIBROWSER_BIN}" >&2
  exit 1
fi

ARGS=(--min-delay 2 --max-delay 5)
if [ "${USE_SYSTEM_PROFILE}" = "1" ]; then
  ARGS=(--system-profile "${ARGS[@]}")
fi

"${LIBROWSER_BIN}" "${ARGS[@]}" post create "$TEXT" --company-id "$COMPANY_ID"
