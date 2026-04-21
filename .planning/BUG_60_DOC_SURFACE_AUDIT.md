# BUG-60 Doc / Spec Surface Audit (Pre-work Turn A, quote-back-independent)

**Status:** Static inventory only. Written under the narrowed DEC-BUG59-CLOSURE-GATE-TESTER-QUOTEBACK-001 (Turn 154). No Option A/B selection, no schema commit, no `cli/src/lib/` modifications. Every classification below is a factual reading of shipped text — what the surface says today vs. what BUG-60's delivery will have to change.

**Purpose:** Bank the doc/spec surface inventory now so the real BUG-60 plan turn does not have to re-discover which surfaces are load-bearing for continuous-idle semantics. The inventory is independent of BUG-59's behavior on `tusq.dev`: it describes text already shipped.

**Classification key:**

- **MUST-CHANGE** — surface makes a claim that will become inaccurate the moment BUG-60 ships a `perpetual` policy (e.g., "session exits when no derivable work"). Not fixing it is a new doc-reality gap.
- **MUST-EXTEND** — surface currently lists modes/options and omits the new one; BUG-60 must add, not rewrite.
- **MIGHT-TOUCH** — surface mentions continuous idle behavior tangentially; whether it changes depends on the research-turn choice of Option A vs B and on whether the PM-expansion path reuses or extends the `session_continuation` event.
- **NO-CHANGE** — surface mentions continuous mode but does not constrain idle behavior; can stay as-is unless the plan turn chooses to cite the new policy there.

**Scope restriction (self-imposed):** no rewrites, no drafts, no prescriptive language. This file enumerates and classifies. The plan turn owns the actual wording.

---

## MUST-CHANGE (5 surfaces)

These surfaces will go from "accurate" to "misleading" the moment BUG-60 ships.

| Surface | File:line | What it claims today | Why BUG-60 breaks it |
|---|---|---|---|
| Lights-out operation guide — "Know how the loop stops" | `website-v2/docs/lights-out-operation.mdx:219-227` | Lists exactly 5 terminal reasons: `max_runs`, `max_idle_cycles` with no queued or vision-derived work, `per_session_max_usd`, unresolved escalation, `SIGINT`. | Under `on_idle: perpetual`, `max_idle_cycles` is NOT a terminal reason — it triggers PM expansion. New terminal reasons: `vision_exhausted`, `vision_expansion_exhausted`. The five-item list becomes wrong-by-omission. |
| Lights-out scheduling — terminal-exit wording | `website-v2/docs/lights-out-scheduling.mdx:207`, `:217` | `max_idle_cycles` described as "Max daemon polls with no derivable work before idle exit" and in step 5, "exits terminally when … `max_idle_cycles` consecutive polls find no work." | Same gap as above. Under `perpetual` mode, `max_idle_cycles` triggers PM synthesis, not exit. Copy must distinguish bounded vs perpetual idle semantics. |
| VISION_DRIVEN_CONTINUOUS_SPEC.md — Exit criteria + acceptance | `.planning/VISION_DRIVEN_CONTINUOUS_SPEC.md:68-72, 132, 140` | Flow step 6f says "If no candidates… increment idle counter" then exits after `max_idle_cycles` with "All vision goals appear addressed." Acceptance test `AT-VCONT-002` codifies this exit. | Under `perpetual`, the step-6f branch dispatches PM instead of incrementing-to-exit. `AT-VCONT-002` must either stay bounded-only (and be renamed) or be paired with an `AT-VCONT-PERPETUAL-00X` companion. |
| CLI reference — `--max-idle-cycles` flag description | `website-v2/docs/cli.mdx:833`, `:885` | "Stop after N consecutive idle cycles with no derivable work." | Same inaccuracy class as above; flag behavior is mode-dependent. New `--on-idle` flag (if shipped) must be documented, and the `--max-idle-cycles` copy must cite mode coupling. |
| Continuous budget enforcement spec — pre-run ordering | `.planning/CONTINUOUS_BUDGET_ENFORCEMENT_SPEC.md:88` | Budget check "happens after the terminal checks (max_runs, max_idle_cycles) and before the vision file validation." | Under `perpetual`, `max_idle_cycles` is not necessarily terminal. The budget check still must fire before any PM idle-expansion dispatch can spend again, so this ordering sentence must be rewritten regardless of Option A/B or terminal-status naming. |

