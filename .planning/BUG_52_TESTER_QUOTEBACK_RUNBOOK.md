# BUG-52 Third Variant — Tester Quote-Back Runbook

**Target version:** `agentxchain@2.154.7` or later. The full third-variant fix is the Turn 176 reconcile path, plus the Turn 203 `activeCount=0` extension, plus the Turn 204 standing-gate discriminator, plus the Turn 205 realistic `needs_human + proposed_next_role: "human"` artifact-contribution predicate, plus the Turn 206 verification-gated standing-source safety. Earlier published versions are incomplete:

| Version | Ships | Reproduces tester loop? |
|---------|------|-------------------------|
| `2.152.0` | Turn 176 only | Yes — realistic PM shape still loops |
| `2.154.5` | + Turn 203 + Turn 204 | Yes — realistic `needs_human + proposed_next_role: "human"` still loops |
| `2.154.7`+ | + Turn 205 + Turn 206 | **No — fix complete for realistic shape** |

Closure requires quote-back against `agentxchain@2.154.7` or a later patch that bundles the same fix set. Synthetic command-chain proof (`cli/test/beta-tester-scenarios/bug-52-gate-unblock-phase-advance.test.js` Turns 176, 177, 203, 204, 205, 206) is agent-side evidence, not closure.

---

## Preflight (shipped-package identity)

Run from a clean shell on the operator machine (**not** from the agentxchain repo checkout):

```bash
npm uninstall -g agentxchain 2>/dev/null || true
npx --yes -p agentxchain@2.154.7 -c "agentxchain --version"
# Expected: 2.154.7 (or later patch)
```

Quote the version output exactly. Any version lower than `2.154.7` means the realistic-PM-shape fix is not in the install; resolve before proceeding.

---

## Required reproduction shape

The reproducer must exercise the **Turn 205 realistic PM handoff**:

- PM turn result declares `status: "needs_human"`
- PM turn result declares `proposed_next_role: "human"`
- PM turn result declares `phase_transition_request: null`
- PM turn result declares `files_changed` including every path in `gates.planning_signoff.requires_files` (default scaffold: `.planning/PM_SIGNOFF.md`, `.planning/ROADMAP.md`, `.planning/SYSTEM_SPEC.md`)
- Those files exist on disk and have non-placeholder content
- Run state when the PM turn is accepted + checkpointed:
  - `phase: "planning"`
  - `phase_gate_status.planning_signoff: "pending"`
  - `pending_phase_transition: null`

Any shape that differs on those five points is not the third variant and does not close BUG-52. In particular: a PM result with `phase_transition_request: "implementation"` exercises the Turn 176 path, not the Turn 205 path — that scenario already passed on `v2.152.0` and is not the live defect.

---

## Positive reproduction (the critical path)

Use the same `tusq.dev` project (or a successor real project) where the v2.151.0 / v2.154.5 loops reproduced. The state should already have a standing `planning_signoff: pending` gate with `pending_phase_transition: null` from the last stuck session; if not, drive a fresh PM turn through the project's normal PM flow until the run lands in that shape.

1. **Confirm the pre-unblock state matches the realistic third-variant shape:**
   ```bash
   agentxchain status --json | jq '.state | {phase, status, phase_gate_status, pending_phase_transition, active_turns: (.active_turns // {} | keys), last_completed_turn: (.last_completed_turn // {} | {turn_id, role, status, proposed_next_role, phase_transition_request})}'
   ```
   Quote-back must show:
   - `phase: "planning"`
   - `status: "blocked"` (or `"paused"`)
   - `phase_gate_status.planning_signoff: "pending"`
   - `pending_phase_transition: null`
   - `last_completed_turn.status: "needs_human"`
   - `last_completed_turn.proposed_next_role: "human"`
   - `last_completed_turn.phase_transition_request: null`

2. **Resolve the human escalation:**
   ```bash
   HESC=$(jq -r 'select(.kind == "raised") | .escalation_id' .agentxchain/human-escalations.jsonl | tail -1)
   echo "Resolving: $HESC"
   agentxchain unblock "$HESC"
   ```
   Quote the full stdout + stderr and the exit code. Expected: exit `0`, output acknowledges the escalation and the phase advance.

