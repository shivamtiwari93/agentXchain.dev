#!/bin/bash
INPUT=$(cat)
TOOL_NAME=$(echo "$INPUT" | jq -r '.tool_name // empty')

WRITE_TOOLS="editFiles|createFile|create_file|replace_string_in_file|deleteFile"

if echo "$TOOL_NAME" | grep -qE "^($WRITE_TOOLS)$"; then
  if [ -f "lock.json" ]; then
    HOLDER=$(cat lock.json | jq -r '.holder // empty')
    if [ -z "$HOLDER" ] || [ "$HOLDER" = "null" ]; then
      echo '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"You must claim lock.json before writing files. Write holder=your_agent_id first."}}'
      exit 0
    fi
  fi
fi

echo '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"allow"}}'
