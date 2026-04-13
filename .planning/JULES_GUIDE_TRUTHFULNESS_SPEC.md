# Jules Guide Truthfulness Spec

## Purpose

Freeze the public contract for `website-v2/docs/integrations/google-jules.mdx` so the docs stop implying that AgentXchain already integrates with the Jules product directly when the repo only ships the Google Gemini `api_proxy` provider.

## Interface

- Primary doc: `website-v2/docs/integrations/google-jules.mdx`
- Index surface: `website-v2/docs/integrations/index.mdx`
- Guard test: `cli/test/integration-guide-factual-accuracy.test.js`

## Behavior

- The Google Jules guide must remain discoverable for operators who arrive looking for Jules.
- The guide must explicitly state that AgentXchain does **not** currently ship a native Jules adapter or direct Jules API/CLI integration.
- The guide must explain that the supported path today is the Google Gemini `api_proxy` provider, which reaches `generativelanguage.googleapis.com` and uses `GOOGLE_API_KEY`.
- The guide must explain that Jules itself now has its own product surfaces:
  - hosted web app
  - Jules Tools CLI
  - Jules REST API
- The guide must explain that the Jules REST API uses `jules.googleapis.com/v1alpha` plus `x-goog-api-key` / `JULES_API_KEY`, which is a different contract from the shipped Gemini adapter.
- The integrations index must not label Google Jules as if it were already a direct `api_proxy` integration. It must include a clarifier that the current path is Gemini-compatible rather than native Jules.

## Error Cases

- The guide says "connect Jules via `api_proxy`" without clarifying that the runtime is actually Gemini, not Jules.
- The guide tells operators to use `GOOGLE_API_KEY` while implying that this is the Jules API key.
- The guide omits the existence of the Jules API/CLI and therefore hides the real product boundary.
- The integrations index advertises Jules as a solved direct integration when the repo has no such connector.

## Acceptance Tests

- `AT-JULES-TRUTH-001`: the guide states that direct Jules integration is not yet shipped.
- `AT-JULES-TRUTH-002`: the guide names Gemini / Google Generative AI as the supported current path.
- `AT-JULES-TRUTH-003`: the guide mentions Jules REST API or Jules Tools CLI as separate official surfaces.
- `AT-JULES-TRUTH-004`: the guide distinguishes `GOOGLE_API_KEY` from `JULES_API_KEY` / Jules API auth.
- `AT-JULES-TRUTH-005`: the guide does not claim that AgentXchain sends requests to Jules through `provider: "google"`.
- `AT-JULES-TRUTH-006`: the integrations index labels the Jules entry with a clarifier such as "Gemini path today" instead of a bare direct-adapter claim.

## Open Questions

- A native Jules connector may fit better as a `remote_agent` or dedicated adapter than as `api_proxy`, because the Jules API is session/activity oriented rather than one-shot text completion. That product slice should be specified separately instead of being smuggled into the current guide.
