#!/usr/bin/env bash
# Agent 4 polling loop: sleep 60, check lock.json for current_holder=4.
# When it's Agent 4's turn, prints instructions to run Agent 4 in Cursor.
# Run in terminal: ./agent4-loop.sh  (or: bash agent4-loop.sh)
# Stop with Ctrl+C.

set -e
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$DIR"

echo "Agent 4 loop started. Checking lock every 60s. Stop with Ctrl+C."
while true; do
  sleep 60
  HOLDER=$(node -e "console.log(require('./lock.json').current_holder)" 2>/dev/null || echo "?")
  if [ "$HOLDER" = "4" ]; then
    echo ""
    echo ">>> current_holder is 4 — Agent 4's turn. Run Agent 4 in Cursor now. <<<"
    echo ""
  else
    echo "$(date +%H:%M:%S) Not Agent 4's turn (current_holder=$HOLDER). Waiting 60s..."
  fi
done
