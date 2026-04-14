#!/usr/bin/env bash
# Post to X/Twitter via x-browser (browser automation, no API keys needed).
# Usage: bash marketing/post-twitter.sh "Your tweet text here"
# Retries once on failure — the twc-cc-mask overlay is intermittent.
set -euo pipefail

XBROWSER_DIR="/Users/shivamtiwari.highlevel/VS Code/1008apps/x-browser"
XBROWSER_BIN="${XBROWSER_DIR}/.venv/bin/x-browser"
TEXT="${1:?Usage: bash marketing/post-twitter.sh \"tweet text\"}"
USE_SYSTEM_PROFILE="${AGENTXCHAIN_X_USE_SYSTEM_PROFILE:-1}"
PORT_FILE="${HOME}/.config/x-browser/chrome.port"

if [ ! -x "${XBROWSER_BIN}" ]; then
  echo "x-browser binary not found at ${XBROWSER_BIN}" >&2
  exit 1
fi

preflight_system_profile_lock() {
  if [ "${USE_SYSTEM_PROFILE}" != "1" ]; then
    return 0
  fi

  if ! pgrep -x "Google Chrome" >/dev/null 2>&1; then
    return 0
  fi

  if [ -f "${PORT_FILE}" ]; then
    local port
    port="$(cat "${PORT_FILE}" 2>/dev/null || true)"
    if [ -n "${port}" ] && curl -fsS "http://127.0.0.1:${port}/json/version" >/dev/null 2>&1; then
      return 0
    fi
  fi

  cat >&2 <<'EOF'
x-browser is configured to use the live system Chrome profile, but Google Chrome is already running without an x-browser DevTools session.
On macOS that means Chrome exits immediately when x-browser tries to launch a second process against the same profile, so posting will fail before DevTools comes up.

Recovery paths:
1. Close Google Chrome and rerun this command.
2. Log into the isolated x-browser profile once, then rerun with AGENTXCHAIN_X_USE_SYSTEM_PROFILE=0.
EOF
  return 1
}

ARGS=(--min-delay 2 --max-delay 5)
if [ "${USE_SYSTEM_PROFILE}" = "1" ]; then
  ARGS=(--system-profile "${ARGS[@]}")
fi

preflight_system_profile_lock

if "${XBROWSER_BIN}" "${ARGS[@]}" tweet post "$TEXT"; then
  exit 0
fi

echo "⚠️  First attempt failed — retrying after 5s cooldown..."
sleep 5
"${XBROWSER_BIN}" "${ARGS[@]}" tweet post "$TEXT"
