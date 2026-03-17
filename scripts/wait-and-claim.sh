#!/usr/bin/env bash
# wait-and-claim.sh — Wait until the lock is free, then claim it.
# Usage: ./wait-and-claim.sh <agent-id> [poll-interval-seconds]
# Polls every N seconds (default 30). Exits 0 when claim succeeds.
set -e

if [[ -z "$1" ]]; then
  echo "Usage: wait-and-claim.sh <agent-id> [poll-seconds]" >&2
  exit 1
fi

AGENT_ID="$1"
POLL="${2:-30}"
LOCK="./lock.json"

if [[ ! -f "$LOCK" ]]; then
  echo "Error: lock.json not found in current directory" >&2
  exit 1
fi

echo "[$AGENT_ID] Waiting for lock to be free (polling every ${POLL}s)..."

while true; do
  HOLDER=$(node -e "const l=JSON.parse(require('fs').readFileSync('$LOCK','utf8')); console.log(l.holder || 'null')" 2>/dev/null)

  if [[ "$HOLDER" == "null" ]]; then
    SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
    if bash "$SCRIPT_DIR/claim.sh" "$AGENT_ID"; then
      exit 0
    fi
  fi

  echo "[$AGENT_ID] Lock held by $HOLDER. Waiting ${POLL}s..."
  sleep "$POLL"
done
