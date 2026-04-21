# BUG-54 / BUG-59 Tester Quote-Back Checklist

Status: Static acceptance checklist for interpreting tester evidence. It does not replace `.planning/BUG_59_54_2151_TESTER_QUOTEBACK_RUNBOOK.md`; it defines the minimum quote shape agents must require before closing BUG-59 or BUG-54.

## Purpose

Prevent a closure dispute after the tester posts evidence. The long runbook tells the tester what to run. This checklist tells agents what quoted fields are sufficient, what is insufficient, and how to cross-check the quote against the shipped package.

## BUG-59 Minimum Quote

BUG-59 may close only when the tester quotes all of the following from a real `tusq.dev` dogfood run using `agentxchain@2.151.0` or a later shipped version explicitly intended to carry the same fix:

1. Package proof:
   - `npx --yes -p agentxchain@2.151.0 -c 'agentxchain --version'` prints exactly `2.151.0`.
   - If a later version is used, the quote names that version and agents verify it is published on npm before accepting it.
2. State summary:
   - `jq '{status, phase, pending_run_completion, blocked_on, last_gate_failure}' .agentxchain/state.json`
   - Passing shape: routine gate has no remaining block: `pending_run_completion: null`, `blocked_on: null`, and `last_gate_failure: null`.
   - Failing shape: any routine-gate block remains after evidence is present, or the tester had to patch state manually.
3. Phase-transition approval ledger:
   - At least one `decision-ledger.jsonl` row with `type: "approval_policy"`, `gate_type: "phase_transition"`, `action: "auto_approve"`, and a non-credentialed matched rule.
4. Run-completion approval ledger:
   - At least one `decision-ledger.jsonl` row with `type: "approval_policy"`, `gate_type: "run_completion"`, `gate_id: "qa_ship_verdict"` or project-equivalent final routine gate, `action: "auto_approve"`, and a non-credentialed matched rule.
5. Credentialed counter-case:
   - A gate marked `credentialed: true` remains blocked under the same auto-approval policy.
   - No ledger row auto-approves that credentialed gate.

Agent acceptance rule: do not infer missing ledger rows from final state. BUG-59 is about the approval-policy coupling, so the ledger rows are required evidence, not optional diagnostics.

## BUG-54 Minimum Quote

BUG-54 may close only when the tester quotes all of the following from their machine using the shipped package:

1. Package proof:
   - `agentxchain --version` through pinned `npx --yes -p agentxchain@2.151.0` or a later shipped fix version.
2. Runtime identity:
   - Runtime id and command used for the real `local_cli` dispatches.
3. Ten-dispatch proof:
   - Ten consecutive real dispatches through the normal dogfood flow, or a quoted explanation that normal flow had no derivable work plus ten diagnostic attempts from the registry tarball repro harness.
4. Timing fields:
   - Per-attempt `first_stdout_ms` and watchdog status.
5. Negative searches:
   - No `startup_watchdog_fired`, `stdout_attach_failed`, or `ghost_turn` entries in the quoted `.agentxchain` search output.

Agent acceptance rule: diagnostic-only evidence is support, not full closure, unless the tester explicitly confirms the normal dogfood flow could not produce ten dispatches and the diagnostic uses the same project runtime config.

## Example Pass Shapes

BUG-59 pass shape:

```text
agentxchain --version -> 2.151.0
state: pending_run_completion=null blocked_on=null last_gate_failure=null
ledger: gate_type=phase_transition action=auto_approve matched_rule.when.credentialed_gate=false
ledger: gate_type=run_completion gate_id=qa_ship_verdict action=auto_approve matched_rule.when.credentialed_gate=false
credentialed counter-case: qa_ship_verdict blocked; no auto_approve ledger row for credentialed qa_ship_verdict
```

BUG-54 pass shape:

```text
agentxchain --version -> 2.151.0
runtime: local-pm command=<quoted>
attempts: 10/10
watchdog_fired: false on every attempt
search: no startup_watchdog_fired, stdout_attach_failed, or ghost_turn
```

## Example Fail Shapes

BUG-59 fail shape:

```text
state completed, but no approval_policy ledger row quoted
```

Reason: this proves the run ended, not that policy auto-closed the routine gate.

BUG-54 fail shape:

```text
diagnostic attempts pass, but normal dogfood dispatches still show stdout_attach_failed
```

Reason: BUG-54 is a real runtime reliability bug; diagnostic support cannot override contradictory dogfood failure evidence.

## Agent Cross-Checks

Before accepting a tester quote:

1. Verify the quoted package version is published:

```bash
npm view agentxchain@2.151.0 version
```

2. If the tester used a later version, verify that version's release contains the relevant fix commits before accepting it as equivalent.
3. Compare quoted ledger rows against `DEC-BUG59-CLOSURE-GATE-TESTER-QUOTEBACK-001`; all four BUG-59 fields must be present.
4. Compare quoted BUG-54 timing/search output against `.planning/BUG_59_54_2151_TESTER_QUOTEBACK_RUNBOOK.md`; ten attempts and negative searches must be explicit.
5. Record the acceptance or rejection in `AGENT-TALK.md` with the exact missing field if rejected.
