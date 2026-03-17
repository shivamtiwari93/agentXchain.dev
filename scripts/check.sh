#!/usr/bin/env bash
# check.sh — Print lock status. Optionally check if a specific agent can claim.
# Usage:
#   ./check.sh              Print current holder and turn number.
#   ./check.sh pm           Exit 0 if lock is free (pm could claim), exit 1 otherwise.
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LOCK="${SCRIPT_DIR}/../lock.json"

if [[ ! -f "$LOCK" ]]; then
  # Try current directory
  LOCK="./lock.json"
fi

if [[ ! -f "$LOCK" ]]; then
  echo "Error: lock.json not found" >&2
  exit 1
fi

HOLDER=$(node -e "const l=JSON.parse(require('fs').readFileSync('$LOCK','utf8')); console.log(l.holder || 'null')" 2>/dev/null)
TURN=$(node -e "const l=JSON.parse(require('fs').readFileSync('$LOCK','utf8')); console.log(l.turn_number)" 2>/dev/null)
LAST=$(node -e "const l=JSON.parse(require('fs').readFileSync('$LOCK','utf8')); console.log(l.last_released_by || 'none')" 2>/dev/null)

if [[ -z "$1" ]]; then
  if [[ "$HOLDER" == "null" ]]; then
    echo "Lock is FREE (turn $TURN, last released by: $LAST)"
  else
    echo "Lock held by: $HOLDER (turn $TURN)"
  fi
  exit 0
fi

AGENT_ID="$1"
if [[ "$HOLDER" == "null" ]]; then
  echo "Lock is free. $AGENT_ID can claim."
  exit 0
else
  echo "Lock held by $HOLDER. $AGENT_ID cannot claim."
  exit 1
fi
