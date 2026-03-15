#!/usr/bin/env bash
# Usage: ./scripts/wait-for-my-turn.sh AGENT_NUM [INTERVAL_SECONDS]
# Loops: sleep INTERVAL_SECONDS (default 60), check lock.json. When current_holder == AGENT_NUM, exit 0.
# No Node required; uses grep/sed. Run from mood-tracking-app folder or pass LOCK path via env.

set -e
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
LOCK_FILE="${LOCK_FILE:-$ROOT_DIR/lock.json}"
AGENT_NUM="${1:?Usage: $0 AGENT_NUM [INTERVAL_SECONDS]}"
INTERVAL="${2:-60}"

if [[ ! -f "$LOCK_FILE" ]]; then
  echo "lock.json not found: $LOCK_FILE" >&2
  exit 2
fi

while true; do
  echo "[$(date '+%H:%M:%S')] Waiting ${INTERVAL}s, then checking lock..."
  sleep "$INTERVAL"
  CURRENT=$(grep "current_holder" "$LOCK_FILE" | sed -E 's/.*"current_holder"[^0-9]*([0-9]+).*/\1/' | head -1)
  TURN=$(grep "turn_number" "$LOCK_FILE" | sed -E 's/.*"turn_number"[^0-9]*([0-9]+).*/\1/' | head -1)
  if [[ "$CURRENT" == "$AGENT_NUM" ]]; then
    echo "[$(date '+%H:%M:%S')] *** It's Agent ${AGENT_NUM}'s turn (turn_number=$TURN). Exiting so you can do your turn. ***"
    exit 0
  fi
  echo "[$(date '+%H:%M:%S')] Not your turn (current_holder=$CURRENT, turn_number=$TURN). Looping."
done
