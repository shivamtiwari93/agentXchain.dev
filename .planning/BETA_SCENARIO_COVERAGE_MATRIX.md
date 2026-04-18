# Beta-Tester Scenario Coverage Matrix

> Tracks per-bug test coverage in `cli/test/beta-tester-scenarios/`.
> Requirement: one file per BUG-1 through BUG-30 (source: HUMAN-ROADMAP.md P0 section).

## Matrix

| Bug | Scenario File | Status | Prior Coverage (non-canonical) |
|-----|---------------|--------|-------------------------------|
| BUG-1 | `bug-1-dirty-workspace-false-acceptance.test.js` | PRESENT | `beta-bug-regression.test.js` |
| BUG-2 | `bug-2-session-state-baseline-agreement.test.js` | PRESENT | `beta-bug-regression.test.js` |
| BUG-3 | `bug-3-acceptance-failure-state-transition.test.js` | PRESENT | `beta-bug-regression.test.js` |
| BUG-4 | `bug-4-acceptance-failed-event.test.js` | PRESENT | `beta-bug-regression.test.js` |
| BUG-5 | `bug-5-dispatch-dirty-workspace-warning.test.js` | PRESENT | `beta-bug-regression.test.js` |
| BUG-6 | `bug-6-stream-flag.test.js` | PRESENT | `beta-bug-regression.test.js` |
| BUG-7 | `bug-7-reissue-turn.test.js` | PRESENT | `beta-bug-regression.test.js` |
| BUG-8 | `bug-8-reject-baseline-refresh.test.js` | PRESENT | `beta-bug-regression.test.js` |
| BUG-9 | `bug-9-reassign-gate-removal.test.js` | PRESENT | `governed-cli.test.js` |
| BUG-10 | `bug-10-restart-drift-recovery-commands.test.js` | PRESENT | — |
| BUG-11 | `bug-11-manual-intake-consumption.test.js` | PRESENT | `intake-manual-resume.test.js` |
| BUG-12 | `bug-12-intent-id-propagation.test.js` | PRESENT | `intake-manual-resume.test.js` |
| BUG-13 | `bug-13-prompt-intent-foregrounding.test.js` | PRESENT | `intake-manual-resume.test.js` |
| BUG-14 | `bug-14-intent-coverage-validation.test.js` | PRESENT | `intent-coverage-status.test.js` |
| BUG-15 | `bug-15-status-pending-intents.test.js` | PRESENT | `intent-coverage-status.test.js` |
| BUG-16 | `bug-16-unified-intake-consumption.test.js` | PRESENT | `intent-coverage-status.test.js` |
| BUG-17 | `bug-17-restart-atomicity.test.js` | PRESENT | `bug17-22-regression.test.js` (header only, no test body); BUG-27 scenario covers the reopened variant |
| BUG-18 | `bug-18-state-bundle-integrity.test.js` | PRESENT | `bug17-22-regression.test.js` |
| BUG-19 | `bug-19-gate-reconciliation.test.js` | PRESENT | `bug17-22-regression.test.js`; BUG-28 scenario covers reopened variant |
| BUG-20 | `bug-20-intent-satisfaction-lifecycle.test.js` | PRESENT | `bug17-22-regression.test.js`; BUG-29 scenario covers reopened variant |
| BUG-21 | `bug-21-intent-id-restart.test.js` | PRESENT | — (header only in bug17-22); BUG-30 scenario covers reopened variant |
| BUG-22 | `bug-22-stale-staging-detection.test.js` | PRESENT | `bug17-22-regression.test.js` |
| BUG-23 | `bug-23-checkpoint-turn.test.js` | PRESENT | `checkpoint-turn.test.js`, `continuous-run-e2e.test.js` |
| BUG-25 | `bug-25-reissue-turn-runtime-undefined.test.js` | PRESENT | — |
| BUG-26 | `bug-26-doctor-spawn-parity.test.js` | PRESENT | — |
| BUG-27 | `bug-27-restart-ghost-turn.test.js` | PRESENT | — |
| BUG-28 | `bug-28-stale-gate-state.test.js` | PRESENT | — |
| BUG-29 | `bug-29-satisfied-intents-still-pending.test.js` | PRESENT | — |
| BUG-30 | `bug-30-intent-id-null-in-events.test.js` | PRESENT | — |

## Notes

- BUG-24 does not exist in the bug tracker (numbering skipped from 23 to 25).
- BUG-25 through BUG-30 are reopened variants of earlier bugs or new bugs from report #6.
- All scenario files follow the pattern: scaffold governed project, exercise tester's exact CLI sequence, assert correct behavior.
- Contract test `cli/test/beta-scenario-completeness.test.js` enforces this matrix at CI time.
