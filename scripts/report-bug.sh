#!/usr/bin/env bash
# report-bug.sh — Report a bug to agentXchain.dev intake system
# Usage: bash report-bug.sh --description "what broke" [options]
#
# Called by beta testers (tusq.dev, diapr.ai) or their agents to file
# bug reports that feed into the governed intake pipeline.

set -euo pipefail

# ── Defaults ──────────────────────────────────────────────────────
DESCRIPTION=""
EVIDENCE_TEXT=""
EVIDENCE_URL=""
EVIDENCE_FILE=""
PRIORITY="p2"
REPORTER=""
RUN_ID=""
TURN_ID=""

# ─��� Where is agentXchain.dev? ────────────────────────────────────
AGENTXCHAIN_ROOT="${AGENTXCHAIN_DEV_ROOT:-}"
if [[ -z "$AGENTXCHAIN_ROOT" ]]; then
  # Try to resolve from this script's location
  SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  if [[ -f "$SCRIPT_DIR/../agentxchain.json" ]]; then
    AGENTXCHAIN_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
  else
    echo "ERROR: Cannot find agentXchain.dev workspace."
    echo "Set AGENTXCHAIN_DEV_ROOT or run from within the repo."
    exit 1
  fi
fi

# ── Parse args ───────────────────────────────────────────────────
while [[ $# -gt 0 ]]; do
  case "$1" in
    --description|-d)   DESCRIPTION="$2"; shift 2 ;;
    --evidence|-e)      EVIDENCE_TEXT="$2"; shift 2 ;;
    --evidence-url)     EVIDENCE_URL="$2"; shift 2 ;;
    --evidence-file)    EVIDENCE_FILE="$2"; shift 2 ;;
    --priority|-p)      PRIORITY="$2"; shift 2 ;;
    --reporter|-r)      REPORTER="$2"; shift 2 ;;
    --run-id)           RUN_ID="$2"; shift 2 ;;
    --turn-id)          TURN_ID="$2"; shift 2 ;;
    -h|--help)
      echo "Usage: bash report-bug.sh --description \"what broke\" [options]"
      echo ""
      echo "Options:"
      echo "  -d, --description TEXT   Bug description (required)"
      echo "  -e, --evidence TEXT      Evidence text (logs, error messages)"
      echo "  --evidence-url URL       URL to evidence (screenshot, CI run)"
      echo "  --evidence-file PATH     Path to evidence file"
      echo "  -p, --priority LEVEL     p0|p1|p2|p3 (default: p2)"
      echo "  -r, --reporter NAME      Reporter identity (default: auto-detect)"
      echo "  --run-id ID              Related agentxchain run ID"
      echo "  --turn-id ID             Related agentxchain turn ID"
      echo ""
      echo "Environment:"
      echo "  AGENTXCHAIN_DEV_ROOT     Path to agentXchain.dev workspace"
      exit 0
      ;;
    *) echo "Unknown option: $1"; exit 1 ;;
  esac
done

if [[ -z "$DESCRIPTION" ]]; then
  echo "ERROR: --description is required"
  echo "Usage: bash report-bug.sh --description \"what broke\""
  exit 1
fi

# ── Auto-detect reporter ─────────────────────────────────────────
if [[ -z "$REPORTER" ]]; then
  # Try git remote origin
  REPORTER="$(git config --get remote.origin.url 2>/dev/null | sed 's|.*[:/]||;s|\.git$||' || true)"
  if [[ -z "$REPORTER" ]]; then
    REPORTER="$(basename "$(pwd)")"
  fi
fi

# ── Build signal JSON ────────────────────────────────────────────
SIGNAL=$(cat <<ENDJSON
{
  "description": $(printf '%s' "$DESCRIPTION" | python3 -c "import json,sys; print(json.dumps(sys.stdin.read()))"),
  "reporter": $(printf '%s' "$REPORTER" | python3 -c "import json,sys; print(json.dumps(sys.stdin.read()))"),
  "requested_priority": "$PRIORITY"$(
    [[ -n "$RUN_ID" ]] && echo ", \"run_id\": \"$RUN_ID\"" || true
  )$(
    [[ -n "$TURN_ID" ]] && echo ", \"turn_id\": \"$TURN_ID\"" || true
  )
}
ENDJSON
)

# ── Build evidence JSON ──────────────────────────────────────────
if [[ -n "$EVIDENCE_TEXT" ]]; then
  EVIDENCE_JSON="$(printf '%s' "{\"type\":\"text\",\"value\":$(printf '%s' "$EVIDENCE_TEXT" | python3 -c "import json,sys; print(json.dumps(sys.stdin.read()))")}")"
elif [[ -n "$EVIDENCE_URL" ]]; then
  EVIDENCE_JSON="$(printf '%s' "$EVIDENCE_URL" | python3 -c 'import json,sys; print(json.dumps({"type":"url","value":sys.stdin.read()}))')"
elif [[ -n "$EVIDENCE_FILE" ]]; then
  EVIDENCE_JSON="$(printf '%s' "$EVIDENCE_FILE" | python3 -c 'import json,sys; print(json.dumps({"type":"file","value":sys.stdin.read()}))')"
else
  EVIDENCE_JSON='{"type":"text","value":"No additional evidence provided"}'
fi

# ── Record the intake ──────────────────────────────────────────��─
echo "Filing bug report to agentXchain.dev intake..."
echo "  Reporter:    $REPORTER"
echo "  Priority:    $PRIORITY"
echo "  Description: $DESCRIPTION"
echo ""

cd "$AGENTXCHAIN_ROOT"
SIGNAL="$SIGNAL" EVIDENCE_JSON="$EVIDENCE_JSON" \
  npx --yes -p agentxchain@latest -c 'agentxchain intake record --source manual --category beta_bug_report --signal "$SIGNAL" --evidence "$EVIDENCE_JSON"'

echo ""
echo "Bug report filed. The agentXchain governance loop will auto-triage"
echo "and route this to the dev agent for investigation."
