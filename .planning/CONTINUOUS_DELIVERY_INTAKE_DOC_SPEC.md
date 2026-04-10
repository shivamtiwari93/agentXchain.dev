# Continuous Delivery Intake Doc Page Spec

> Last updated: 2026-04-06 (Turn 22, GPT 5.4)

---

## Purpose

Publish a truthful operator and implementor guide for the repo-native intake surface at `/docs/continuous-delivery-intake`. This page explains how continuous governed delivery enters the system today: signals can be recorded or scanned into repo-local intake events, events become delivery intents, operators triage and approve those intents, template-backed planning artifacts prepare work, `intake start` hands one planned intent into the governed run engine, `intake handoff` links planned work to a coordinator workstream without bypassing constitutional gates, and `intake resolve` maps governed or coordinator outcomes back into repo-native intake state. The page must also make the current workspace boundary explicit: intake is repo-local and does not run from coordinator workspace roots.

## Interface

- **Doc source**: `website-v2/docs/continuous-delivery-intake.mdx`
- **Public URL**: `/docs/continuous-delivery-intake`
- **Navigation**: lives under a `Continuous Delivery` docs section
- **Primary audience**: operators evaluating the v3 intake surface and contributors comparing docs against `cli/src/lib/intake.js`

## Behavior

The page must document the shipped intake contract, not the aspirational v3 backlog:

1. Explain intake as the continuous governed delivery entrypoint for repo-native signals.
2. Document the nine implemented commands:
   - `agentxchain intake record`
   - `agentxchain intake triage`
   - `agentxchain intake approve`
   - `agentxchain intake plan`
   - `agentxchain intake start`
   - `agentxchain intake handoff`
   - `agentxchain intake resolve`
   - `agentxchain intake scan`
   - `agentxchain intake status`
3. Document the actual artifact layout:
   - `.agentxchain/intake/events/<event_id>.json`
   - `.agentxchain/intake/intents/<intent_id>.json`
   - `.agentxchain/intake/observations/<intent_id>/`
   - `.agentxchain/intake/loop-state.json`
4. Document the event and intent schemas with the real implemented fields.
5. Document the deduplication contract:
   - dedup key derived from `source` plus sorted `signal`
   - duplicate events are idempotent and return the existing event and intent
6. Distinguish current shipped states from broader v3 direction:
   - implemented now: `detected`, `triaged`, `approved`, `planned`, `executing`, `blocked`, `completed`, `failed` (reserved), `suppressed`, `rejected`
   - shipped transitions include `executing -> blocked|completed` and `blocked -> approved`. Run-level `failed` is reserved per `DEC-RUN-STATUS-001` — intake resolve fails closed on it.
   - broader v3 direction still deferred: `awaiting_release_approval`, `released`, `observing`, `reopened`
7. Document the planning-artifact contract:
   - `intake approve` is the authorization gate
   - `intake plan` loads the governed template manifest for `intent.template`
   - planning fails atomically on artifact conflicts unless `--force` is supplied
   - `generic` is valid even when it yields zero planning artifacts
   - `library` is a valid governed template and must be documented anywhere the page enumerates built-in template options
8. Document the start bridge contract:
   - `intake start` transitions `planned -> executing`
   - success records `target_run`, `target_turn`, and `started_at`
   - start rejects when planning artifacts are missing, another turn is active, the run is blocked, the run is completed, or the run is paused on a pending approval
   - idle runs can be initialized from `intake start`
   - paused runs with no active turns can be resumed by `intake start`
   - pending `pending_phase_transition` and `pending_run_completion` still block `intake start`
9. Document the coordinator handoff contract:
   - `intake handoff` transitions `planned -> executing`
   - success records `target_workstream.coordinator_root`, `target_workstream.workstream_id`, and `target_workstream.super_run_id`
   - the coordinator handoff ref lives under `.agentxchain/multirepo/handoffs/<intent_id>.json`
   - the handoff ref is run-bound by `super_run_id` to prevent stale coordinator context bleed-through
   - coordinator-backed resolution preserves `blocked` when the coordinator blocks
   - coordinator completion without satisfying the workstream barrier also maps to `blocked` with recovery guidance
   - reserved coordinator/run-level `failed` fails closed per `DEC-RUN-STATUS-001`
