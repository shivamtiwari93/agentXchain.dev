# Protocol Doc Page Spec

> Last updated: 2026-04-07 (Turn 103, Claude Opus 4.6)

---

## Purpose

Keep [`website-v2/docs/protocol.mdx`](/Users/shivamtiwari.highlevel/VS%20Code/1008apps/agentXchain.ai/agentXchain.dev/website-v2/docs/protocol.mdx) truthful against the shipped governed runtime and coordinator implementation. This page is the public constitutional overview. It must explain the operator-facing contract without inventing behaviors, flattening important schema differences, or hand-waving the repo-local gate lifecycle.

## Interface

- Latest docs route: `/docs/protocol`
- Versioned protocol permalink: `/docs/protocol-v7`
- Normative repo-native source: `PROTOCOL-v7.md`
- Deep-dive dependency: `/docs/multi-repo`

## Behavioral Contract

1. The protocol page remains high-level and constitutional. Detailed coordinator operator mechanics stay on `/docs/multi-repo`.
2. Default repo-local phases are `planning`, `implementation`, and `qa`. The page may mention custom phases, but it must not present `verification` as the shipped default phase name.
3. The challenge requirement is precise:
   - mandatory challenge is a protocol principle
   - non-empty `objections` are enforced for `review_only` roles
   - the page must not imply that every role is required to emit objections on every turn
4. Artifact schema versions are mixed and must stay explicit:
   - governed config: `schema_version: "1.0"`
   - governed state: `schema_version: "1.1"`
   - coordinator config/state: `schema_version: "0.1"`
   - turn results: `schema_version: "1.0"`
   The page must not claim `1.0` for all artifacts.
5. Repo-local gate lifecycle must reflect the real queued-versus-pending behavior:
   - accepted turns may set `queued_phase_transition` or `queued_run_completion`
   - when the active turn set drains, those requests either auto-advance/complete or become `pending_phase_transition` / `pending_run_completion`
   - `approve-transition` and `approve-completion` resolve pending gates after explicit human approval
6. Migration docs must match `cli/src/commands/migrate.js`:
   - v3 config is rewritten into governed config schema `1.0`
   - governed state is created as schema `1.1`
   - migrated state starts `paused` for `human:migration-review`
   - legacy artifacts are archived, not backfilled into governed history
   - migration does not create coordinator state by itself
7. The decision ledger description must stay truthful:
   - accepted decisions are appended to `.agentxchain/decision-ledger.jsonl`
   - selected conflict/governance events are also recorded
   - normal turn rejection is not described as a generic ledger append path
8. Current public surfaces that route people to `/docs/protocol` must use the current protocol title (`Protocol v7`) rather than stale version labels:
   - `website-v2/docusaurus.config.ts` footer navigation
   - `website-v2/docs/first-turn.mdx`
   - `website-v2/docs/quickstart.mdx`
   - `website-v2/docs/runner-interface.mdx`

## Error Cases

- Claiming a single schema version across all governed artifacts
- Presenting `verification` as the default scaffold phase instead of `qa`
- Describing objections as mandatory for every role rather than `review_only`
- Omitting queued gate requests and only documenting pending approval state
- Claiming migration upgrades all artifacts to `1.0`
- Claiming the ledger generically records rejections
- Showing `accept-turn` as the next command after `step` in the normal flow (step auto-accepts)
- Claiming the implementation exit gate requires `approve-transition` (it only requires verification pass)

## Acceptance Tests

1. [`cli/test/protocol-docs-content.test.js`](/Users/shivamtiwari.highlevel/VS%20Code/1008apps/agentXchain.ai/agentXchain.dev/cli/test/protocol-docs-content.test.js) verifies the protocol page still presents v7 as current.
2. The guard verifies `/docs/protocol` still links the coordinator overview to `/docs/multi-repo`.
3. The guard verifies the page documents `qa` as the default final phase and does not present `verification` as the default phase name.
4. The guard verifies the page documents `review_only` objection enforcement without claiming objections are mandatory for every role.
5. The guard verifies the page documents mixed schema versions and rejects the phrase "schema version `1.0` for all artifacts".
6. The guard verifies the page documents queued and pending repo-local gate lifecycle fields.
7. The guard verifies the migration section matches the shipped v3 → governed migration behavior.
8. The guard verifies the decision-ledger description does not claim generic rejection logging.
9. The guard verifies the command sequence documents `step` auto-acceptance and does not insert `accept-turn` into the normal governed flow.
10. The guard verifies the implementation exit gate is documented as `implementation_complete` (verification-only), not `approve-transition`.
11. The guard verifies current public protocol links in the footer and adjacent docs pages use `Protocol v7` and reject stale `Protocol v6` labels.

## Open Questions

1. When protocol v7 ships, should `/docs/protocol` keep a compact constitutional overview while `/docs/protocol-v7` carries the detailed version delta, or should the latest page expand again? Deferred.
