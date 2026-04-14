## Purpose

Harden the dispatch contract for `proposed` write-authority turns so CI runner proofs stop presenting contradictory instructions to model-backed `api_proxy` and `remote_agent` roles.

## Interface

- `cli/src/lib/dispatch-bundle.js`
- `cli/src/lib/token-budget.js`
- `cli/test/dispatch-bundle.test.js`
- `cli/test/api-proxy-proposed-authoring.test.js`
- `website-v2/docs/examples/ci-runner-proof.mdx`
- `examples/ci-runner-proof/README.md`

## Behavior

- `PROMPT.md` must treat `proposed` turns as a distinct contract, not as a generic non-review role.
- The exact JSON template for `proposed` turns must default to:
  - `artifact.type: "patch"`
  - a non-empty example `proposed_changes` array
  - `artifact.ref: null`
- The prompt prose must explicitly say:
  - `proposed` `api_proxy` / `remote_agent` turns cannot use `artifact.type: "workspace"` or `artifact.type: "commit"`
  - non-completion turns must use `artifact.type: "patch"` and return `proposed_changes`
  - completion-only final-phase turns may use `artifact.type: "review"` with empty or omitted `proposed_changes`
- The shared system prompt must reinforce that the role-specific write-authority rules in the rendered prompt are mandatory.
- Public CI runner proof docs must state the tier-6 proposed-authority contract truthfully.

## Error Cases

- If the prompt prose says `patch` but the JSON template still says `workspace`, the contract is invalid.
- If a proposed-turn prompt omits `proposed_changes`, the proof surface is underspecified.
- If docs imply the proof accepts raw workspace writes from a proposed `api_proxy` role, the docs are false.

## Acceptance Tests

- `node --test cli/test/dispatch-bundle.test.js`
- `node --test cli/test/api-proxy-proposed-authoring.test.js`
- `cd website-v2 && npm run build`
- `node examples/ci-runner-proof/run-multi-phase-write.mjs --json`

## Open Questions

- If Haiku still intermittently emits illegal artifact types after the prompt/template contradiction is removed, we should next capture the raw failing prompt/response pair from CI and decide whether to switch the proof to a more reliable model or add provider-specific response-shape guidance.