3. **Quote the post-unblock state immediately (no restart, no step in between):**
   ```bash
   agentxchain status --json | jq '.state | {phase, status, phase_gate_status, pending_phase_transition, active_turns: (.active_turns // {} | to_entries | map({turn_id: .key, role: .value.assigned_role}))}'
   ```
   Quote-back must show:
   - `phase: "implementation"` ← phase advanced
   - `phase_gate_status.planning_signoff: "passed"` ← gate closed
   - `active_turns` contains exactly **one** entry whose `role` is `dev` and whose `turn_id` is NOT the prior PM turn id
   - `pending_phase_transition: null`
   - `status: "active"` (or `"dispatched"`)

4. **Quote the durable events:**
   ```bash
   jq -c 'select(.event_type == "phase_entered" or .event_type == "phase_cleanup" or .event_type == "gate_passed") | {event_type, from: .payload.from, to: .payload.to, trigger: .payload.trigger, from_phase: .payload.from_phase, removed_turn_ids: .payload.removed_turn_ids, gate_id: .payload.gate_id}' .agentxchain/events.jsonl | tail -10
   ```
   Quote-back must include:
   - A `phase_entered` event with `from: "planning"`, `to: "implementation"`, `trigger: "reconciled_before_dispatch"` (or `"auto_approved"` if the project has an `approval_policy` auto-approve rule matching — Turn 59 lane)
   - A `phase_cleanup` event with `from_phase: "planning"` whose `removed_turn_ids` array includes the prior PM turn id
   - A `gate_passed` event for `gate_id: "planning_signoff"`

5. **No ghost turn appears.** Assert no `ghost_turn` or `stdout_attach_failed` event between `unblock` (step 2) and the next role assignment. Quote:
   ```bash
   jq -c 'select(.event_type == "ghost_turn" or .event_type == "stdout_attach_failed") | {event_type, turn_id: .turn.turn_id, ts: .timestamp}' .agentxchain/events.jsonl | tail -5
   ```
   Expected: no output, or only events with timestamps earlier than the `unblock` call.

**Closure requires all of steps 1–5 quoted from the same session on an install where `npx --yes -p agentxchain@<v> -c "agentxchain --version"` returned `2.154.7` or later.**

---

## Negative counter-case — evidence-gated, not rubber-stamped

This proves the fix is not an "always advance" shortcut. Run in a scratch project to avoid disturbing the real project.

Important: do **not** create a valid checkpoint and then delete `.planning/PM_SIGNOFF.md` afterward. That tests dirty-worktree blocking, not gate evidence. The missing evidence must be absent before `accept-turn` / `checkpoint-turn`, and the staged PM result must explicitly point toward continuation (`proposed_next_role: "dev"`) so the standing-gate reconcile path runs and then refuses to materialize the transition.

```bash
mkdir -p /tmp/axc-bug52-neg && cd /tmp/axc-bug52-neg && git init -q
npx --yes -p agentxchain@2.154.7 agentxchain init --governed --template generic --yes
git add -A && git commit -q -m "scaffold"
# Drive a PM turn to needs_human with:
#   proposed_next_role: "dev"
#   phase_transition_request: null
#   files_changed: [".planning/ROADMAP.md", ".planning/SYSTEM_SPEC.md"]
# Keep .planning/PM_SIGNOFF.md absent before accept/checkpoint.
HESC=$(jq -r 'select(.kind == "raised") | .escalation_id' .agentxchain/human-escalations.jsonl | tail -1)
agentxchain unblock "$HESC"; echo "exit: $?"
agentxchain status --json | jq '.state | {phase, status, planning_signoff: .phase_gate_status.planning_signoff}'
```

Quote-back must show:
- `exit: 1` (non-zero)
- Message from `unblock` output containing `did not materialize` / `no phase transition could be materialized` / `unblock_reconcile_failed` (any of the three)
- `phase: "planning"` (unchanged)
- `status: "blocked"`
- `planning_signoff: "pending"` (unchanged)

