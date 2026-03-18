#!/usr/bin/env bash
# release.sh — Release the lock after completing work.
# Usage: ./release.sh <agent-id>
# If verify_command is set in agentxchain.json, it must pass before release.
# Exit 0 if released, exit 1 if verify failed or agent didn't hold the lock.
set -e

if [[ -z "$1" ]]; then
  echo "Usage: release.sh <agent-id>" >&2
  exit 1
fi

AGENT_ID="$1"
LOCK="./lock.json"
CONFIG="./agentxchain.json"

if [[ ! -f "$LOCK" ]]; then
  echo "Error: lock.json not found in current directory" >&2
  exit 1
fi

HOLDER=$(node -e "const l=JSON.parse(require('fs').readFileSync('$LOCK','utf8')); console.log(l.holder || 'null')" 2>/dev/null)

if [[ "$HOLDER" != "$AGENT_ID" ]]; then
  echo "Error: Lock is held by '$HOLDER', not '$AGENT_ID'. Cannot release."
  exit 1
fi

# Run verify_command if configured
if [[ -f "$CONFIG" ]]; then
  VERIFY_CMD=$(node -e "
    const c=JSON.parse(require('fs').readFileSync('$CONFIG','utf8'));
    console.log(c.rules?.verify_command || '');
  " 2>/dev/null)

  if [[ -n "$VERIFY_CMD" ]]; then
    echo "Running verify: $VERIFY_CMD"
    if eval "$VERIFY_CMD"; then
      echo "Verify passed."
    else
      echo "Error: Verify command failed. Fix the issue before releasing."
      exit 1
    fi
  fi
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
