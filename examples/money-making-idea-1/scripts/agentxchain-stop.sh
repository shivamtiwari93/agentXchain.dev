#!/bin/bash
INPUT=$(cat)
STOP_HOOK_ACTIVE=$(echo "$INPUT" | jq -r '.stop_hook_active // false')

if [ "$STOP_HOOK_ACTIVE" = "true" ]; then
  echo '{"continue":true}'
  exit 0
fi

if [ ! -f "lock.json" ]; then
  echo '{"continue":true}'
  exit 0
fi

LOCK=$(cat lock.json 2>/dev/null)
HOLDER=$(echo "$LOCK" | jq -r '.holder // empty')
TURN=$(echo "$LOCK" | jq -r '.turn_number // 0')

if [ -z "$HOLDER" ] || [ "$HOLDER" = "null" ]; then
  LAST=$(echo "$LOCK" | jq -r '.last_released_by // empty')

  if [ ! -f "agentxchain.json" ]; then
    echo '{"continue":true}'
    exit 0
  fi

  NEXT=$(node -e "
    const cfg = JSON.parse(require('fs').readFileSync('agentxchain.json','utf8'));
    const ids = Object.keys(cfg.agents);
    const last = process.argv[1] || '';
    const idx = ids.indexOf(last);
    const next = ids[(idx + 1) % ids.length];
    process.stdout.write(next);
  " -- "$LAST" 2>/dev/null)

  if [ -z "$NEXT" ]; then
    echo '{"continue":true}'
    exit 0
  fi

  NEXT_NAME=$(node -e "
    const cfg = JSON.parse(require('fs').readFileSync('agentxchain.json','utf8'));
    const a = cfg.agents[process.argv[1]];
    process.stdout.write(a ? a.name : process.argv[1]);
  " -- "$NEXT" 2>/dev/null)

  echo "{\"hookSpecificOutput\":{\"hookEventName\":\"Stop\",\"decision\":\"block\",\"reason\":\"Turn $TURN complete. Next agent: $NEXT ($NEXT_NAME). Read lock.json, claim it, and do your work.\"}}"
elif [ "$HOLDER" = "human" ]; then
  echo '{"continue":true}'
else
  echo '{"continue":true}'
fi