10. Document the deterministic scan contract:
   - `intake scan` accepts only `ci_failure`, `git_ref_change`, and `schedule`
   - `manual` remains exclusive to `intake record`
   - snapshot `items` must be non-empty and each item is processed independently through `recordEvent()`
   - result semantics are `created`, `deduplicated`, or `rejected`
   - `captured_at` is informational metadata in S4, not a validated or persisted field
11. Explicitly state the governance boundary:
   - intake does not auto-start code-writing execution from raw signals
   - `planned` is not the same thing as `executing`
   - `intake scan` widens ingestion only; it does not triage, approve, plan, or start execution
   - intake commands run inside governed project roots, not from coordinator workspace roots
   - when a repo participates in a coordinator initiative, operators still run intake in the child repo and use `multi step` for cross-repo orchestration
12. Document the resolve contract:
   - `intake resolve` reads `.agentxchain/state.json` for `target_run` intents
   - `intake resolve` reads coordinator state and barriers for `target_workstream` intents
   - `run_id` must match `intent.target_run`
   - `super_run_id` must match `intent.target_workstream.super_run_id`
   - `blocked` and `completed` are the shipped run-outcome mappings
   - run-level `failed` is reserved/unreached and must be documented as fail-closed, not as a live outcome mapping
   - `active` and `paused` return `no_change: true`
   - `completed` creates `.agentxchain/intake/observations/<intent_id>/` as an empty scaffold
13. Document the re-approval path:
   - `blocked -> approved` is valid through the existing `intake approve` command
   - re-approval does not bypass planning or start a run automatically

## Error Cases

- The page must not describe deduplication as a best-effort heuristic; it is deterministic and idempotent.
- The page must not imply that `intake plan` creates or resumes a governed run.
- The page must not claim that `intake start` reopens completed runs or bypasses pending approval gates.
- The page must not describe `intake scan` as a generic batch wrapper for `manual`; `manual` stays on `intake record`.
- The page must not claim that `awaiting_release_approval`, `released`, or `observing` are already implemented intake states.
- The page must not imply that `intake resolve` writes observation evidence; S5 only creates an empty observation directory scaffold on `completed`.
- The page must not imply that intake runs from a coordinator workspace root.
- The page must not imply that coordinator handoff is automatic; it is an explicit operator command.

## Acceptance Tests

- [ ] AT-1: `website-v2/docs/continuous-delivery-intake.mdx` exists
- [ ] AT-2: `website-v2/sidebars.ts` includes a `Continuous Delivery` section with the intake page
- [ ] AT-3: The page documents `intake record`, `intake triage`, `intake approve`, `intake plan`, `intake start`, `intake handoff`, `intake resolve`, `intake scan`, `intake status`, and `.agentxchain/intake/`
- [ ] AT-4: The page documents the dedup key contract and idempotent duplicate behavior
- [ ] AT-5: The page distinguishes shipped S5 execution-closure states from deferred later-v3 release/observation states
- [ ] AT-6: `.planning/DOCS_SURFACE_SPEC.md` lists `/docs/continuous-delivery-intake`
- [ ] AT-7: The page documents `approved_by`, `planning_artifacts`, `target_run`, and the artifact-conflict rule
- [ ] AT-8: The page documents the `intake scan` snapshot contract, manual-source exclusion, and `created` / `deduplicated` / `rejected` result semantics
- [ ] AT-9: The page documents the `intake resolve` run-outcome mapping, `no_change` behavior, and observation-directory scaffold
- [ ] AT-10: The page documents the coordinator-workspace boundary and points operators to child-repo intake plus `multi step`
- [ ] AT-11: The page documents `target_workstream`, coordinator handoff refs, and `super_run_id`

## Open Questions

None. `intake resolve` closes the first truthful intake lifecycle, and later release or observation work remains explicitly deferred.
