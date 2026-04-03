# Continuous Delivery Intake Doc Page Spec

> Last updated: 2026-04-03 (Turn 8, GPT 5.4)

---

## Purpose

Publish a truthful operator and implementor guide for the repo-native intake surface at `/docs/continuous-delivery-intake`. This page explains how continuous governed delivery enters the system today: signals can be recorded or scanned into repo-local intake events, events become delivery intents, operators triage and approve those intents, template-backed planning artifacts prepare work, and `intake start` hands one planned intent into the governed run engine without bypassing constitutional gates.

## Interface

- **Doc source**: `website-v2/docs/continuous-delivery-intake.mdx`
- **Public URL**: `/docs/continuous-delivery-intake`
- **Navigation**: lives under a `Continuous Delivery` docs section
- **Primary audience**: operators evaluating the v3 intake surface and contributors comparing docs against `cli/src/lib/intake.js`

## Behavior

The page must document the shipped intake contract, not the aspirational v3 backlog:

1. Explain intake as the continuous governed delivery entrypoint for repo-native signals.
2. Document the seven implemented commands:
   - `agentxchain intake record`
   - `agentxchain intake triage`
   - `agentxchain intake approve`
   - `agentxchain intake plan`
   - `agentxchain intake start`
   - `agentxchain intake scan`
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
   - implemented now: `detected`, `triaged`, `approved`, `planned`, `executing`, `suppressed`, `rejected`
   - broader v3 direction still deferred: `awaiting_release_approval`, `released`, `observing`, `reopened`
7. Document the planning-artifact contract:
   - `intake approve` is the authorization gate
   - `intake plan` loads the governed template manifest for `intent.template`
   - planning fails atomically on artifact conflicts unless `--force` is supplied
   - `generic` is valid even when it yields zero planning artifacts
8. Document the start bridge contract:
   - `intake start` transitions `planned -> executing`
   - success records `target_run`, `target_turn`, and `started_at`
   - start rejects when planning artifacts are missing, another turn is active, the run is blocked, the run is completed, or the run is paused on a pending approval
   - the current governed schema treats `paused` as approval-held, not as a generic intake-resumable idle state
9. Document the deterministic scan contract:
   - `intake scan` accepts only `ci_failure`, `git_ref_change`, and `schedule`
   - `manual` remains exclusive to `intake record`
   - snapshot `items` must be non-empty and each item is processed independently through `recordEvent()`
   - result semantics are `created`, `deduplicated`, or `rejected`
   - `captured_at` is informational metadata in S4, not a validated or persisted field
10. Explicitly state the governance boundary:
   - intake does not auto-start code-writing execution from raw signals
   - `planned` is not the same thing as `executing`
   - `intake scan` widens ingestion only; it does not triage, approve, plan, or start execution

## Error Cases

- The page must not describe deduplication as a best-effort heuristic; it is deterministic and idempotent.
- The page must not imply that `intake plan` creates or resumes a governed run.
- The page must not claim that `intake start` reopens completed runs or resumes arbitrary paused runs.
- The page must not describe `intake scan` as a generic batch wrapper for `manual`; `manual` stays on `intake record`.

## Acceptance Tests

- [ ] AT-1: `website-v2/docs/continuous-delivery-intake.mdx` exists
- [ ] AT-2: `website-v2/sidebars.ts` includes a `Continuous Delivery` section with the intake page
- [ ] AT-3: The page documents `intake record`, `intake triage`, `intake approve`, `intake plan`, `intake start`, `intake scan`, `intake status`, and `.agentxchain/intake/`
- [ ] AT-4: The page documents the dedup key contract and idempotent duplicate behavior
- [ ] AT-5: The page distinguishes shipped `planned -> executing` from deferred later-v3 release/observation states
- [ ] AT-6: `.planning/DOCS_SURFACE_SPEC.md` lists `/docs/continuous-delivery-intake`
- [ ] AT-7: The page documents `approved_by`, `planning_artifacts`, `target_run`, and the artifact-conflict rule
- [ ] AT-8: The page documents the `intake scan` snapshot contract, manual-source exclusion, and `created` / `deduplicated` / `rejected` result semantics

## Open Questions

None. `intake scan` is now part of the shipped intake surface.
