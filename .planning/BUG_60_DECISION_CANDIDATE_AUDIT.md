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
| `DEC-BUG60-IDLE-POLICY-ARCHITECTURE-001` | Yes | The plan turn chooses Option A/B or a fourth architecture. | Chosen dispatch architecture; default bounded behavior (`on_idle: exit` remains the default — new perpetual behavior is strictly opt-in, backward-compatible for every existing project); how perpetual mode dispatches PM work; scheduler vs main-loop semantics; vision-coherence invariant as a one-sentence assertion that synthesized intents must cite at least one VISION.md goal they advance; why rejected options lost. |
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

## GPT Adversarial Review — Observability DEC Boundary

Turn 161 broadened `DEC-BUG60-IDLE-EXPANSION-EVENTS-001` into `DEC-BUG60-IDLE-EXPANSION-OBSERVABILITY-001`, covering both event vocabulary and terminal-status taxonomy. Challenge accepted: status is state-machine data, while events are audit-log data. They are written by different code paths, asserted by different tests, and can fail independently.

Verdict: keep the single broadened observability DEC, but make it explicitly two-part. Splitting into separate status and event DECs would reduce local broadness but create a worse product risk: the stop reason operators see in session state could drift from the event trail they use to diagnose the same stop. BUG-60's user-facing question is singular: "why did the perpetual loop continue, stop, or spend again?" A single observability DEC should own that answer.

Guardrail for the future DEC: it must contain two named subsections, **Terminal State Contract** and **Event Trail Contract**, and the proof plan must assert each independently:

- Terminal assertions: persisted `continuous-session.json` status and/or stop reason distinguish bounded `completed`, bounded `idle_exit`, perpetual `vision_exhausted`, perpetual `vision_expansion_exhausted`, and budget `session_budget`.
- Event assertions: run-event JSONL contains the chosen idle-expansion dispatch/acceptance/exhaustion/malformed events with summary formatting that remains readable in `recent-event-summary.js`.

Failure mode if this review is ignored: a broad "observability" DEC can become a dumping ground where tests prove only event emission while persisted terminal state stays collapsed under `completed`, or vice versa. The future DEC is acceptable only if both halves are first-class and separately tested.

## GPT Adversarial Review — `on_idle` Default Placement

Turn 161 recommended keeping `on_idle` default preservation inside `DEC-BUG60-IDLE-POLICY-ARCHITECTURE-001`, not as a standalone `DEC-BUG60-BACKWARD-COMPAT-DEFAULT-001`. Challenge accepted.

Verdict: keep it in the architecture DEC, but require it as an explicit compatibility clause and proof row. A standalone "perpetual is opt-in forever" DEC would overstate the contract: it would accidentally bind future major-version strategy before the product has even shipped the first perpetual mode. The durable decision needed for BUG-60 is narrower: this release must be backward-compatible, and existing projects must continue to get bounded idle exit unless they explicitly opt into perpetual behavior.

Concrete failure mode if inlined too weakly: implementation adds `on_idle: "perpetual"` as a new default because it matches the marketing phrase "full-auto," breaking existing bounded sessions and invalidating BUG-53's idle-exit proof. To prevent that, the plan-turn checklist below requires default-preservation assertions before any implementation begins.

## Process-Ordering Pre-Commitments (Audit-Doc Only)

These are real constraints that exist now, but do not yet deserve DEC entries. They will either be rolled into a DEC when the relevant commit lands or dissolve if the strategy they constrain is abandoned.

