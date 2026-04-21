# BUG-52/53/54/55 Tester Unblock Runbook

Use this in the original failing worktree after installing or selecting
`agentxchain@2.150.0`. First quote:

```bash
agentxchain --version
git rev-parse --show-toplevel
```

## BUG-52: Phase-gate Unblock Advances Phase

Run this twice: once for the real `planning_signoff` escalation and once for
the real `qa_ship_verdict` escalation.

```bash
agentxchain accept-turn --turn <accepted_turn_id> && agentxchain checkpoint-turn --turn <accepted_turn_id> && agentxchain unblock <hesc_id> && agentxchain resume
```

Quote: `phase_entered` with `trigger: "reconciled_before_dispatch"`, the next
dispatched turn id, phase, and role. Planning must dispatch `dev`; QA must
dispatch `launch`. State whether any manual `.agentxchain/state.json` edit was
needed.

## BUG-53: Continuous Auto-chain

Run from a clean continuous session:

```bash
agentxchain run --continuous --max-runs 3
```

Quote: each `session_continuation <previous_run_id> -> <next_run_id>
(<next_objective>)` line, final `.agentxchain/continuous-session.json.status`,
`runs_completed`, and whether `paused` appeared between completed runs.

## BUG-54: Local CLI Spawn/attach Reliability

Run inside the failing worktree:

```bash
node cli/scripts/reproduce-bug-54.mjs --attempts 10 --watchdog-ms 10000 --out /tmp/bug54-v2-150-0.json
```

Quote from JSON: `command_probe.status`, `command_probe.stdout`,
`summary.spawn_attached`, `summary.stdout_attached`,
`summary.watchdog_fires`, `summary.classification_counts`,
`summary.success_rate_first_stdout`, first failing attempt
`first_stdout_ms`, `first_stderr_ms`, `stdout_bytes_total`,
`stderr_bytes_total`, `watchdog_fired`, `exit_signal`,
`env_snapshot.auth_env_present`, and `spawn_shape`.

## BUG-55: Checkpoint Completeness

Run on the QA turn that previously left dirty actor files or verification
fixtures:

```bash
agentxchain accept-turn --turn <qa_turn_id> && agentxchain checkpoint-turn --turn <qa_turn_id> && git status --short
```

Quote: accepted turn id, checkpoint SHA, complete declared `files_changed`,
declared `verification.produced_files`, `git status --short`, and any
`undeclared_verification_outputs` or `divergent_from_accepted_lineage` field.

## Paste Target

Paste these four evidence blocks into `.planning/AGENT-TALK.md` or the beta bug
thread. Do not paste secrets; auth env booleans are enough for BUG-54.
