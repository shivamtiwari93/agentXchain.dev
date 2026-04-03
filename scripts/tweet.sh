#!/bin/bash
# Usage: bash scripts/tweet.sh "Your tweet text here"
# Usage (reply): bash scripts/tweet.sh "Reply text" --reply-to 1234567890
#
# Requires env vars in .env:
#   TWITTER_API_KEY, TWITTER_API_SECRET,
#   TWITTER_ACCESS_TOKEN, TWITTER_ACCESS_TOKEN_SECRET

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

# Load .env
if [ -f "$PROJECT_DIR/.env" ]; then
  set -a
  source "$PROJECT_DIR/.env"
  set +a
fi

# Validate
for var in TWITTER_API_KEY TWITTER_API_SECRET TWITTER_ACCESS_TOKEN TWITTER_ACCESS_TOKEN_SECRET; do
  if [ -z "${!var:-}" ]; then
    echo "ERROR: $var is not set. Add it to .env"
    echo "Get credentials at: https://developer.x.com"
    exit 1
  fi
done

TWEET_TEXT="${1:?Usage: bash scripts/tweet.sh \"Your tweet text\"}"
REPLY_TO_ID=""
if [ "${2:-}" = "--reply-to" ] && [ -n "${3:-}" ]; then
  REPLY_TO_ID="$3"
fi

if [ ${#TWEET_TEXT} -gt 280 ]; then
  echo "ERROR: Tweet is ${#TWEET_TEXT} chars (max 280)"
  exit 1
fi

# Use python3 for OAuth 1.0a signing + HTTP request (always available on macOS)
python3 - "$TWEET_TEXT" "$REPLY_TO_ID" << 'EOF'
import json, os, sys, time, hashlib, hmac, base64, urllib.parse, urllib.request, secrets

tweet_text = sys.argv[1]
reply_to = sys.argv[2] if len(sys.argv) > 2 and sys.argv[2] else None

api_key = os.environ["TWITTER_API_KEY"]
api_secret = os.environ["TWITTER_API_SECRET"]
access_token = os.environ["TWITTER_ACCESS_TOKEN"]
access_secret = os.environ["TWITTER_ACCESS_TOKEN_SECRET"]

url = "https://api.x.com/2/tweets"

# Build payload
payload = {"text": tweet_text}
if reply_to:
    payload["reply"] = {"in_reply_to_tweet_id": reply_to}

# OAuth 1.0a
oauth = {
    "oauth_consumer_key": api_key,
    "oauth_nonce": secrets.token_hex(16),
    "oauth_signature_method": "HMAC-SHA256",
    "oauth_timestamp": str(int(time.time())),
    "oauth_token": access_token,
    "oauth_version": "1.0",
}

param_str = "&".join(
    f"{urllib.parse.quote(k, safe='')}={urllib.parse.quote(v, safe='')}"
    for k, v in sorted(oauth.items())
)
base_str = f"POST&{urllib.parse.quote(url, safe='')}&{urllib.parse.quote(param_str, safe='')}"
sign_key = f"{urllib.parse.quote(api_secret, safe='')}&{urllib.parse.quote(access_secret, safe='')}"
signature = base64.b64encode(
    hmac.new(sign_key.encode(), base_str.encode(), hashlib.sha256).digest()
).decode()
oauth["oauth_signature"] = signature

auth = "OAuth " + ", ".join(
    f'{urllib.parse.quote(k, safe="")}="{urllib.parse.quote(v, safe="")}"'
    for k, v in sorted(oauth.items())
)

data = json.dumps(payload).encode()
req = urllib.request.Request(url, data=data, method="POST")
req.add_header("Authorization", auth)
req.add_header("Content-Type", "application/json")

try:
    with urllib.request.urlopen(req) as resp:
        result = json.loads(resp.read())
        tid = result["data"]["id"]
        print(f"Posted: https://x.com/agentxchain/status/{tid}")
        print(json.dumps(result, indent=2))
except urllib.error.HTTPError as e:
    print(f"ERROR {e.code}: {e.read().decode()}", file=sys.stderr)
    sys.exit(1)
EOF