| Pre-Commitment | Source turn | Dissolves if | Becomes DEC when |
|---|---|---|---|
| Helper extraction commit migrates BUG-53 first; BUG-60 scenario commit lands after, as second consumer. | Turns 158, 159 | Plan turn decides BUG-53/BUG-60 scenarios stay independent (divergence wider than anticipated). | Extraction commit lands — authored alongside `DEC-BUG60-CONTINUOUS-CLI-SCENARIO-HELPER-001`. |
| `session_continuation` event (if overloaded for idle-expansion rather than a sibling event) must preserve non-null `previous_run_id` in all existing emission sites; new idle-expansion emission sites need a schema branch. | Turn 158 | Plan turn chooses a sibling event instead of overloading. | Plan turn chooses overload — absorbed into `DEC-BUG60-IDLE-EXPANSION-OBSERVABILITY-001`. |

## Plan-Turn Gating Checklist

When tester quote-back unlocks BUG-60, the plan turn must start from this checklist. This is not the plan itself and does not choose Option A/B; it prevents the plan from skipping already-banked constraints.

```markdown
### BUG-60 Plan-Turn Opening Checklist

- [ ] Quote-back gate verified: BUG-59 has real tester evidence satisfying `DEC-BUG59-CLOSURE-GATE-TESTER-QUOTEBACK-001` (state summary, phase-transition policy ledger row, run-completion policy ledger row, credentialed hard-stop counter-case).
- [ ] Current state rechecked: rerun `git status --short`; reread `.planning/HUMAN-ROADMAP.md` BUG-60 entry; confirm no newer unchecked human item supersedes BUG-60.
- [ ] Audit inputs read in order:
  - [ ] `.planning/BUG_60_CODE_AUDIT.md`
  - [ ] `.planning/BUG_60_TEST_SURFACE_AUDIT.md`
  - [ ] `.planning/BUG_60_DOC_SURFACE_AUDIT.md`
  - [ ] `.planning/BUG_60_DECISION_CANDIDATE_AUDIT.md`
- [ ] Architecture plan written before code: choose Option A, Option B, or a fourth option with evidence; explicitly reject the losing options.
- [ ] DEC authoring handled before any `cli/src/lib/` change. Test-only infrastructure is allowed only under the deferred helper-DEC rule below:
  - [ ] Create `DEC-BUG60-IDLE-POLICY-ARCHITECTURE-001`, including the compatibility clause that default bounded behavior remains `on_idle: exit`.
  - [ ] Create `DEC-BUG60-BUDGET-BEFORE-IDLE-EXPANSION-001` or explicitly justify a collapse.
  - [ ] Create `DEC-BUG60-IDLE-EXPANSION-OBSERVABILITY-001`, with separate Terminal State Contract and Event Trail Contract subsections.
  - [ ] Defer `DEC-BUG60-CONTINUOUS-CLI-SCENARIO-HELPER-001` until the helper extraction commit lands, unless the plan abandons extraction and says why.
- [ ] Proof plan written before code:
  - [ ] Default `on_idle: exit` keeps existing BUG-53 idle-exit behavior.
  - [ ] Perpetual mode dispatches PM idle-expansion after idle threshold.
  - [ ] Budget cap blocks before PM idle-expansion dispatch can spend.
  - [ ] `max_idle_expansions` stops runaway expansion.
  - [ ] PM `vision_exhausted` stop is distinct from bounded `completed` / `idle_exit`.
  - [ ] Event trail and persisted terminal state are asserted independently.
  - [ ] Source CLI beta scenario and packed CLI release-gate proof are both required.
- [ ] First implementation-gated item selected: schema/default parsing slice first (`on_idle` or chosen equivalent added with bounded `exit` default and no behavior change). Helper extraction/migration follows only when the BUG-60 perpetual-branch scenario is the committed next consumer. No `cli/src/lib/continuous-run.js`, `vision-reader.js`, `intake.js`, or `normalized-config.js` edits before the above checks are complete.
```

## Non-Negotiable Plan-Turn Check

Before BUG-60 implementation starts, the plan turn must either create the four future DEC entries above or explicitly justify why one was collapsed into another. Silent omission is not acceptable, because the blocked work now has multiple independent constraints: governance substrate, budget ordering, helper extraction sequencing, and audit-event observability.
