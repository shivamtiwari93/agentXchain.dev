#!/usr/bin/env bash
# Post to X/Twitter via x-browser (browser automation, no API keys needed).
# Usage: bash marketing/post-twitter.sh "Your tweet text here"
# Retries once on failure — the twc-cc-mask overlay is intermittent.
set -euo pipefail

XBROWSER_DIR="/Users/shivamtiwari.highlevel/VS Code/1008apps/x-browser"
XBROWSER_BIN="${XBROWSER_DIR}/.venv/bin/x-browser"
TEXT="${1:?Usage: bash marketing/post-twitter.sh \"tweet text\"}"
USE_SYSTEM_PROFILE="${AGENTXCHAIN_X_USE_SYSTEM_PROFILE:-1}"
DISABLE_PROFILE_FALLBACK="${AGENTXCHAIN_X_DISABLE_PROFILE_FALLBACK:-0}"
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

profile_label() {
  if [ "${1}" = "1" ]; then
    printf 'system-profile'
  else
    printf 'isolated-profile'
  fi
}

run_xbrowser_post() {
  local use_system_profile="$1"
  local args=(--min-delay 2 --max-delay 5)

  if [ "${use_system_profile}" = "1" ]; then
    args=(--system-profile "${args[@]}")
    preflight_system_profile_lock
  fi

  "${XBROWSER_BIN}" "${args[@]}" tweet post "$TEXT"
}

is_ambiguous_tweet_submit_failure() {
  printf '%s' "$1" | grep -Fq 'still on compose page after clicking Post'
}

attempt_twitter_post() {
  local use_system_profile="$1"
  local mode
  mode="$(profile_label "${use_system_profile}")"

  echo "Attempting X/Twitter post with ${mode}..." >&2

  local output status
  output="$({ run_xbrowser_post "${use_system_profile}"; } 2>&1)" && status=0 || status=$?
  if [ "${status}" -eq 0 ]; then
    if [ -n "${output}" ]; then
      printf '%s\n' "${output}"
    fi
    return 0
  fi

  LAST_X_STATUS="${status}"
  LAST_X_OUTPUT="${output}"
  LAST_X_MODE="${use_system_profile}"
  if [ -n "${output}" ]; then
    printf '%s\n' "${output}" >&2
  fi
  return "${LAST_X_STATUS}"
}

PRIMARY_MODE="${USE_SYSTEM_PROFILE}"
SECONDARY_MODE="1"
if [ "${PRIMARY_MODE}" = "1" ]; then
  SECONDARY_MODE="0"
fi

if attempt_twitter_post "${PRIMARY_MODE}"; then
  exit 0
fi

if is_ambiguous_tweet_submit_failure "${LAST_X_OUTPUT}"; then
  echo "X/Twitter submit outcome is ambiguous; suppressing automatic retry to avoid duplicate tweets." >&2
  exit "${LAST_X_STATUS}"
fi

if [ "${DISABLE_PROFILE_FALLBACK}" = "1" ]; then
  echo "X/Twitter profile fallback disabled; not retrying with $(profile_label "${SECONDARY_MODE}")." >&2
  exit "${LAST_X_STATUS}"
fi

echo "X/Twitter post failed with $(profile_label "${PRIMARY_MODE}"); retrying once with $(profile_label "${SECONDARY_MODE}") after 5s..." >&2
sleep 5
attempt_twitter_post "${SECONDARY_MODE}"
