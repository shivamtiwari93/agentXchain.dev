# BUG-60 Decision Candidate Audit

**Status:** Static inventory only. Written before BUG-59 tester quote-back under `DEC-BUG59-CLOSURE-GATE-TESTER-QUOTEBACK-001`. This file does not add canonical decisions, choose Option A/B, choose schema names, write PM prompt text, or touch `cli/src/lib/`.

**Purpose:** Separate durable BUG-60 pre-commitments that deserve future `DEC-*` entries from audit notes that should stay local to the research files. This keeps `.planning/DECISIONS.md` from becoming a parking lot for every useful observation while still preventing load-bearing constraints from being forgotten.

## Existing BUG-60-Relevant Decisions

| Decision | Status for BUG-60 | Why it matters |
|---|---|---|
| `DEC-BUG59-CLOSURE-GATE-TESTER-QUOTEBACK-001` | Active blocker | BUG-60 implementation, schema decisions, Option A/B selection, PM idle-expansion prompt text, and architectural plan commits remain blocked until tester quote-back proves BUG-59 on the real dogfood project. |
| `DEC-BUG59-APPROVAL-POLICY-GATE-COUPLING-001` | Substrate decision | BUG-60 must build on governed approval-policy closure, not bypass it. Perpetual idle expansion cannot become a side door around gate policy or credentialed hard stops. |
| `DEC-RELEASE-CUT-AND-PUSH-AS-ATOMIC-001` | Release discipline | Any future BUG-60 release must run the prepublish gate before tag creation and complete publish verification in the same chain. |
| `DEC-GITHUB-ACTIONS-FOOTPRINT-FLOOR-001` | CI discipline | BUG-60 proof should be local-first and prepublish-gate-enforced, not a new push-triggered workflow. |

## Minimal Future DEC Set

These should become canonical decisions only after tester quote-back unlocks the BUG-60 plan turn.

| Candidate DEC | Should become canonical? | Trigger | Minimum content |
|---|---|---|---|
| `DEC-BUG60-IDLE-POLICY-ARCHITECTURE-001` | Yes | The plan turn chooses Option A/B or a fourth architecture. | Chosen dispatch architecture; default bounded behavior (`on_idle: exit` remains the default — new perpetual behavior is strictly opt-in, backward-compatible for every existing project); how perpetual mode dispatches PM work; scheduler vs main-loop semantics; why rejected options lost. |
| `DEC-BUG60-BUDGET-BEFORE-IDLE-EXPANSION-001` | Yes — standalone, NOT collapsed. See "Rationale Summary" below. | The plan turn defines the PM idle-expansion flow. | `per_session_max_usd` must block before any PM idle-expansion dispatch can spend again; exact check order relative to `max_runs`, idle policy, and vision/source reads. Cross-architecture invariant: holds under Option A, Option B, and any future variant. |
| `DEC-BUG60-CONTINUOUS-CLI-SCENARIO-HELPER-001` | Yes, but only when the helper extraction commit lands. | The refactor that migrates BUG-53 onto a shared helper. | Helper ownership boundaries: temp repo envelope and CLI invocation are shared; fake-agent behavior and assertions are scenario-local; BUG-53 migration commit precedes BUG-60 scenario commit. |
| `DEC-BUG60-IDLE-EXPANSION-OBSERVABILITY-001` (renamed from `-EVENTS-001`) | Yes if a new event, overloaded `session_continuation`, or new terminal status ships. | The plan turn chooses event AND terminal-status vocabulary. | Event names, summary formatting contract, whether `session_continuation` may carry null `previous_run_id`, packed release-surface assertions, AND terminal-status taxonomy — at minimum five distinct statuses must stay distinguishable: `completed` (bounded max_runs hit), `idle_exit` (bounded queue empty), `vision_exhausted` (perpetual PM declared exhaustion), `vision_expansion_exhausted` (perpetual max_idle_expansions hit), `session_budget` (any mode budget cap). |

## Keep Audit-Only

These are useful constraints but do not deserve canonical `DEC-*` entries yet.

| Item | Keep out of DECISIONS.md because |
|---|---|
| Exact file:line inventories in `BUG_60_CODE_AUDIT.md`, `BUG_60_TEST_SURFACE_AUDIT.md`, and `BUG_60_DOC_SURFACE_AUDIT.md` | Line numbers drift. The durable decision is the behavior contract, not the current citation table. |
| MUST-CHANGE / MUST-EXTEND doc-surface counts | The plan turn should use the audit as a checklist, but counts are implementation planning detail. |
| Candidate config key spellings such as `on_idle`, `on_idle_perpetual`, and `max_idle_expansions` | Names are intentionally unresolved until architecture is chosen. Recording them as DEC text now would launder sketches into commitments. |
| `makeSuccessExecutor(dir)` staying scenario-local | Covered by the future helper-boundary DEC if extraction lands. Until then it is a test-audit constraint. |
| Release-note wording matrix | Belongs in the future release PR/docs change, not the decision ledger, unless it changes protocol behavior. |

## Rationale Summary — `DEC-BUG60-BUDGET-BEFORE-IDLE-EXPANSION-001` Stays Standalone

Adversarially reviewed in Turn 161. Collapse into `DEC-BUG60-IDLE-POLICY-ARCHITECTURE-001` was considered and rejected:

1. **Cross-architecture invariant.** Under Option A (intake pipeline seeds new intent → normal run-start budget check) and Option B (direct PM dispatch with explicit budget gate), the budget-first sentence is identical: "no USD spent past `per_session_max_usd` in perpetual mode, full stop." An invariant that holds across all architecture choices is referenced BY the architecture DEC, not owned by it.
2. **Erosion resistance.** If a future BUG-X reopens the architecture DEC (e.g., merging bounded + perpetual loops), the budget invariant could be accidentally relitigated if buried inside. Separate DEC = separate relitigation gate.
3. **HUMAN-ROADMAP:431 product contract.** "Existing `per_session_max_usd` MUST block perpetual-mode dispatches same as bounded-mode" is a standing product safety contract worth its own decision record.
4. **Anti-catch-all single-concern lint.** Architecture DEC content is already at five fields; adding budget-ordering bloats it past single-concern. One-DEC-one-concern keeps `DECISIONS.md` navigable.

## Process-Ordering Pre-Commitments (Audit-Doc Only)

These are real constraints that exist now, but do not yet deserve DEC entries. They will either be rolled into a DEC when the relevant commit lands or dissolve if the strategy they constrain is abandoned.

| Pre-Commitment | Source turn | Dissolves if | Becomes DEC when |
|---|---|---|---|
| Helper extraction commit migrates BUG-53 first; BUG-60 scenario commit lands after, as second consumer. | Turns 158, 159 | Plan turn decides BUG-53/BUG-60 scenarios stay independent (divergence wider than anticipated). | Extraction commit lands — authored alongside `DEC-BUG60-CONTINUOUS-CLI-SCENARIO-HELPER-001`. |
| `session_continuation` event (if overloaded for idle-expansion rather than a sibling event) must preserve non-null `previous_run_id` in all existing emission sites; new idle-expansion emission sites need a schema branch. | Turn 158 | Plan turn chooses a sibling event instead of overloading. | Plan turn chooses overload — absorbed into `DEC-BUG60-IDLE-EXPANSION-OBSERVABILITY-001`. |

## Non-Negotiable Plan-Turn Check

Before BUG-60 implementation starts, the plan turn must either create the four future DEC entries above or explicitly justify why one was collapsed into another. Silent omission is not acceptable, because the blocked work now has multiple independent constraints: governance substrate, budget ordering, helper extraction sequencing, and audit-event observability.
