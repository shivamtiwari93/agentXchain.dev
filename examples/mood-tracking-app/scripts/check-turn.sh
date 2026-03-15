#!/usr/bin/env bash
# Usage: ./scripts/check-turn.sh [AGENT_NUM]
# If AGENT_NUM is given, exits 0 if it's that agent's turn, else 1.
# If AGENT_NUM is omitted, prints current_holder and turn_number.

set -e
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
LOCK_FILE="$ROOT_DIR/lock.json"

if [[ ! -f "$LOCK_FILE" ]]; then
  echo "lock.json not found" >&2
  exit 2
fi

CURRENT=$(node -e "console.log(require('$LOCK_FILE').current_holder)")
TURN=$(node -e "console.log(require('$LOCK_FILE').turn_number)")

if [[ -n "${1:-}" ]]; then
  if [[ "$CURRENT" == "$1" ]]; then
    echo "Agent $1: it's your turn (turn_number=$TURN)"
    exit 0
  else
    echo "Not Agent $1's turn (current_holder=$CURRENT, turn_number=$TURN)"
    exit 1
  fi
else
  echo "current_holder=$CURRENT turn_number=$TURN"
fi
