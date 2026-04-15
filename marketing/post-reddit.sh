#!/usr/bin/env bash
# Post to r/agentXchain_dev via r-browser (browser automation, no API keys needed).
# Usage: bash marketing/post-reddit.sh "Post title" "Post body (optional)"
set -euo pipefail

RBROWSER_DIR="/Users/shivamtiwari.highlevel/VS Code/1008apps/r-browser"
SUBREDDIT="agentXchain_dev"
TITLE="${1:?Usage: bash marketing/post-reddit.sh \"title\" \"body (optional)\"}"
BODY_RAW="${2:-}"

# Convert literal \n sequences to real newlines so Reddit renders paragraphs correctly.
# Without this, URLs and following text get fused into broken links.
BODY="$(printf '%b' "$BODY_RAW")"

# Preflight: warn if another browser-automation Chrome is already running on a conflicting profile.
preflight_chrome_contention() {
  if pgrep -f "user-data-dir=.*r-browser/chrome-data" >/dev/null 2>&1; then
    return 0  # r-browser's own Chrome is already up — tool should reuse it
  fi
  if pgrep -f "user-data-dir=.*(x-browser|li-browser)/chrome-data" >/dev/null 2>&1; then
    echo "⚠️  Another browser-automation Chrome instance is running (x-browser or li-browser)." >&2
    echo "   r-browser may fail to open DevTools. Kill the other instance first." >&2
  fi
}

preflight_chrome_contention

source "${RBROWSER_DIR}/.venv/bin/activate"

if [[ -n "$BODY" ]]; then
  r-browser --min-delay 2 --max-delay 5 post create "$SUBREDDIT" "$TITLE" --body "$BODY"
else
  r-browser --min-delay 2 --max-delay 5 post create "$SUBREDDIT" "$TITLE"
fi
