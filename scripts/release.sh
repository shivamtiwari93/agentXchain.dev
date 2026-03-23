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
  if ! node <<'EOF' "$CONFIG"
const fs = require('fs');
const { spawnSync } = require('child_process');

function splitCommand(input) {
  const out = [];
  let current = '';
  let quote = null;
  let escape = false;
  for (const char of String(input || '')) {
    if (escape) {
      current += char;
      escape = false;
      continue;
    }
    if (char === '\\') {
      escape = true;
      continue;
    }
    if (quote) {
      if (char === quote) quote = null;
      else current += char;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (/\s/.test(char)) {
      if (current) {
        out.push(current);
        current = '';
      }
      continue;
    }
    current += char;
  }
  if (current) out.push(current);
  return out;
}

const configPath = process.argv[2];
const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
const raw = config.rules?.verify_command;
const args = Array.isArray(raw) ? raw : splitCommand(raw);

if (!args || args.length === 0) {
  process.exit(0);
}

console.log(`Running verify: ${args.join(' ')}`);
const result = spawnSync(args[0], args.slice(1), { stdio: 'inherit' });
if (result.status !== 0) {
  process.exit(result.status || 1);
}
console.log('Verify passed.');
EOF
  then
    echo "Error: Verify command failed. Fix the issue before releasing."
    exit 1
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
