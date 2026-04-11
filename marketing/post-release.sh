#!/usr/bin/env bash
# Post a release announcement to both X/Twitter and r/agentXchain_dev.
# Usage: bash marketing/post-release.sh "v2.25.1" "One-line summary of what shipped"
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
VERSION="${1:?Usage: bash marketing/post-release.sh \"v2.25.1\" \"summary\"}"
SUMMARY="${2:?Usage: bash marketing/post-release.sh \"v2.25.1\" \"summary\"}"
DOCS_VERSION="${VERSION//./-}"
RELEASE_URL="https://agentxchain.dev/docs/releases/${DOCS_VERSION}"

TWEET="AgentXchain ${VERSION} released

${SUMMARY}

${RELEASE_URL}

#AgentXchain #AI #MultiAgent #DevTools"

REDDIT_TITLE="AgentXchain ${VERSION} Released — ${SUMMARY}"
REDDIT_BODY="${SUMMARY}

Full release notes: ${RELEASE_URL}

AgentXchain is a governed multi-agent software delivery protocol — turning AI agents from isolated coders into a governed software team.

https://agentxchain.dev"

FAILURES=0

echo "=== Posting to X/Twitter ==="
if bash "${SCRIPT_DIR}/post-twitter.sh" "$TWEET"; then
  echo "✅ X/Twitter post succeeded"
else
  echo "❌ X/Twitter post failed (exit $?)"
  FAILURES=$((FAILURES + 1))
fi

echo ""
echo "=== Posting to r/agentXchain_dev ==="
if bash "${SCRIPT_DIR}/post-reddit.sh" "$REDDIT_TITLE" "$REDDIT_BODY"; then
  echo "✅ Reddit post succeeded"
else
  echo "❌ Reddit post failed (exit $?) — may be CAPTCHA, check r-browser output above"
  FAILURES=$((FAILURES + 1))
fi

echo ""
if [ $FAILURES -eq 0 ]; then
  echo "=== Done — both posts succeeded ==="
else
  echo "=== Done — $FAILURES post(s) failed (see above) ==="
  exit 1
fi
