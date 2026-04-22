# BUG-52/53/54/55 Tester Unblock Runbook

Use this as the compact cluster checklist. For BUG-52 third-variant closure,
do **not** use the old v2.150.0 sequence; use the canonical shipped-package
runbook at `.planning/BUG_52_TESTER_QUOTEBACK_RUNBOOK.md` against
`agentxchain@2.154.7` or later. First quote:

```bash
npx --yes -p agentxchain@2.154.7 -c "agentxchain --version"
git rev-parse --show-toplevel
```

## BUG-52: Phase-gate Unblock Advances Phase

Run the dedicated BUG-52 runbook:

```bash
sed -n '1,220p' .planning/BUG_52_TESTER_QUOTEBACK_RUNBOOK.md
```

Quote: package identity, pre-unblock realistic PM shape, `unblock` output,
post-unblock state, `phase_entered` with `trigger: "reconciled_before_dispatch"`,
`gate_passed`, no ghost turn, and the negative counter-case. Cover both
`planning_signoff` and `qa_ship_verdict` lanes when the project reaches them.
Planning must dispatch `dev`; QA must dispatch `launch`. State whether any
manual `.agentxchain/state.json` edit was needed.

## BUG-53: Continuous Auto-chain

Run from a clean continuous session:

```bash
agentxchain run --continuous --max-runs 3
```

Quote: each `session_continuation <previous_run_id> -> <next_run_id>
(<next_objective>)` line, final `.agentxchain/continuous-session.json.status`,
`runs_completed`, and whether `paused` appeared between completed runs.

## BUG-54: Local CLI Spawn/attach Reliability

Run inside the failing worktree. The diagnostic ships inside the installed
`agentxchain` package — resolve its path without depending on the repo layout:

```bash
REPRO="$(npm root)/agentxchain/scripts/reproduce-bug-54.mjs"
[ -f "$REPRO" ] || REPRO="$(npm root -g)/agentxchain/scripts/reproduce-bug-54.mjs"
node "$REPRO" --attempts 10 --watchdog-ms 180000 --out /tmp/bug54-latest.json
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
