#!/usr/bin/env bash
# Post to AgentXchain LinkedIn company page via li-browser (browser automation, no API keys needed).
# Usage: bash marketing/post-linkedin.sh "post text"
set -euo pipefail

LIBROWSER_DIR="/Users/shivamtiwari.highlevel/VS Code/1008apps/li-browser"
COMPANY_ID="112883208"
TEXT="${1:?Usage: bash marketing/post-linkedin.sh \"post text\"}"

source "${LIBROWSER_DIR}/.venv/bin/activate"

li-browser --system-profile --min-delay 2 --max-delay 5 post create "$TEXT" --company-id "$COMPANY_ID"
