#!/usr/bin/env bash
# claim.sh — Attempt to claim the lock for an agent.
# Usage: ./claim.sh <agent-id>
# Exit 0 if claimed successfully, exit 1 if lock was not free or claim lost.
set -e

if [[ -z "$1" ]]; then
  echo "Usage: claim.sh <agent-id>" >&2
  exit 1
fi

AGENT_ID="$1"
LOCK="./lock.json"

if [[ ! -f "$LOCK" ]]; then
  echo "Error: lock.json not found in current directory" >&2
  exit 1
fi

HOLDER=$(node -e "const l=JSON.parse(require('fs').readFileSync('$LOCK','utf8')); console.log(l.holder || 'null')" 2>/dev/null)

if [[ "$HOLDER" != "null" ]]; then
  echo "Lock held by $HOLDER. Cannot claim."
  exit 1
fi

TIMESTAMP=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
TURN=$(node -e "const l=JSON.parse(require('fs').readFileSync('$LOCK','utf8')); console.log(l.turn_number)" 2>/dev/null)
LAST=$(node -e "const l=JSON.parse(require('fs').readFileSync('$LOCK','utf8')); console.log(l.last_released_by || 'null')" 2>/dev/null)

node -e "
const fs = require('fs');
const lock = JSON.parse(fs.readFileSync('$LOCK', 'utf8'));
lock.holder = '$AGENT_ID';
lock.claimed_at = '$TIMESTAMP';
fs.writeFileSync('$LOCK', JSON.stringify(lock, null, 2) + '\n');
" 2>/dev/null

sleep 0.1

VERIFY=$(node -e "const l=JSON.parse(require('fs').readFileSync('$LOCK','utf8')); console.log(l.holder || 'null')" 2>/dev/null)

if [[ "$VERIFY" == "$AGENT_ID" ]]; then
  echo "Claimed by $AGENT_ID at $TIMESTAMP (turn $TURN)"
  exit 0
else
  echo "Claim lost to $VERIFY. Try again."
  exit 1
fi
