# LinkedIn Company Post Hardening Spec

## Purpose

Repair the broken LinkedIn company-page posting path used by `marketing/post-linkedin.sh` so release and product announcements can be published reliably again.

The reported failure for `v2.86.0` was a selector timeout waiting for the final submit control inside LinkedIn's company-post composer. During investigation, a second flake surface was also found: `li-browser` reuses any saved Chrome DevTools port without tracking whether that session belongs to the isolated tool profile or the live system profile.

This slice hardens both failure points.

## Interface

- User-facing command remains unchanged:
  - `bash marketing/post-linkedin.sh "post text"`
- `li-browser post create "text" --company-id 112883208` remains the underlying execution path.
- No new operator flags are required.

## Behavior

- `li-browser` must prefer a company-post submit button inside the active composer modal instead of relying on one brittle selector string.
- Submit-button detection must tolerate LinkedIn markup drift across:
  - class changes
  - aria-label changes
  - text variations such as `Post`, `Publish`, or `Share`
  - delayed enablement after editor input
- If a text/aria match is unavailable, `li-browser` may fall back to the visible enabled primary button inside the composer dialog.
- After clicking the submit control, `li-browser` should verify that the composer dialog closed; otherwise it should fail explicitly instead of returning a false success.
- Browser-session reuse must only attach to an existing DevTools session when the saved session matches the requested profile kind:
  - `isolated`
  - `system`
- Existing legacy `chrome.port` files containing only an integer port must continue to work and default to `isolated`.

## Error Cases

- No active LinkedIn login in the selected profile: fail with the existing login/authwall behavior.
- Composer opens but no enabled submit control is found within the timeout: fail with a specific submit-button error.
- Submit control is clicked but the composer remains open: fail with a post-not-submitted error.
- Saved DevTools port belongs to a different profile kind: ignore it and launch a new matching-profile Chrome session instead of connecting to the wrong browser.

## Acceptance Tests

- `AT-LI-POST-001`: selector helper finds a standard `Post` button inside a composer dialog.
- `AT-LI-POST-002`: selector helper finds a company-post CTA when the visible label is `Publish`.
- `AT-LI-POST-003`: selector helper ignores disabled submit buttons.
- `AT-LI-POST-004`: selector helper falls back to the visible enabled primary button inside the dialog when text labels drift.
- `AT-LI-BROWSER-001`: session metadata round-trips profile kind and port.
- `AT-LI-BROWSER-002`: legacy integer `chrome.port` files remain readable and default to `isolated`.
- Proof run: reattempt the missed `v2.86.0` LinkedIn announcement through `bash marketing/post-linkedin.sh ...`; success is the preferred outcome, but if LinkedIn still blocks the flow the exact runtime blocker must be logged in `AGENT-TALK.md`.

## Open Questions

- Whether LinkedIn now renders a different final CTA label in the live company composer should be treated as an empirical surface and checked during the proof run, not guessed in docs.
