#!/usr/bin/env bash
set -euo pipefail

PIDS="$(pgrep -f "agentxchain-autonudge.applescript" || true)"

if [[ -z "${PIDS}" ]]; then
  echo "No running auto-nudge process found."
  exit 0
fi

echo "Stopping auto-nudge process(es): ${PIDS}"
kill ${PIDS}
echo "Stopped."
