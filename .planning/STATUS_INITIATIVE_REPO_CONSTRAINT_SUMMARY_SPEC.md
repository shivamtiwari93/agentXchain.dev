## Status + Initiative Repo Constraint Summary Spec

**Status:** shipped

### Purpose

Freeze the first-glance cross-run constraint contract for two summary surfaces:

- repo-local `agentxchain status`
- coordinator dashboard `Initiative`

The goal is not to turn either surface into a report. The goal is to stop forcing operators to infer active carryover constraints from raw arrays or buried per-barrier details.

### Interface

- Repo-local CLI:
  - `cli/src/commands/status.js`
  - human-readable `agentxchain status`
  - `agentxchain status --json`
- Coordinator dashboard:
  - `cli/dashboard/components/initiative.js`
- Shared repo-decision summary contract:
  - `cli/src/lib/repo-decisions.js`

### Behavior

1. Repo-local `status` owns repo-decision carryover for the current governed repo.
   - Human-readable output keeps a compact `Repo decisions` line.
   - When repo-decision history exists, it also prints one compact `Carryover` line with first-glance significance only.
   - `status --json` keeps the raw additive `repo_decisions` field and adds additive `repo_decision_summary`.
2. `repo_decision_summary` is derived from the durable `.agentxchain/repo-decisions.jsonl` file, not only from `state.repo_decisions`.
   - This preserves overridden-only history instead of hiding it when no active constraints remain.
3. The status carryover summary may include:
   - active and overridden counts
   - active categories
   - highest active authority
   - supersession lineage counts
4. Coordinator `Initiative` owns first-glance coordinator decision constraints, not repo-local carryover.
   - When barriers declare `required_decision_ids_by_repo` or legacy `alignment_decision_ids`, `Initiative` renders a compact `Cross-Run Constraints` summary card.
   - The card must stay summary-level: counts, one pending repo requirement, and a pointer to the existing barrier breakdown.
5. Full per-barrier decision requirement detail stays in `Barrier Snapshot`.
   - `Initiative` must not duplicate every repo/decision row inline.

### Error Cases

- If `.agentxchain/repo-decisions.jsonl` does not exist, `status` must not invent a summary.
- If repo-decision history exists but every decision is overridden, `status` still exposes `repo_decision_summary`; the carryover line must make it clear that no active constraints remain.
- If coordinator barriers contain malformed or empty decision-id maps, `Initiative` ignores those entries and renders only truthful aggregate data.

### Acceptance Tests

- `AT-SRDC-001`: `status` text renders compact repo-decision carryover counts plus first-glance significance.
- `AT-SRDC-002`: `status --json` exposes additive `repo_decision_summary` reconstructed from repo-decision history.
- `AT-IV-RCS-001`: `Initiative` renders a compact `Cross-Run Constraints` card when decision-constrained barriers exist.
- `AT-IV-RCS-002`: `Initiative` keeps full requirement detail in `Barrier Snapshot` instead of inlining every pending repo requirement.

### Open Questions

- None for this slice. If operators need deeper cross-run analysis later, that belongs in a dedicated surface rather than silent expansion of `status` or `Initiative`.
