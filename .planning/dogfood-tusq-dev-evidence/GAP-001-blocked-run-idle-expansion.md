# GAP-001 — Continuous Perpetual Queues Idle Expansion Before Blocked-Run Eligibility

Date: 2026-04-24

## Trigger

First tusq.dev dogfood run from the clean `agentxchain-dogfood-2026-04` branch using shipped `agentxchain@2.155.1`.

Command:

```bash
npx --yes -p agentxchain@latest -c 'agentxchain run --continuous --vision .planning/VISION.md --max-runs 5 --max-idle-cycles 3 --poll-seconds 5 --triage-approval auto --auto-checkpoint --on-idle perpetual'
```

## Observed Behavior

The continuous loop exhausted three normal idle cycles, dispatched a BUG-60 idle-expansion PM intent, then failed when trying to start that intent because the inherited governed run was already blocked on a human-required `planning_signoff` gate.

Raw CLI excerpt:

```text
Idle cycle 1/3 — no derivable work from vision.
Idle cycle 2/3 — no derivable work from vision.
Idle cycle 3/3 — no derivable work from vision.
Idle-expansion 1/5 dispatched — PM intent intent_1777034815829_43d8 queued.
Found queued intent: intent_1777034815829_43d8 (approved)
Continuous start error: start failed: cannot start: run is blocked (...)
Continuous loop failed: start failed: cannot start: run is blocked (...). Check "agentxchain status" for details.
```

At failure:

- `.agentxchain/continuous-session.json` had `status: "failed"`, `runs_completed: 0`, `expansion_iteration: 1`.
- `.agentxchain/state.json` was `status: "blocked"` with `blocked_on: "human:planning_signoff ..."` from the inherited run.
- The dogfood branch gained a new idle-expansion event and intent even though the run was ineligible to start.
- `agentxchain status` also reported operator-commit drift from the checkpoint baseline: `22e4cbe5 -> a6a388e1`, with recommended `agentxchain reconcile-state --accept-operator-head`.

## Evidence Files

- `raw/cli-2026-04-24-continuous-perpetual.log`
- `raw/events-2026-04-24-after-block.jsonl`
- `raw/state-2026-04-24-after-block.json`
- `raw/continuous-session-2026-04-24-after-block.json`
- `raw/status-2026-04-24-after-block.txt`
- `raw/status-2026-04-24-after-block.json`

## Initial Hypothesis

`run --continuous --on-idle perpetual` does the BUG-60 idle-expansion path before proving the current governed run is eligible to accept a queued/startable intent. That ordering creates new intake state in a branch that is already blocked by a human gate and possibly stale relative to checkpoint baseline.

The immediate product gap is not "auto-approve every human gate." The sharper defect is ordering and operator guidance:

1. A continuous full-auto session should detect an inherited blocked run before dispatching idle expansion.
2. It should not queue a new idle-expansion intent when `intake start` cannot legally run.
3. It should emit a typed terminal/pause reason that preserves the existing blocker and tells the operator/agent the first recoverable CLI action, e.g. reconcile checkpoint drift before retrying or resolve the human gate.

## Minimal Reproduction

The full reproduction currently depends on the tusq.dev baseline state. A smaller fixture should be possible:

1. Create a governed project with a human-required planning gate.
2. Put state in `blocked` with no active turn and a pending human gate.
3. Run `agentxchain run --continuous --on-idle perpetual --max-idle-cycles 1 --triage-approval auto`.
4. Assert no `idle_expansion_dispatched` event or new intake intent is created before the blocked-run eligibility failure is surfaced.

## Linked BUG

Filed as BUG-63 in `.planning/HUMAN-ROADMAP.md`.

## Closure

Closed on 2026-04-24 in `agentxchain@2.155.2`.

Shipped fix:

- release commit `2538a26e` / tag `v2.155.2`
- publish workflow `24891238388` succeeded
- post-publish verification passed with `7015 tests / 7010 pass / 0 fail / 5 skipped`

Dogfood retry evidence on shipped `agentxchain@latest` (`2.155.2`):

- raw CLI: `raw/cli-2026-04-24-bug63-retry-v2.155.2.log`
- intent count: `38 -> 38`
- no new `idle_expansion_dispatched` event after the retry
- continuous session: `status: "paused"`, `runs_completed: 0`, `expansion_iteration: 0`

The retry preserved the original `planning_signoff` blocker and surfaced a typed
pause instead of mutating idle-expansion intake state.
