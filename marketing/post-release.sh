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

echo "=== Posting to X/Twitter ==="
bash "${SCRIPT_DIR}/post-twitter.sh" "$TWEET"

echo ""
echo "=== Posting to r/agentXchain_dev ==="
bash "${SCRIPT_DIR}/post-reddit.sh" "$REDDIT_TITLE" "$REDDIT_BODY"

echo ""
echo "=== Done ==="