## MUST-EXTEND (3 surfaces)

Surfaces that currently enumerate continuous config keys; BUG-60 adds keys, does not invalidate existing ones.

| Surface | File:line | What it enumerates today | What BUG-60 adds |
|---|---|---|---|
| CLI reference — continuous config table | `website-v2/docs/cli.mdx:885` (and surrounding table) | `continuous.enabled`, `continuous.vision_path`, `continuous.max_runs`, `continuous.max_idle_cycles`, `continuous.triage_approval`, `continuous.per_session_max_usd`. | New keys: `continuous.on_idle` (enum), `continuous.on_idle_perpetual.sources[]`, `continuous.on_idle_perpetual.max_idle_expansions`, `continuous.on_idle_perpetual.pm_mandate_override_path`, `continuous.on_idle_perpetual.output_schema`, `continuous.on_idle_perpetual.stop_when_pm_declares_exhausted`. (Exact key names are a plan-turn decision; roadmap sketch at HUMAN-ROADMAP.md:342-362 is indicative, not binding.) |
| SCHEDULE_CONTINUOUS_MODE_SPEC.md — action enumeration | `.planning/SCHEDULE_CONTINUOUS_MODE_SPEC.md:106-108` | Valid `status` values `running/blocked/completed/idle_exit/failed`. Valid `action` examples include `max_idle_reached, vision_missing, no_work_found, seeded_from_vision, started_run, run_blocked, prepare_failed, resolve_failed, vision_scan_error`. | New valid statuses if the plan turn adopts them: `vision_exhausted`, `vision_expansion_exhausted`. New actions: `pm_idle_expansion_dispatched`, `pm_idle_expansion_accepted`, `pm_idle_expansion_malformed`, `pm_declared_vision_exhausted`. (Again, names are plan-turn decisions; shape is mandatory.) |
| Lights-out operation guide — minimum discipline | `website-v2/docs/lights-out-operation.mdx:236-247` | Six-step floor: doctor, one bounded proof, session budget, watch status/events, `inject --priority p0`, `unblock`. | Perpetual mode needs a sibling discipline item: the PM-expansion prompt must be reviewed by the operator before enabling perpetual mode, and `max_idle_expansions` must be set to a bounded value. Not a rewrite of the six steps — a new item. |

## MIGHT-TOUCH (2 surfaces)

Whether these change depends on architectural choices deliberately not made this turn.

| Surface | File:line | Why it might change |
|---|---|---|
| SCHEDULE_CONTINUOUS_MODE_SPEC.md — `last_status` enum | `.planning/SCHEDULE_CONTINUOUS_MODE_SPEC.md:83` | Currently `continuous_running/continuous_blocked/continuous_completed/continuous_idle_exit/continuous_failed`. If BUG-60 adds a `vision_exhausted` terminal status and the scheduler daemon surfaces it, this enum extends. If the plan turn folds `vision_exhausted` under `continuous_completed` + a sub-reason, this enum is unchanged. Decision belongs to the plan turn. |
| CONTINUOUS_FAILURE_RECOVERY_SPEC.md | `.planning/CONTINUOUS_FAILURE_RECOVERY_SPEC.md` (entire file) | Spec scopes failure recovery to dispatch-error, priority-preempt, and blocked-state. PM-idle-expansion introduces a new failure class (PM produced malformed output). Plan turn decides whether that class is a CONTINUOUS_FAILURE_RECOVERY extension or a BUG-60-owned new spec. |

