# Recovery Report Contract Spec

## Purpose

When a coordinator enters `blocked` state and an operator runs `multi resume`, there is currently no artifact requirement. The operator can clear the blocked state without documenting what caused it, what the impact was, or how it was mitigated. This makes the blocked→recovered transition the only unaudited lifecycle edge in the governed coordinator.

This spec defines a **required recovery report artifact** that operators must create before `multi resume` can succeed, creating a governed audit trail for blocked-state recovery.

## Interface

### Artifact Path

`.agentxchain/multirepo/RECOVERY_REPORT.md` — lives in the coordinator workspace alongside barriers, history, and decision ledger.

### Required Sections

| Section | Purpose | Gated? |
|---------|---------|--------|
| `## Trigger` | What caused the blocked state (hook violation, child failure, divergence, etc.) | Yes |
| `## Impact` | What was affected (which repos, which workstreams, what work was lost or preserved) | Yes |
| `## Mitigation` | What the operator did to resolve the root cause before resuming | Yes |
| `## Owner` | Who performed the recovery (operator name, team, or automation identifier) | No |
| `## Exit Condition` | What must remain true after recovery (e.g., "no child repos blocked") | No |

### Evaluator: `evaluateRecoveryReport(workspacePath)`

- Reads `.agentxchain/multirepo/RECOVERY_REPORT.md` relative to `workspacePath`
- Returns `{ ok: true }` if all three gated sections exist with non-placeholder content
- Returns `{ ok: false, reason: string }` if sections are missing, empty, or contain only placeholders
- Returns `null` if the file does not exist

### Scaffold Placeholder

When a coordinator enters `blocked` state, the system should scaffold `RECOVERY_REPORT.md` with placeholder content:

```
(Operator fills this before running multi resume)
```

### Enforcement Point

`resumeCoordinatorFromBlockedState()` in `cli/src/lib/coordinator-recovery.js`:
- After verifying the coordinator is in `blocked` state and before performing resync
- If `evaluateRecoveryReport()` returns `null` (file missing) or `{ ok: false }`: return `{ ok: false, error: "..." }` without performing any recovery
- If `evaluateRecoveryReport()` returns `{ ok: true }`: proceed with normal recovery flow

### Scaffold Point

Any coordinator path that persists `status: "blocked"` must scaffold `RECOVERY_REPORT.md` if it does not already exist.

Current shipped blocked-entry paths:

- `blockCoordinator()` in `cli/src/commands/multi.js` for post-acceptance hook violations
- `resyncFromRepoAuthority()` in `cli/src/lib/coordinator-recovery.js` when divergence makes a pending gate ambiguous

## Behavior

1. **Coordinator enters blocked state from any shipped path** → system scaffolds `RECOVERY_REPORT.md` with placeholders
2. **Operator investigates** → operator fills in Trigger, Impact, Mitigation
3. **Operator runs `multi resume`** → system validates `RECOVERY_REPORT.md` has real content in gated sections
4. **Validation passes** → normal recovery flow proceeds (resync, child-check, resume)
5. **Validation fails** → resume is rejected with actionable error message

## Error Cases

- Recovery report missing: `"Recovery report required before resume. Create .agentxchain/multirepo/RECOVERY_REPORT.md with ## Trigger, ## Impact, and ## Mitigation sections."`
- Sections have placeholder text: `"Recovery report sections still contain placeholder text: ## Trigger, ## Impact. Replace placeholder content before running multi resume."`
- Some sections missing: `"Recovery report must define ## Impact before resume."`

## Acceptance Tests

- AT-RECOVERY-REPORT-001: `evaluateRecoveryReport()` returns `null` when file is absent
- AT-RECOVERY-REPORT-002: Scaffold placeholders fail validation (all three gated sections)
- AT-RECOVERY-REPORT-003: Real content in all three gated sections passes validation
- AT-RECOVERY-REPORT-004: Mixed real/placeholder content fails, naming specific sections
- AT-RECOVERY-REPORT-005: `multi resume` rejects recovery when report is absent
- AT-RECOVERY-REPORT-006: `multi resume` rejects recovery when report has placeholders
- AT-RECOVERY-REPORT-007: `multi resume` succeeds when report has real content
- AT-RECOVERY-REPORT-008: Blocked-state entry scaffolds `RECOVERY_REPORT.md` if not present
- AT-RECOVERY-REPORT-010: Resync-driven blocked state also scaffolds `RECOVERY_REPORT.md`
- AT-RECOVERY-REPORT-009: Spec guard

## Open Questions

None — this is the narrowest enforceable slice. Future extensions: single-repo `step --resume` enforcement (separate spec), recovery report inclusion in coordinator exports and reports.
