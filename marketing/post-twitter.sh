#!/usr/bin/env bash
# Post to X/Twitter via x-browser (browser automation, no API keys needed).
# Usage: bash marketing/post-twitter.sh "Your tweet text here"
set -euo pipefail

XBROWSER_DIR="/Users/shivamtiwari.highlevel/VS Code/1008apps/x-browser"
TEXT="${1:?Usage: bash marketing/post-twitter.sh \"tweet text\"}"

source "${XBROWSER_DIR}/.venv/bin/activate"
x-browser --system-profile --min-delay 2 --max-delay 5 tweet post "$TEXT"