## NO-CHANGE (confirmed scope-free)

Surfaces that mention continuous mode but do not constrain idle policy. Listed so the plan turn does not waste review time on them.

- `PROTOCOL-v7.md:87-94` — defines governed run statuses (`idle/active/paused/blocked/completed/failed`). This is run-level `idle`, not continuous-session idle. No change.
- `cli/CHANGELOG.md` — historical record; only future versions add BUG-60 notes; no retroactive rewrite.
- `README.md:32, :414` — mentions continuous-delivery intake pipeline, not continuous run mode. No idle semantics.
- Release notes for v2.117 through v2.150 — historical record of continuous-mode evolution. No rewrite; new release note ships with BUG-60.
- `website-v2/docs/examples/live-continuous-3run-proof.mdx` — lives proof with fixed `max_idle_cycles: 3` and fixed intent count. Plan turn may add a perpetual sibling proof page, but the existing bounded proof stays correct.
- `examples/governed-todo-app/README.md:195` — single-line mention of nightly CI continuous automation; not idle-policy-load-bearing.

## Cross-surface consistency check (non-blocking finding)

`v2-151-0.mdx:224` already says "BUG-60 perpetual continuous policy: NOT shipped in v2.151.0." That release note is honest and does not need to change — BUG-60's future release note will flip the claim. The existing sentence is evidence the product team already surfaced the gap publicly; anyone reading the v2.151.0 page knows BUG-60 is pending.

`.planning/HUMAN-ROADMAP.md:258-459` is the authoritative source for the BUG-60 spec and is outside this classification — it is human-owned text, updated by the human, not by the plan turn.

`.planning/VISION.md` is explicitly out of scope for this audit. Per WAYS-OF-WORKING, the vision file is human-owned. BUG-60 changes behavior to read VISION.md / ROADMAP.md / SYSTEM_SPEC.md as sources; it does not edit VISION.md itself.

## What this audit does NOT do (and why)

- Does NOT propose the new copy for any MUST-CHANGE surface. Wording is a plan-turn commitment.
- Does NOT pick between the naming variants (`on_idle` vs `continuous_policy` vs `idle_policy`). Names are architectural commitments.
- Does NOT answer whether release notes for v2.147.0 / v2.148.0 / v2.150.0 need retroactive clarification. Historical record discipline is a standing rule (do not rewrite shipped release notes); if the plan turn wants a clarification, it ships in the BUG-60 release note, not in the old ones.
- Does NOT touch any `website-v2/docs/` or `.planning/` file. This audit is a new standalone document.

## Implications the plan turn should acknowledge

1. **Five MUST-CHANGE surfaces is the minimum doc touchpoint set.** Any BUG-60 PR that lands code without updating these five surfaces ships a doc-reality gap on day one.
2. **Three MUST-EXTEND surfaces require additive edits, not rewrites.** The config-table + action-enum + discipline-floor changes are the lowest-friction doc work and should land in the same commit as the code.
3. **The MIGHT-TOUCH set is decision-driven.** If the plan turn resolves these (e.g., "new terminal statuses surface in scheduler enum: yes") the audit collapses. If it punts, the ambiguity carries into implementation.
4. **No doc or spec surface today forbids a `perpetual` mode.** There is no structural conflict — BUG-60 is additive across the whole doc surface. The question is only whether the additions are complete and consistent, not whether they are compatible.

---

## Resume points for the real BUG-60-RESEARCH-CLAUDE turn

After tester quote-back on BUG-59 lands, the research turn extends this file (or its successor) with:

1. The chosen config-key names (for MUST-EXTEND surfaces).
2. The chosen terminal-status vocabulary (collapses MIGHT-TOUCH rows 1 and 2).
3. The PM-idle-expansion prompt text (lands as a new scaffold artifact, referenced by the extended CLI config docs).
4. Draft copy for the MUST-CHANGE row 1 (lights-out "how the loop stops") — since that surface has the highest operator-visibility.
