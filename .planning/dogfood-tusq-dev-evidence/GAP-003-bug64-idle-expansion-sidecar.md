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

Filed as BUG-64 in `.planning/HUMAN-ROADMAP.md`.

## Local Fix Direction

The acceptor should load and normalize a sibling `idle-expansion-result.json`
when all of these are true:

- the active turn is a `vision_idle_expansion` turn;
- `turn-result.json` does not already contain `idle_expansion_result`;
- the sibling sidecar exists beside the staged turn result.

The normalized result must still pass the canonical
`validateIdleExpansionTurnResult()` contract. A malformed or missing sidecar
must continue to fail validation.
