# API Proxy Guide Bootstrap Spec

## Purpose

Freeze the first-run onboarding contract for integration guides that use the `api_proxy` adapter. These guides must show how an operator gets from a fresh repo to a governed run with the provider-specific runtime actually wired in.

## Interface

- Guide set:
  - `website-v2/docs/integrations/anthropic.mdx`
  - `website-v2/docs/integrations/openai.mdx`
  - `website-v2/docs/integrations/google.mdx`
  - `website-v2/docs/integrations/google-jules.mdx`
  - `website-v2/docs/integrations/deepseek.mdx`
  - `website-v2/docs/integrations/mistral.mdx`
  - `website-v2/docs/integrations/xai.mdx`
  - `website-v2/docs/integrations/amazon.mdx`
  - `website-v2/docs/integrations/qwen.mdx`
  - `website-v2/docs/integrations/groq.mdx`
  - `website-v2/docs/integrations/cohere.mdx`
  - `website-v2/docs/integrations/ollama.mdx`
  - `website-v2/docs/integrations/mlx.mdx`
- Guard test: `cli/test/api-proxy-guide-bootstrap.test.js`

## Behavior

- Every `api_proxy` guide must include a concrete bootstrap example using:
  - `agentxchain init --governed ... --dir <dir> -y`
  - `cd <dir>`
  - `agentxchain connector check`
  - `agentxchain doctor`
  - `agentxchain run`
- Every guide must mention the guided interactive path:
  - `agentxchain init --governed`
- Every guide must tell the operator to merge or replace the scaffolded runtime wiring in `agentxchain.json` with the provider-specific config shown in that guide before checking the connector.
- Guides must not teach the `mkdir my-project && cd my-project` bootstrap anti-pattern.
- Provider-specific prerequisites remain provider-specific; this spec only standardizes the governed bootstrap path.

## Error Cases

- A guide shows provider config but never explains how that config becomes the active governed runtime.
- A guide tells the operator to run without `agentxchain doctor`.
- A guide shows a bootstrap path that still depends on `mkdir my-project`.
- A guide implies the non-interactive path is the only supported first-run flow and omits guided `init --governed`.

## Acceptance Tests

- `AT-APG-*-001`: each target guide exists.
- `AT-APG-*-002`: each target guide avoids `mkdir my-project`.
- `AT-APG-*-003`: each target guide includes `agentxchain init --governed` with `--dir my-project -y`.
- `AT-APG-*-004`: each target guide includes `agentxchain connector check`.
- `AT-APG-*-005`: each target guide includes `agentxchain doctor`.
- `AT-APG-*-006`: each target guide includes `agentxchain run`.
- `AT-APG-*-007`: each target guide mentions the guided interactive path (`agentxchain init --governed` without `-y`).
- `AT-APG-*-008`: each target guide tells the operator to update `agentxchain.json` with the config shown in that guide before probing or running.

## Open Questions

- Some providers have authentication or proxy-specific caveats beyond this bootstrap path, especially Bedrock. Those accuracy gaps should be tightened separately instead of weakening the governed bootstrap contract.
