# GAP-002 — Existing BUG-62 Reconcile Refuses Real tusq.dev Governed-State Drift

Date: 2026-04-24

## Trigger

After BUG-63 was fixed and shipped in `agentxchain@2.155.2`, the same tusq.dev
dogfood command no longer enqueued idle-expansion work into the blocked run.
It paused correctly and preserved the original blocker.

The next status action was:

```text
agentxchain reconcile-state --accept-operator-head
```

## Observed Behavior

Running the recommended command on the dogfood branch refused:

```text
Reconcile refused (governance_state_modified).
Commit a6a388e1 modifies governed state path .agentxchain/SESSION_RECOVERY.md; reconcile cannot auto-accept .agentxchain edits.
Offending path: .agentxchain/SESSION_RECOVERY.md
Offending commit: a6a388e15674efa89d09e4a0e507f14a702540f3
Manual recovery: inspect the commit range, restore governed state artifacts if needed, then restart from an explicit checkpoint.
```

This is the existing BUG-62 class on a real dogfood baseline, not a new bug ID.
The refusal is safety-correct because the commit touched `.agentxchain/`, but it
still blocks the full-auto takeover loop from progressing without an explicit
restart/checkpoint strategy.

## Evidence Files

- `raw/status-2026-04-24-after-bug63-retry.txt`
- `raw/status-2026-04-24-after-bug63-retry.json`
- `raw/cli-2026-04-24-gap002-reconcile-refused-v2.155.2.log`

## Related Dogfood Setup

The branch's `agentxchain.json` initially had no usable `approval_policy`.
Using the shipped CLI, not a hand edit, the dogfood branch was configured for
full-auto gate posture:

```bash
npx --yes -p agentxchain@latest -c 'agentxchain config --set approval_policy.phase_transitions.default auto_approve'
npx --yes -p agentxchain@latest -c 'agentxchain config --set approval_policy.run_completion.action auto_approve'
npx --yes -p agentxchain@latest -c 'agentxchain validate'
```

Validation passed after the config change. Evidence:

- `raw/config-approval-policy-before-gap002.txt`
- `raw/cli-2026-04-24-gap002-config-set-approval-policy.log`

## Linked BUG

Linked to existing BUG-62 in `.planning/HUMAN-ROADMAP.md`.

## Next Decision Needed

Do not duplicate BUG-62. The next agent should decide whether the correct dogfood
recovery is:

1. run an explicit shipped `agentxchain restart`/`run --recover-from` flow from
   the current blocked run, or
2. implement a narrower BUG-62 follow-up so status does not recommend
   `reconcile-state --accept-operator-head` when the commit range contains
   `.agentxchain/` governed-state edits and the only safe path is restart.
