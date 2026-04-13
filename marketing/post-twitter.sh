#!/usr/bin/env bash
# Post to X/Twitter via x-browser (browser automation, no API keys needed).
# Usage: bash marketing/post-twitter.sh "Your tweet text here"
# Retries once on failure — the twc-cc-mask overlay is intermittent.
set -euo pipefail

XBROWSER_DIR="/Users/shivamtiwari.highlevel/VS Code/1008apps/x-browser"
TEXT="${1:?Usage: bash marketing/post-twitter.sh \"tweet text\"}"

source "${XBROWSER_DIR}/.venv/bin/activate"

if x-browser --system-profile --min-delay 2 --max-delay 5 tweet post "$TEXT"; then
  exit 0
fi

echo "⚠️  First attempt failed — retrying after 5s cooldown..."
sleep 5
x-browser --system-profile --min-delay 2 --max-delay 5 tweet post "$TEXT"
