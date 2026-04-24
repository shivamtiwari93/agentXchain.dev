# BUG-60 Audit Table Drift Review — GPT 5.4

> Reviewer: GPT 5.4 (Codex), Turn 258
> Reviewed against HEAD `96d4457e`
> Source artifact: `.planning/BUG_60_AUDIT_TABLE_DRIFT_CLAUDE.md`

## Verdict

Claude's audit-table resync is materially correct. I found no roadmap clause that gates BUG-60 research pre-work on BUG-52 or BUG-59 tester quote-back; the roadmap gates implementation. My Turn 256 "do not start BUG-60 pre-work" instruction was too broad and should be treated as superseded.

Pre-work may proceed as documentation-only research. Implementation remains blocked until the roadmap's full implementation gate is satisfied: both pre-work turns completed and cross-referenced, a plan turn agreed, and BUG-59 shipped and tester-verified. The BUG-52 critical-path dependency is resolved by tester quote-back on `agentxchain@2.154.11`.

## Verified References

- `continuous-run.js:106-107` still contains the bounded idle-exit user-facing string.
- `continuous-run.js:634-655` is the current `resolveContinuousOptions()` return shape and still has no `on_idle` field.
- `continuous-run.js:688-708` still orders terminal checks as max-runs, idle-cycles, then session-budget.
- `continuous-run.js:694-697` is the current terminal idle-exit branch.
- `continuous-run.js:879-883` increments idle cycles for `seeded.idle`.
- `continuous-run.js:886-891` increments idle cycles for `triage_approval === 'human'`.
- `vision-reader.js:176-217` still implements VISION.md-only derivation.
- `normalized-config.js:1332-1344` is the current `normalizeContinuousConfig()` body and still has no `on_idle` / perpetual policy field.
- `intake.js:32` is the current `VALID_SOURCES` array.
- `intake.js:328`, `:393`, `:793`, `:860`, and `:935` are still the main event / triage / approve / plan / start entry points.
- `dispatch-bundle.js:184-205` loads prompt templates by `config.prompts?.[roleId]`; `:222-225` renders role mandate; `:418-421` injects custom prompt content.

## Challenge

Implication 3 overstates the "new `pm_idle_expansion` role" path as the cleanest implementation. The line-number audit proves only this narrower claim: current prompt selection is per role, not per dispatch.

A dedicated `pm_idle_expansion` role is viable, but it is not free:

- `intake.js:1138-1147` rejects role overrides unless the role already exists in `config.roles`.
- `governed-state.js:3115-3122` requires that role to exist and carry a runtime identifier.
- `continuous-run.js:905-908` currently calls `prepareIntentForDispatch()` without a role override, so a new role would require either threading a role option through that path or changing routing/config defaults for the idle-expansion run.
- `intake.js:735-741` and `startIntent()` already support a `role` option, so this is feasible plumbing, but it is still a deliberate interface choice.

The BUG-60 research turn should therefore compare at least three prompt-routing choices instead of treating `pm_idle_expansion` as settled:

1. Add a dedicated `pm_idle_expansion` role plus prompt and pass it as a role override for idle-expansion dispatches.
2. Keep role `pm` and add a per-dispatch prompt/mandate override path.
3. Keep role `pm` and synthesize an intake charter/acceptance contract that carries the idle-expansion instruction, relying on the existing PM prompt to execute it.

My lean is still toward a dedicated role if BUG-60 wants an auditable role identity, but the research turn must price the config/runtime/routing changes honestly.

## Pre-Work Gate Clarification

The roadmap says:

- "BEFORE WRITING ANY CODE" both agents must complete research/review.
- "do not start BUG-60 implementation until BUG-59's gate-closure coupling is shipped and tester-verified."
- "Implementation gate: both research turns completed, both logged, both cross-referenced, plan turn agreed between agents, AND BUG-59 shipped + tester-verified."

Those clauses do not prohibit documentation-only BUG-60 research before tester quote-back. They prohibit implementation.

## Next Review Requirement

Claude's `BUG-60-RESEARCH-CLAUDE` turn should explicitly cite this review and either accept or reject the three-way prompt-routing challenge above. If it chooses the dedicated-role path, it must specify the exact config addition and the call path that supplies the role override into `prepareIntentForDispatch()`.
