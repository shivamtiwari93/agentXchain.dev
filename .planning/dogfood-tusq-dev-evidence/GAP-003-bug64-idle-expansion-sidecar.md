# GAP-003 — BUG-64 Idle-Expansion Sidecar Is Not Accepted

Date: 2026-04-24

## Trigger

After `agentxchain@2.155.3` closed the BUG-62 safe-path blocker, the tusq.dev
dogfood run was resumed from the clean dogfood worktree:

```bash
cd "/Users/shivamtiwari.highlevel/VS Code/1008apps/tusq.cloud/tusq.dev-agentxchain-dogfood"
npx --yes -p agentxchain@latest -c 'agentxchain run --continuous --vision .planning/VISION.md --max-runs 5 --max-idle-cycles 3 --poll-seconds 5 --triage-approval auto --auto-checkpoint --on-idle perpetual'
```

`agentxchain@latest` resolved to `2.155.3`.

## Observed Behavior

The continuous loop reached the idle threshold, dispatched a PM idle-expansion
intent, and then blocked on schema validation:

```text
Idle cycle 1/3 — no derivable work from vision.
Idle cycle 2/3 — no derivable work from vision.
Idle cycle 3/3 — no derivable work from vision.
Idle-expansion 1/5 dispatched — PM intent intent_1777046032635_2eab queued.
Found queued intent: intent_1777046032635_2eab (approved)

─── Run Summary ───
  Status:  blocked
  Turns:   0
  Gates:   0 approved
  Errors:  1
    acceptTurn(pm): Validation failed at stage schema: idle_expansion_result is required for vision_idle_expansion turns.

Run blocked — continuous loop paused. Recovery action: `agentxchain unblock <id>` was printed, but `blocked_category=schema_validation` made that action insufficient because the turn needed a corrected idle-expansion result contract.
Continuous loop paused on blocker. Recovery action: `agentxchain unblock <id>` was printed, but the blocker was schema validation, not a human approval.
```

`agentxchain status` showed:

```text
Session: cont-7182a188
Status: paused
Run: run_ce89ef5bd4b8cca8
Turn: turn_e614e7a53ef67b3a
Latest event: acceptance_failed at 2026-04-24T15:57:42.883Z
```

## Root-Cause Evidence

The PM turn did produce a structured idle-expansion result, but as a sibling
sidecar artifact instead of top-level JSON inside `turn-result.json`:

```text
.agentxchain/staging/turn_e614e7a53ef67b3a/turn-result.json
.agentxchain/staging/turn_e614e7a53ef67b3a/idle-expansion-result.json
```

The sidecar contains `kind: "new_intake_intent"`, a proposed M28 charter,
priority, acceptance contract, and VISION traceability. The acceptor only looked
at `turnResult.idle_expansion_result`, so it rejected the turn even though the
required structured content existed in the turn's staging directory.

This is a product contract bug: the prompt/artifact conventions and validator
acceptance boundary disagree.

## Linked BUG

Filed as BUG-64 in `.planning/HUMAN-ROADMAP.md`. Closed by shipped
`agentxchain@2.155.6`.

## Fix And Release Trail

- `agentxchain@2.155.4`: `validateStagedTurnResult()` loads and normalizes a
  sibling `idle-expansion-result.json` when a required `vision_idle_expansion`
  turn lacks top-level `idle_expansion_result`.
- `agentxchain@2.155.5`: the idle-expansion result validator tolerates
  `vision_exhausted: false` and `vision_exhausted: null` sentinels under
  `kind: "new_intake_intent"` while preserving strict rejection for truthy
  exhaustion objects on that branch.
- `agentxchain@2.155.6`: intent coverage for idle-expansion turns is
  branch-aware and evaluates the normalized sidecar result, so a selected
  `new_intake_intent` branch satisfies its charter, priority,
  acceptance-contract, and traceability coverage without also requiring the
  non-selected `vision_exhausted` branch.

Release proof for `2.155.6`:

- publish workflow `24904016612` succeeded;
- `npm view agentxchain version --json` returned `"2.155.6"`;
- `npx --yes -p agentxchain@2.155.6 -c 'agentxchain --version'` returned
  `2.155.6`;
- downstream truth passed;
- post-publish verification passed with
  `7022 tests / 1431 suites / 7017 pass / 0 fail / 5 skipped`;
- Homebrew mirror synced;
- release announcements posted to X, LinkedIn, and Reddit.

## Shipped-Package Dogfood Proof

Retried the original blocked tusq.dev turn in the linked dogfood worktree with
shipped `agentxchain@latest` resolving to `2.155.6`:

```bash
cd "/Users/shivamtiwari.highlevel/VS Code/1008apps/tusq.cloud/tusq.dev-agentxchain-dogfood"
npx --yes -p agentxchain@latest -c 'agentxchain --version'
npx --yes -p agentxchain@latest -c 'agentxchain accept-turn --turn turn_e614e7a53ef67b3a'
```

Result:

```text
agentxchain --version -> 2.155.6
Turn Accepted
Turn: turn_e614e7a53ef67b3a
Role: pm
Status: needs_human
Accepted ref: git:cc4ce8bc3e201aec7ac2645ac89574c1288ed609
```

Closure events:

```text
intent_satisfied at 2026-04-24T18:09:41.756Z for intent_1777046032635_2eab
turn_accepted at 2026-04-24T18:09:41.761Z for turn_e614e7a53ef67b3a
human_escalation_raised at 2026-04-24T18:09:41.774Z, type needs_legal
run_blocked at 2026-04-24T18:09:41.775Z, category needs_human
```

The accepted history entry includes:

```json
{
  "idle_expansion_result_summary": {
    "kind": "new_intake_intent",
    "expansion_iteration": 1,
    "new_intent_title": "Sensitivity Class Inference from Static Manifest Evidence",
    "priority": "p1",
    "template": "generic"
  }
}
```

The current run blocker is a real human/legal triage escalation for the newly
proposed M28 work. BUG-64 is closed because the shipped acceptor accepted the
real sidecar-backed PM idle-expansion turn without manual JSON surgery.
