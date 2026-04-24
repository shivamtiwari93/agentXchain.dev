# BUG-62 Shipped-Package Proof — 2026-04-24

Purpose: close BUG-62 with a scratch shipped-package command-chain proof after the dogfood lane proved the real tusq.dev blocker and the repo shipped the reconcile-safe-path fix.

Target package: `agentxchain@2.155.10`

Fixture: `/tmp/axc-bug62-gpt55`

## Setup

```text
npx --yes -p agentxchain@2.155.10 agentxchain init --governed --template generic --yes
git add -A && git commit -q -m "scaffold"
npx --yes -p agentxchain@2.155.10 agentxchain step --role pm --poll 1
```

The first staged baseline result needed two protocol-correct fixes before acceptance:

- decision id changed to `DEC-001` and category changed to `process`
- one PM objection added to satisfy challenge-required protocol rules

That is a test-fixture correction, not a reconcile behavior bypass. The accepted turn was still a real shipped-package governed turn.

## Baseline Turn

```text
Turn Accepted
Turn:     turn_489724b380e54308
Role:     pm
Status:   completed
Summary:  BUG-62 baseline turn accepted to establish a real session checkpoint.
Accepted: git:0b6befcea38295e5a4288f53f9e2b8bfe4a8418d
Cost:     $0.00

baseline: 0b6befcea38295e5a4288f53f9e2b8bfe4a8418d
```

## Block 1 — Positive Safe Operator Commit

```text
head_after: 4d87db76acbad46ab334d83edb30708e4ed60cd7
before_drift:   Drift:    Git HEAD has moved since checkpoint: 0b6befce -> 4d87db76
Reconciled 1 operator commit(s).
Previous baseline: 0b6befcea38295e5a4288f53f9e2b8bfe4a8418d
Accepted HEAD:      4d87db76acbad46ab334d83edb30708e4ed60cd7
Paths touched:      NOTES.md
positive_exit: 0
{"event_type":"state_reconciled_operator_commits","payload":{"previous_baseline":"0b6befcea38295e5a4288f53f9e2b8bfe4a8418d","accepted_head":"4d87db76acbad46ab334d83edb30708e4ed60cd7","accepted_commits":1,"paths_touched":["NOTES.md"]}}
after_drift:   Drift:    none detected since checkpoint
```

## Block 2 — Negative Governed-State Edit

```text
Reconcile refused (governance_state_modified).
Commit 6454b493 modifies governed state path .agentxchain/state.json; reconcile cannot auto-accept .agentxchain edits.
Offending path: .agentxchain/state.json
Offending commit: 6454b493bc83b315963d5c7b1b1e0e9b16640619
Manual recovery: inspect the commit range, restore governed state artifacts if needed, then restart from an explicit checkpoint.
unsafe_exit: 1
```

## Block 3 — Negative History Rewrite

```text
Reconcile refused (history_rewrite).
Cannot reconcile operator HEAD: baseline 4d87db76 is not an ancestor of current HEAD 94b540b4.
Manual recovery: inspect the commit range, restore governed state artifacts if needed, then restart from an explicit checkpoint.
rewrite_exit: 1
```

## Closure

```text
BUG62_SHIPPED_PACKAGE_PROOF_PASS target=2.155.10 base=0b6befcea38295e5a4288f53f9e2b8bfe4a8418d head_after=4d87db76acbad46ab334d83edb30708e4ed60cd7
```

BUG-62 is closed by shipped-package evidence:

- safe fast-forward operator commits reconcile and clear drift
- success emits `state_reconciled_operator_commits`
- governed-state edits remain fail-closed
- history rewrites remain fail-closed
