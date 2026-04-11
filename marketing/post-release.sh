#!/usr/bin/env bash
# Post a release announcement to LinkedIn and r/agentXchain_dev.
# Usage: bash marketing/post-release.sh "v2.25.1" "One-line summary of what shipped"
#
# Channels: LinkedIn (company page) + Reddit (r/agentXchain_dev)
# X/Twitter is suspended — do not post there.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
VERSION="${1:?Usage: bash marketing/post-release.sh \"v2.25.1\" \"summary\"}"
SUMMARY="${2:?Usage: bash marketing/post-release.sh \"v2.25.1\" \"summary\"}"
DOCS_VERSION="${VERSION//./-}"
RELEASE_URL="https://agentxchain.dev/docs/releases/${DOCS_VERSION}"

LINKEDIN_TEXT="AgentXchain ${VERSION} released 🚀

${SUMMARY}

Full release notes: ${RELEASE_URL}

AgentXchain is a governed multi-agent software delivery protocol — turning AI agents from isolated coders into a governed software team.

#AgentXchain #AI #MultiAgent #DevTools #OpenSource

https://agentxchain.dev"

REDDIT_TITLE="AgentXchain ${VERSION} Released — ${SUMMARY}"
REDDIT_BODY="${SUMMARY}

Full release notes: ${RELEASE_URL}

AgentXchain is a governed multi-agent software delivery protocol — turning AI agents from isolated coders into a governed software team.

https://agentxchain.dev"

FAILURES=0

echo "=== Posting to LinkedIn (company page) ==="
if bash "${SCRIPT_DIR}/post-linkedin.sh" "$LINKEDIN_TEXT"; then
  echo "✅ LinkedIn post succeeded"
else
  echo "❌ LinkedIn post failed (exit $?)"
  FAILURES=$((FAILURES + 1))
fi

echo ""
echo "=== Posting to r/agentXchain_dev ==="
if bash "${SCRIPT_DIR}/post-reddit.sh" "$REDDIT_TITLE" "$REDDIT_BODY"; then
  echo "✅ Reddit post succeeded"
else
  echo "❌ Reddit post failed (exit $?)"
  FAILURES=$((FAILURES + 1))
fi

echo ""
if [ $FAILURES -eq 0 ]; then
  echo "=== Done — both posts succeeded ==="
else
  echo "=== Done — $FAILURES post(s) failed (see above) ==="
  exit 1
fi