If a tester deletes `.planning/PM_SIGNOFF.md` after checkpoint, that is an invalid negative-case quote-back unless they also quote a clean `git status --short`. A dirty deletion can fail for baseline cleanliness before it reaches gate materialization. If the valid negative case above returns `exit: 0`, the discriminator has regressed — report it as a new bug, do not close BUG-52.

---

## Turn 206 verification-safety case (optional but recommended)

Turn 206 added a guard: synthetic standing-source phase advance must honor `requires_verification_pass`. If your project's `qa_ship_verdict` gate requires verification, a `needs_human` QA turn with `verification.status: "fail"` must NOT force-advance on `unblock`. Quote:

```bash
# On a run where phase is qa and a QA needs_human turn has verification.status: "fail":
HESC=$(jq -r 'select(.kind == "raised") | .escalation_id' .agentxchain/human-escalations.jsonl | tail -1)
agentxchain unblock "$HESC"; echo "exit: $?"
agentxchain status --json | jq '.state | {phase, status, qa_ship_verdict: .phase_gate_status.qa_ship_verdict}'
```

Expected: exit `1`, `phase: "qa"` unchanged, `qa_ship_verdict: "pending"` (or `"failed"`) unchanged.

Not required for BUG-52 closure, but a green positive case plus a green verification-safety case is the strongest evidence we can collect before BUG-60 unlocks.

---

## Required quote-back fields for closure

Paste into the tester report **in this order**:

1. **Package identity:** `npx --yes -p agentxchain@2.154.7 -c "agentxchain --version"` output → must say `2.154.7` (or later patch).
2. **Pre-unblock state** (step 1) → full JSON.
3. **Unblock command output** (step 2) → full stdout/stderr, must exit 0.
4. **Post-unblock state** (step 3) → full JSON showing phase / gate / role / turn invariants.
5. **Durable events** (step 4) → `phase_entered`, `phase_cleanup`, `gate_passed` rows.
6. **No ghost turns** (step 5) → empty or earlier-than-unblock.
7. **Negative counter-case** (scratch project) → exit 1, preserved state.

All seven fields must come from the **same shipped `2.154.7+` install**. Partial quote-back (e.g., only positive path) is not closure.

---

## What an agent MUST reject on quote-back review

- Version is lower than `2.154.7` — the realistic-PM-shape fix is not in the install.
- Pre-unblock `last_completed_turn.phase_transition_request` is not `null` — the tester ran the Turn 176 path, not the Turn 205 path. Re-run with the realistic PM shape (`phase_transition_request: null`).
- `phase_entered.trigger` is absent or empty — the Turn 176/205 fix writes `reconciled_before_dispatch` or `auto_approved`; missing `trigger` means the turn came from a different path.
- `phase_cleanup.removed_turn_ids` does not include the prior PM turn id — cleanup is the Turn 176 contract, not optional.
- Negative counter-case returns `exit: 0` — that would mean the gate is being papered over, violating `DEC-BUG52-UNBLOCK-ADVANCES-PHASE-001` and `DEC-BUG52-UNBLOCK-STANDING-GATE-DISCRIMINATOR-001`.
- Any field is paraphrased rather than quoted — Rule #12 applies; command-chain evidence must be literal.

---

## After closure

Only after all seven fields land in a tester report against `2.154.7` or later should an agent:

1. Flip `HUMAN-ROADMAP` BUG-52 third variant to `- [x]` with completion date, release commit sha, and tester-session pointer.
2. Update the top-of-file current focus to shift to the next roadmap blocker (per current queue: BUG-60 waits on BUG-59 quote-back as well; BUG-61/62/54/53 all still require their own tester quote-back).
3. Record `DEC-BUG52-THIRD-VARIANT-TESTER-CLOSURE-001` in `.planning/DECISIONS.md` preserving the closure evidence pointer (tester session, quoted fields, install version).

Do NOT close BUG-52 on agent-side test evidence alone. The Rule #12 precedent from the v2.147.0 false closure specifically prohibits this.
