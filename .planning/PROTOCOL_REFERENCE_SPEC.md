# Protocol Reference Spec

> Last updated: 2026-04-04 (Turn 20, GPT 5.4)

---

## Purpose

Ship a current, versioned, public protocol reference that is distinct from both:

- the constitutional overview page at [`/docs/protocol`](/Users/shivamtiwari.highlevel/VS%20Code/1008apps/agentXchain.ai/agentXchain.dev/website-v2/docs/protocol.mdx)
- the executable adoption guide at [`/docs/protocol-implementor-guide`](/Users/shivamtiwari.highlevel/VS%20Code/1008apps/agentXchain.ai/agentXchain.dev/website-v2/docs/protocol-implementor-guide.mdx)

The repo already had protocol prose, but it did not clearly separate the normative v7 contract from reference-runner implementation details. This spec closes that gap.

## Interface

- Canonical repo-native versioned reference: [`PROTOCOL-v7.md`](/Users/shivamtiwari.highlevel/VS%20Code/1008apps/agentXchain.ai/agentXchain.dev/PROTOCOL-v7.md)
- Public latest reference page: [`/docs/protocol-reference`](/Users/shivamtiwari.highlevel/VS%20Code/1008apps/agentXchain.ai/agentXchain.dev/website-v2/docs/protocol-reference.mdx)
- Constitutional overview: `/docs/protocol`
- Executable adoption contract: `/docs/protocol-implementor-guide`

## Behavioral Contract

1. The reference must distinguish three version axes and must not collapse them:
   - protocol version: `v7`
   - artifact schema versions: governed config `1.0`, turn result `1.0`, governed state `1.1`, coordinator config/state/context `0.1`
   - conformance tiers: `1`, `2`, `3`
2. The reference must name the current normative repo-local contract from code:
   - governed run statuses from `cli/src/lib/schema.js`
   - write authorities from `cli/src/lib/normalized-config.js`
   - queued-versus-pending gate lifecycle from `cli/src/lib/governed-state.js`
   - `review_only` objection enforcement from `cli/src/lib/turn-result-validator.js`
3. The reference must name the current normative coordinator contract from code:
   - `super_run_id`
   - workstreams
   - barrier types from `cli/src/lib/coordinator-config.js`
   - `acceptance_projection`
   - `COORDINATOR_CONTEXT.json`
   - repo-local authority over coordinator projections
4. The reference must explicitly reject implementation leakage:
   - CLI command names are reference-runner operator ergonomics, not the protocol itself
   - dashboard ports/views are not part of protocol v7
   - provider-specific adapter behavior is not part of protocol v7
   - notification webhooks are an integration surface, not part of protocol v7 conformance
5. The reference must list the current conformance surfaces from `.agentxchain-conformance/fixtures/` and frame them as the current executable proof set, not as the totality of all product features.
6. The root `PROTOCOL-v7.md` document must use "reference runner" language when it mentions CLI commands so it does not accidentally claim the command names are the only valid implementation path.

## Error Cases

- Calling the overview page a standalone reference spec
- Treating conformance tiers as protocol versions
- Treating notifications or dashboard behavior as normative v7 protocol without conformance coverage
- Presenting command names as if they are the protocol rather than a runner surface
- Omitting real statuses, write authorities, or barrier types that the implementation actually validates

## Acceptance Tests

1. A code-backed guard verifies the public reference page exists and is wired into the docs sidebar.
2. The guard verifies the public page and `PROTOCOL-v7.md` distinguish protocol version, schema versions, and conformance tiers.
3. The guard reads `cli/src/lib/schema.js` and verifies every shipped governed run status is documented.
4. The guard reads `cli/src/lib/normalized-config.js` and verifies every shipped write authority is documented.
5. The guard reads `cli/src/lib/coordinator-config.js` and verifies every shipped barrier type is documented.
6. The guard reads `.agentxchain-conformance/fixtures/` and verifies every shipped conformance surface is documented.
7. The guard verifies the docs explicitly classify notifications, dashboard behavior, and provider-specific adapters as implementation-specific or outside protocol v7 conformance.
8. The guard verifies both READMEs surface the new `/docs/protocol-reference` page.

## Open Questions

1. When protocol v7 ships, do we keep `PROTOCOL-v7.md` frozen and add `PROTOCOL-v7.md`, or do we also introduce a machine-readable spec index? Deferred.
