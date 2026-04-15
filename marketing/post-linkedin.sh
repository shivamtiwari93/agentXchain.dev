#!/usr/bin/env bash
# Post to AgentXchain LinkedIn company page via li-browser (browser automation, no API keys needed).
# Usage: bash marketing/post-linkedin.sh "post text"
set -euo pipefail

LIBROWSER_DIR="/Users/shivamtiwari.highlevel/VS Code/1008apps/li-browser"
LIBROWSER_BIN="${LIBROWSER_DIR}/.venv/bin/li-browser"
LIBROWSER_PYTHON="${LIBROWSER_DIR}/.venv/bin/python"
COMPANY_ID="112883208"
TEXT="${1:?Usage: bash marketing/post-linkedin.sh \"post text\"}"
USE_SYSTEM_PROFILE="${AGENTXCHAIN_LINKEDIN_USE_SYSTEM_PROFILE:-0}"
DISABLE_PROFILE_FALLBACK="${AGENTXCHAIN_LINKEDIN_DISABLE_PROFILE_FALLBACK:-0}"

if [ ! -x "${LIBROWSER_BIN}" ]; then
  echo "li-browser binary not found at ${LIBROWSER_BIN}" >&2
  exit 1
fi

if [ ! -x "${LIBROWSER_PYTHON}" ]; then
  echo "li-browser python not found at ${LIBROWSER_PYTHON}" >&2
  exit 1
fi

# Preflight: warn if another browser-automation Chrome is already running on a conflicting profile.
# On macOS, Chrome refuses to start a second instance against the same or overlapping user-data-dir.
preflight_chrome_contention() {
  if pgrep -f "user-data-dir=.*li-browser/chrome-data" >/dev/null 2>&1; then
    return 0  # li-browser's own Chrome is already up — tool should reuse it
  fi
  if pgrep -f "user-data-dir=.*(x-browser|r-browser)/chrome-data" >/dev/null 2>&1; then
    echo "⚠️  Another browser-automation Chrome instance is running (x-browser or r-browser)." >&2
    echo "   li-browser may fail to open DevTools. Kill the other instance first." >&2
  fi
}

profile_label() {
  if [ "${1}" = "1" ]; then
    printf 'system-profile'
  else
    printf 'isolated-profile'
  fi
}

post_snippet() {
  printf '%s\n' "${TEXT}" \
    | awk 'NF { print; exit }' \
    | tr '\r\n' '  ' \
    | sed -E 's/[[:space:]]+/ /g' \
    | cut -c1-120
}

run_li_browser_post() {
  local use_system_profile="$1"
  local args=(--min-delay 2 --max-delay 5)

  if [ "${use_system_profile}" = "1" ]; then
    args=(--system-profile "${args[@]}")
  fi

  preflight_chrome_contention
  "${LIBROWSER_BIN}" "${args[@]}" post create "$TEXT" --company-id "$COMPANY_ID"
}

verify_linkedin_post_visible() {
  local use_system_profile="$1"
  local snippet="$2"

  "${LIBROWSER_PYTHON}" - "$use_system_profile" "$COMPANY_ID" "$snippet" <<'PY'
import asyncio
import sys

from li_browser.browser import LiBrowser, ensure_logged_in


async def main() -> int:
    use_system = sys.argv[1] == "1"
    company_id = sys.argv[2]
    snippet = sys.argv[3].strip().lower()

    if not snippet:
        print("linkedin-verify:empty-snippet", file=sys.stderr)
        return 1

    async with LiBrowser(headless=True, use_system_profile=use_system) as browser:
        page = browser.page
        logged_in = await asyncio.wait_for(ensure_logged_in(page), timeout=20)
        if not logged_in:
            print("linkedin-verify:not-logged-in", file=sys.stderr)
            return 1

        await asyncio.wait_for(
            page.goto(
                f"https://www.linkedin.com/company/{company_id}/admin/page-posts/published/",
                wait_until="domcontentloaded",
            ),
            timeout=20,
        )
        await page.wait_for_timeout(5000)
        body_text = await page.evaluate("() => document.body.innerText || ''")
        if snippet in body_text.lower():
            print("linkedin-verify:found", file=sys.stderr)
            return 0

        print("linkedin-verify:not-found", file=sys.stderr)
        return 1


raise SystemExit(asyncio.run(main()))
PY
}

is_ambiguous_submit_failure() {
  printf '%s' "$1" | grep -Fq 'composer remained open after clicking the submit control'
}

attempt_linkedin_post() {
  local use_system_profile="$1"
  local mode
  mode="$(profile_label "${use_system_profile}")"

  echo "Attempting LinkedIn post with ${mode}..." >&2

  local output status
  output="$({ run_li_browser_post "${use_system_profile}"; } 2>&1)" && status=0 || status=$?
  if [ "${status}" -eq 0 ]; then
    if [ -n "${output}" ]; then
      printf '%s\n' "${output}"
    fi
    return 0
  fi

  LAST_LINKEDIN_STATUS="${status}"
  LAST_LINKEDIN_OUTPUT="${output}"
  LAST_LINKEDIN_MODE="${use_system_profile}"
  if [ -n "${output}" ]; then
    printf '%s\n' "${output}" >&2
  fi
  return "${LAST_LINKEDIN_STATUS}"
}

PRIMARY_MODE="${USE_SYSTEM_PROFILE}"
SECONDARY_MODE="1"
if [ "${PRIMARY_MODE}" = "1" ]; then
  SECONDARY_MODE="0"
fi

if attempt_linkedin_post "${PRIMARY_MODE}"; then
  exit 0
fi

if is_ambiguous_submit_failure "${LAST_LINKEDIN_OUTPUT}"; then
  SNIPPET="$(post_snippet)"
  echo "LinkedIn submit outcome is ambiguous; verifying company feed before any retry..." >&2
  if verify_linkedin_post_visible "${LAST_LINKEDIN_MODE}" "${SNIPPET}"; then
    echo "LinkedIn post verified on the company admin feed; treating the attempt as success." >&2
    exit 0
  fi
  echo "LinkedIn post could not be verified after an ambiguous submit; suppressing automatic retry to avoid duplicate posts." >&2
  exit "${LAST_LINKEDIN_STATUS}"
fi

if [ "${DISABLE_PROFILE_FALLBACK}" = "1" ]; then
  echo "LinkedIn profile fallback disabled; not retrying with $(profile_label "${SECONDARY_MODE}")." >&2
  exit "${LAST_LINKEDIN_STATUS}"
fi

echo "LinkedIn post failed with $(profile_label "${PRIMARY_MODE}"); retrying once with $(profile_label "${SECONDARY_MODE}") in 5s..." >&2
sleep 5

if attempt_linkedin_post "${SECONDARY_MODE}"; then
  exit 0
fi

if is_ambiguous_submit_failure "${LAST_LINKEDIN_OUTPUT}"; then
  SNIPPET="$(post_snippet)"
  echo "LinkedIn fallback attempt reached an ambiguous submit; verifying company feed before giving up..." >&2
  if verify_linkedin_post_visible "${LAST_LINKEDIN_MODE}" "${SNIPPET}"; then
    echo "LinkedIn post verified on the company admin feed after fallback; treating the attempt as success." >&2
    exit 0
  fi
  echo "LinkedIn fallback attempt could not be verified and will not be retried automatically." >&2
fi

exit "${LAST_LINKEDIN_STATUS}"
