#!/usr/bin/env bash
# End-to-end test: launch agents via Cursor Cloud API, run watch, verify 3-turn cycle.
# Prerequisites:
#   - CURSOR_API_KEY set in .env
#   - A GitHub repo with agentxchain.json committed
#   - npm install in cli/
#
# Usage: cd into your agentxchain project folder, then:
#   bash /path/to/cli/test/e2e-cursor.sh
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CLI="$SCRIPT_DIR/../bin/agentxchain.js"

echo "=== AgentXchain E2E Test: Cursor Cloud Agents ==="
echo ""

# Step 1: Check prerequisites
echo "--- Checking prerequisites ---"
if [[ -z "$CURSOR_API_KEY" ]]; then
  echo "ERROR: CURSOR_API_KEY not set. Source your .env first."
  exit 1
fi
if [[ ! -f "agentxchain.json" ]]; then
  echo "ERROR: agentxchain.json not found. Run from an agentxchain project folder."
  exit 1
fi
echo "  CURSOR_API_KEY: set"
echo "  agentxchain.json: found"
echo "  Project: $(node -e "console.log(JSON.parse(require('fs').readFileSync('agentxchain.json','utf8')).project)")"
echo ""

# Step 2: Show status
echo "--- Current status ---"
node "$CLI" status
echo ""

# Step 3: Launch agents
echo "--- Launching agents via Cursor Cloud API ---"
node "$CLI" start --ide cursor
echo ""

# Step 4: Show status with Cursor info
echo "--- Status after launch ---"
node "$CLI" status
echo ""

# Step 5: Start watch (runs for 120 seconds then stops)
echo "--- Starting watch (120s timeout) ---"
echo "  The watch process will:"
echo "    1. Detect lock is free"
echo "    2. Send followup to first agent"
echo "    3. Wait for agent to claim, work, release"
echo "    4. Send followup to next agent"
echo "    5. Repeat"
echo ""
echo "  Press Ctrl+C to stop early, or wait 120s."
echo ""

timeout 120 node "$CLI" watch || true

echo ""
echo "--- Final status ---"
node "$CLI" status
echo ""

# Step 6: Check turn number
TURN=$(node -e "console.log(JSON.parse(require('fs').readFileSync('lock.json','utf8')).turn_number)")
echo "  Turn number: $TURN"
if [[ "$TURN" -ge 3 ]]; then
  echo "  ✓ SUCCESS: At least 3 turns completed."
else
  echo "  ⚠ Only $TURN turns completed. Agents may need more time."
fi

echo ""
echo "--- Stopping agents ---"
node "$CLI" stop
echo ""
echo "=== E2E test complete ==="
