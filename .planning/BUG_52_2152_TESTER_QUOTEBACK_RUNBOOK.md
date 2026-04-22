# BUG-52 Third Variant — v2.152.0 Tester Quote-Back Runbook

**Target:** `agentxchain@2.152.0` (shipped in release commit `96ac83d1`, npm publish workflow `24755033581`, Homebrew tap `shivamtiwari93/homebrew-tap` sha256 `5339c378ee21849454d6125587ab3aba4b86d3e4ccf044f20946b7e5f6a3faf9`).

**Context:** HUMAN-ROADMAP BUG-52 third variant remains *unchecked* until the real `tusq.dev` operator reproduces the standing-gate `unblock` path against the shipped package and quotes back the required fields below. Synthetic command-chain proof (`cli/test/beta-tester-scenarios/bug-52-gate-unblock-phase-advance.test.js` Turn 176 positive + Turn 177 negative) is agent-side evidence, not closure.

---

## Preflight (shipped-package identity)

Run from a clean shell on the operator machine (**not** from the repo checkout):

```bash
npm uninstall -g agentxchain 2>/dev/null || true
npx --yes -p agentxchain@2.152.0 -c "agentxchain --version"
# Expected: 2.152.0
```

Quote the `2.152.0` output exactly. Any other number means a stale install is shadowing the registry; resolve before proceeding.

---

## Positive reproduction (the critical path)

Use the same `tusq.dev` project that reproduced the loop seven times on v2.151.0. Skip steps 1-2 if the project already has a standing `planning_signoff: pending` gate with `pending_phase_transition: null` from a prior session.

1. **Drive a real PM turn to `needs_human`** — use the project's normal PM flow. Required artifacts (`.planning/PM_SIGNOFF.md`, `.planning/ROADMAP.md`, any project-specific files named by `gates.planning_signoff.requires_files`) must be present on disk.
2. **Accept + checkpoint the PM turn**:
   ```bash
   agentxchain accept-turn
   agentxchain checkpoint-turn --turn <pm_turn_id>
   ```
3. **Confirm the pre-unblock state matches the loop shape**:
   ```bash
   agentxchain status --json | jq '.state | {phase, status, phase_gate_status, pending_phase_transition, active_turns: (.active_turns // {} | keys)}'
   ```
   Quote-back must show:
   - `phase: "planning"`
   - `status: "blocked"` (or `"paused"`)
   - `phase_gate_status.planning_signoff: "pending"`
   - `pending_phase_transition: null`
   - `active_turns` contains the retained PM turn id
4. **Resolve the escalation**:
   ```bash
   HESC=$(jq -r 'select(.kind == "raised") | .escalation_id' .agentxchain/human-escalations.jsonl | tail -1)
   agentxchain unblock "$HESC"
   ```
5. **Immediately quote `agentxchain status --json`**. Required fields:
   - `phase: "implementation"` ← phase advanced
   - `phase_gate_status.planning_signoff: "passed"` ← gate closed
   - `active_turns` contains exactly **one** entry whose `assigned_role` is `dev` (the implementation entry role) and is NOT the prior PM turn id
   - `budget_reservations` does NOT contain the prior PM turn id
   - `status: "active"` (or `"dispatched"` if a role is being assigned)
6. **Quote the durable events**:
   ```bash
   jq -c 'select(.event_type == "phase_entered" or .event_type == "phase_cleanup") | {event_type, from: .payload.from, to: .payload.to, trigger: .payload.trigger, from_phase: .payload.from_phase, removed_turn_ids: .payload.removed_turn_ids, gate_id: .payload.gate_id}' .agentxchain/events.jsonl | tail -10
   ```
   Quote-back must include:
   - A `phase_entered` event with `from: "planning"`, `to: "implementation"`, `trigger: "reconciled_before_dispatch"` (or `"auto_approved"` if the project has an approval_policy auto-approve rule matching)
   - A `phase_cleanup` event with `from_phase: "planning"` whose `removed_turn_ids` array includes the prior PM turn id

**Closure requires all of steps 3-6 quoted from the same session, timestamped after `2.152.0` is the installed version.**

---

## Negative counter-case (evidence-gated, not rubber-stamped)

This proves the fix is not an "always advance" shortcut. Run this in a scratch project to avoid disturbing `tusq.dev` state:

```bash
mkdir -p /tmp/axc-bug52-neg && cd /tmp/axc-bug52-neg && git init -q
npx --yes -p agentxchain@2.152.0 agentxchain init
# Drive a PM turn to needs_human, but delete .planning/PM_SIGNOFF.md before unblock:
rm -f .planning/PM_SIGNOFF.md
HESC=$(jq -r 'select(.kind == "raised") | .escalation_id' .agentxchain/human-escalations.jsonl | tail -1)
agentxchain unblock "$HESC"
echo "exit: $?"
agentxchain status --json | jq '.state | {phase, status, planning_signoff: .phase_gate_status.planning_signoff}'
```

Quote-back must show:
- `exit: 1` (non-zero)
- Message from `unblock` output containing "did not materialize" / "no phase transition could be materialized" / "unblock_reconcile_failed" (any of the three)
- `phase: "planning"` (unchanged)
- `status: "blocked"`
- `planning_signoff: "pending"` (unchanged)

---

## Required quote-back fields for closure

Paste into the tester report **in this order**:

1. **Package identity:** `npx --yes -p agentxchain@2.152.0 -c "agentxchain --version"` output → must say `2.152.0`.
2. **Pre-unblock state summary** (step 3 above) → full JSON of the five fields.
3. **Unblock command output** (step 4) → full stdout/stderr, must exit 0.
4. **Post-unblock state summary** (step 5) → full JSON of the five fields, proving phase/gate/role/no-stale-turn invariants.
5. **Durable events** (step 6) → both `phase_entered` and `phase_cleanup` JSONL rows quoted literally.
6. **Negative counter-case** (scratch project above) → `exit: 1` + message + preserved state JSON.

All six fields must come from **the same shipped `2.152.0` install**. Partial quote-back (e.g., only positive path) is not closure.

---

## What an agent MUST reject on quote-back review

- Version is not `2.152.0` (any earlier version was buggy in this exact path).
- `phase_entered.trigger` is absent or empty — the Turn 176 fix writes `reconciled_before_dispatch` or `auto_approved`; missing `trigger` means the turn came from a different path.
- `phase_cleanup.removed_turn_ids` does not include the prior PM turn id — cleanup is the Turn 176 contract, not optional.
- Negative counter-case returns `exit: 0` — that would mean the gate is being papered over, which violates `DEC-BUG52-UNBLOCK-ADVANCES-PHASE-001` (the fix must be evidence-gated).
- Any field is paraphrased rather than quoted — Rule #12 applies; command-chain evidence must be literal.

---

## After closure

Only after all six fields land in a tester report against v2.152.0 should an agent:

1. Flip `HUMAN-ROADMAP` BUG-52 to `- [x]` with completion date, commit sha, and tester-session pointer.
2. Update the top-of-file current focus to shift to the next roadmap blocker (per current queue: BUG-60 waits on BUG-59 quote-back; BUG-61/62 stand alone).
3. Record `DEC-BUG52-THIRD-VARIANT-TESTER-CLOSURE-001` in `.planning/DECISIONS.md` preserving the closure evidence pointer.

Do NOT close BUG-52 on agent-side test evidence alone. The Rule #12 precedent from the v2.147.0 false closure specifically prohibits this.
