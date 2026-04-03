# Continuous Delivery Intake Doc Page Spec

> Last updated: 2026-04-03 (Turn 2, GPT 5.4)

---

## Purpose

Publish a truthful operator and implementor guide for the repo-native intake surface at `/docs/continuous-delivery-intake`. This page explains how continuous governed delivery enters the system today: signals become repo-local intake events, events become delivery intents, and operators triage those intents without bypassing constitutional gates.

## Interface

- **Doc source**: `website-v2/docs/continuous-delivery-intake.mdx`
- **Public URL**: `/docs/continuous-delivery-intake`
- **Navigation**: lives under a `Continuous Delivery` docs section
- **Primary audience**: operators evaluating the v3 intake surface and contributors comparing docs against `cli/src/lib/intake.js`

## Behavior

The page must document the shipped intake contract, not the aspirational v3 backlog:

1. Explain intake as the continuous governed delivery entrypoint for repo-native signals.
2. Document the three implemented commands:
   - `agentxchain intake record`
   - `agentxchain intake triage`
   - `agentxchain intake status`
3. Document the actual artifact layout:
   - `.agentxchain/intake/events/<event_id>.json`
   - `.agentxchain/intake/intents/<intent_id>.json`
   - `.agentxchain/intake/loop-state.json`
4. Document the event and intent schemas with the real implemented fields.
5. Document the deduplication contract:
   - dedup key derived from `source` plus sorted `signal`
   - duplicate events are idempotent and return the existing event and intent
6. Distinguish current shipped states from broader v3 direction:
   - implemented now: `detected`, `triaged`, `suppressed`, `rejected`
   - defined in broader v3 scope but not yet exposed by the CLI: `approved`, `planned`
7. Explicitly state the governance boundary:
   - intake does not auto-start code-writing execution
   - `intake scan` and `intake start` are not shipped yet

## Error Cases

- The page must not claim `approved` or `planned` transitions are implemented in the current CLI surface.
- The page must not document `intake scan` or `intake start` as available commands.
- The page must not describe deduplication as a best-effort heuristic; it is deterministic and idempotent.

## Acceptance Tests

- [ ] AT-1: `website-v2/docs/continuous-delivery-intake.mdx` exists
- [ ] AT-2: `website-v2/sidebars.ts` includes a `Continuous Delivery` section with the intake page
- [ ] AT-3: The page documents `intake record`, `intake triage`, `intake status`, and `.agentxchain/intake/`
- [ ] AT-4: The page documents the dedup key contract and idempotent duplicate behavior
- [ ] AT-5: The page distinguishes shipped states from deferred `approved` / `planned` transitions
- [ ] AT-6: `.planning/DOCS_SURFACE_SPEC.md` lists `/docs/continuous-delivery-intake`

## Open Questions

- Q1: When `approved` and `planned` transitions ship, do they belong under `intake triage` flags or a separate `intake approve` / `intake plan` command family?
