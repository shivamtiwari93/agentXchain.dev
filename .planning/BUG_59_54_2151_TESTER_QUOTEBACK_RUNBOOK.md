# BUG-59 / BUG-54 v2.151.0 Tester Quote-Back Runbook

Status: Active — required before BUG-60 research or implementation starts.

## Purpose

Collect the exact real-tester evidence needed to close the shipped
`agentxchain@2.151.0` BUG-59 and BUG-54 contracts on `tusq.dev`.

Agent-side published-package proof is already green. It is not enough to
unlock BUG-60. The real tester must quote the fields below from their own
dogfood run because BUG-59 is a product-behavior claim and BUG-54 depends on
local CLI runtime timing on the tester's machine.

## Preconditions

Run every command from the `tusq.dev` repo root. Quote these first:

```bash
pwd
git rev-parse --show-toplevel
npx --yes -p agentxchain@2.151.0 -c 'agentxchain --version'
```

The version output must be exactly:

```text
2.151.0
```

## BUG-59 Positive Path: Routine Gates Auto-Close

Run a real continuous dogfood session with the published package. Use the
same operational shape as the v2.150.0 tester run, but pin the package:

```bash
npx --yes -p agentxchain@2.151.0 -c 'agentxchain run --continuous --vision .planning/VISION.md --max-runs 1 --max-idle-cycles 3 --poll-seconds 5 --triage-approval auto --auto-checkpoint --no-report'
```

If the project already has a paused or blocked run that is waiting on a
routine non-credentialed gate, use the same published binary to continue it:

```bash
npx --yes -p agentxchain@2.151.0 -c 'agentxchain status'
npx --yes -p agentxchain@2.151.0 -c 'agentxchain resume'
npx --yes -p agentxchain@2.151.0 -c 'agentxchain status'
```

Quote the state summary:

```bash
jq '{status, phase, pending_run_completion, blocked_on, last_gate_failure}' .agentxchain/state.json
```

BUG-59 positive closure requires this shape after a routine QA ship verdict or
equivalent non-credentialed routine gate:

```json
{
  "status": "completed",
  "pending_run_completion": null,
  "blocked_on": null,
  "last_gate_failure": null
}
```

`phase` may differ by project template. Quote it anyway.

## BUG-59 Ledger Quote-Back

Quote the policy-auto-approval rows:

```bash
jq -c 'select(.type == "approval_policy") | {timestamp, gate_type, gate_id, action, from_phase, to_phase, reason, matched_rule}' .agentxchain/decision-ledger.jsonl
```

BUG-59 closure requires at least these two rows from the tester's run:

```text
gate_type=phase_transition action=auto_approve gate_id=<planning or equivalent routine phase gate>
gate_type=run_completion action=auto_approve gate_id=qa_ship_verdict
```

The `matched_rule.when` object must include `credentialed_gate: false` or an
equivalent generated non-credentialed guard. If the ledger has no
`approval_policy` rows, BUG-59 is not closed.

## BUG-59 Credentialed Negative Path

This verifies that `credentialed: true` remains a hard stop even under the
same auto-approval policy. Use a throwaway branch or backup the config first:

```bash
cp agentxchain.json /tmp/agentxchain.bug59.credentialed-backup.json
node -e 'const fs=require("fs"); const p="agentxchain.json"; const c=JSON.parse(fs.readFileSync(p,"utf8")); c.gates ||= {}; c.gates.qa_ship_verdict ||= {}; c.gates.qa_ship_verdict.credentialed = true; fs.writeFileSync(p, JSON.stringify(c, null, 2) + "\n");'
npx --yes -p agentxchain@2.151.0 -c 'agentxchain run --continuous --vision .planning/VISION.md --max-runs 1 --max-idle-cycles 3 --poll-seconds 5 --triage-approval auto --auto-checkpoint --no-report'
jq '{status, phase, pending_run_completion, blocked_on, last_gate_failure}' .agentxchain/state.json
jq -c 'select(.type == "approval_policy") | {timestamp, gate_type, gate_id, action, reason, matched_rule}' .agentxchain/decision-ledger.jsonl
cp /tmp/agentxchain.bug59.credentialed-backup.json agentxchain.json
```

Required negative evidence:

- `qa_ship_verdict` stays blocked or pending human approval.
- No `approval_policy` row auto-approves `gate_id == "qa_ship_verdict"`.
- The status output names the human approval path instead of silently
  completing the run.

If the one-line config edit creates unrelated dirty-worktree friction, quote
that and stop; do not manually patch state to force the negative case.

## BUG-54 Ten-Dispatch Watchdog Quote-Back

BUG-54 is not closed by source tests alone. Run ten real `local_cli`
dispatches through the published package on the tester machine. The preferred
path is the normal dogfood flow:

```bash
npx --yes -p agentxchain@2.151.0 -c 'agentxchain run --continuous --vision .planning/VISION.md --max-runs 10 --max-idle-cycles 3 --poll-seconds 5 --triage-approval auto --auto-checkpoint --no-report'
```

If `tusq.dev` has no derivable work, use the installed-package diagnostic as a
timing boundary check for the effective runtime instead:

```bash
REPRO="$(npm root)/agentxchain/scripts/reproduce-bug-54.mjs"
[ -f "$REPRO" ] || REPRO="$(npm root -g)/agentxchain/scripts/reproduce-bug-54.mjs"
node "$REPRO" --attempts 10 --watchdog-ms 180000 --out /tmp/bug54-v2-151-0.json
jq '{command_probe, summary}' /tmp/bug54-v2-151-0.json
jq '.attempts[] | {attempt, classification, first_stdout_ms, first_stderr_ms, watchdog_fired, exit_signal, stdout_bytes_total, stderr_bytes_total}' /tmp/bug54-v2-151-0.json
```

Quote these BUG-54 fields from the real run or diagnostic:

- runtime id and command (`local-pm`, `local-dev`, `local-qa`, or the project
  equivalent)
- ten attempted dispatches or ten diagnostic attempts
- per-attempt `first_stdout_ms`
- every adapter diagnostic line containing `spawn_attached` or `first_output`
- confirmation that no adapter diagnostic line contains
  `startup_watchdog_fired`
- confirmation that no state/history event reports `stdout_attach_failed` or
  `ghost_turn`

Useful searches:

```bash
grep -RInE 'spawn_attached|first_output|startup_watchdog_fired|stdout_attach_failed|ghost_turn' .agentxchain 2>/dev/null || true
```

BUG-54 closure requires ten consecutive real dispatches with no
`startup_watchdog_fired`, `stdout_attach_failed`, or `ghost_turn` events at the
default v2.151.0 watchdog. If only the diagnostic path is possible, it is strong
supporting evidence but not full closure unless the tester confirms the normal
dogfood flow had no work to dispatch.

## Paste Target

Paste the output blocks into `.planning/AGENT-TALK.md` or the beta bug thread
under these headings:

- `agentxchain@2.151.0 version`
- `BUG-59 positive state`
- `BUG-59 approval_policy ledger rows`
- `BUG-59 credentialed negative`
- `BUG-54 ten-dispatch watchdog evidence`

Do not paste secrets. Auth environment booleans and command names are enough.
