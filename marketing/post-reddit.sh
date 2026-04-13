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

source "${RBROWSER_DIR}/.venv/bin/activate"

if [[ -n "$BODY" ]]; then
  r-browser --min-delay 2 --max-delay 5 post create "$SUBREDDIT" "$TITLE" --body "$BODY"
else
  r-browser --min-delay 2 --max-delay 5 post create "$SUBREDDIT" "$TITLE"
fi
