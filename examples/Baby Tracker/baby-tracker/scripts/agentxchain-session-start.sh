#!/bin/bash
if [ ! -f "lock.json" ] || [ ! -f "state.json" ]; then
  echo '{"continue":true}'
  exit 0
fi

LOCK=$(cat lock.json 2>/dev/null)
STATE=$(cat state.json 2>/dev/null)

HOLDER=$(echo "$LOCK" | jq -r '.holder // "none"')
TURN=$(echo "$LOCK" | jq -r '.turn_number // 0')
LAST=$(echo "$LOCK" | jq -r '.last_released_by // "none"')
PHASE=$(echo "$STATE" | jq -r '.phase // "unknown"')
BLOCKED=$(echo "$STATE" | jq -r '.blocked // false')
PROJECT=$(echo "$STATE" | jq -r '.project // "unknown"')

CONTEXT="AgentXchain context: Project=$PROJECT | Phase=$PHASE | Turn=$TURN | Lock=$HOLDER | Last released by=$LAST | Blocked=$BLOCKED"

echo "{\"hookSpecificOutput\":{\"hookEventName\":\"SessionStart\",\"additionalContext\":\"$CONTEXT\"}}"
