#!/bin/bash
# Usage: bash scripts/tweet-thread.sh "Tweet 1" "Tweet 2" "Tweet 3" ...
# Posts a thread by replying each tweet to the previous one.
# Waits 3 seconds between tweets to avoid rate limits.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if [ $# -lt 1 ]; then
  echo "Usage: bash scripts/tweet-thread.sh \"Tweet 1\" \"Tweet 2\" \"Tweet 3\" ..."
  exit 1
fi

LAST_ID=""
TWEET_NUM=0

for tweet in "$@"; do
  TWEET_NUM=$((TWEET_NUM + 1))
  echo ""
  echo "--- Tweet $TWEET_NUM/$# ---"

  if [ -z "$LAST_ID" ]; then
    # First tweet in thread
    OUTPUT=$(bash "$SCRIPT_DIR/tweet.sh" "$tweet" 2>&1)
  else
    # Reply to previous tweet
    OUTPUT=$(bash "$SCRIPT_DIR/tweet.sh" "$tweet" --reply-to "$LAST_ID" 2>&1)
  fi

  echo "$OUTPUT"

  # Extract tweet ID from the JSON output
  LAST_ID=$(echo "$OUTPUT" | python3 -c "
import sys, json
for line in sys.stdin:
    line = line.strip()
    if line.startswith('{'):
        try:
            data = json.loads(line)
            if 'data' in data and 'id' in data['data']:
                print(data['data']['id'])
                break
        except json.JSONDecodeError:
            pass
" 2>/dev/null || true)

  if [ -z "$LAST_ID" ]; then
    echo "ERROR: Could not extract tweet ID. Stopping thread."
    exit 1
  fi

  # Wait between tweets
  if [ $TWEET_NUM -lt $# ]; then
    echo "Waiting 3s..."
    sleep 3
  fi
done

echo ""
echo "Thread posted: $TWEET_NUM tweets"
