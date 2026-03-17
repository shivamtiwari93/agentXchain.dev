#!/usr/bin/env bash
# release.sh — Release the lock after completing work.
# Usage: ./release.sh <agent-id>
# Exit 0 if released, exit 1 if the agent didn't hold the lock.
set -e

if [[ -z "$1" ]]; then
  echo "Usage: release.sh <agent-id>" >&2
  exit 1
fi

AGENT_ID="$1"
LOCK="./lock.json"

if [[ ! -f "$LOCK" ]]; then
  echo "Error: lock.json not found in current directory" >&2
  exit 1
fi

HOLDER=$(node -e "const l=JSON.parse(require('fs').readFileSync('$LOCK','utf8')); console.log(l.holder || 'null')" 2>/dev/null)

if [[ "$HOLDER" != "$AGENT_ID" ]]; then
  echo "Error: Lock is held by '$HOLDER', not '$AGENT_ID'. Cannot release."
  exit 1
fi

node -e "
const fs = require('fs');
const lock = JSON.parse(fs.readFileSync('$LOCK', 'utf8'));
lock.holder = null;
lock.last_released_by = '$AGENT_ID';
lock.turn_number = lock.turn_number + 1;
lock.claimed_at = null;
fs.writeFileSync('$LOCK', JSON.stringify(lock, null, 2) + '\n');
console.log('Released by $AGENT_ID. Turn ' + lock.turn_number);
" 2>/dev/null
