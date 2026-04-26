# BUG-76 Re-verify Evidence — agentxchain@2.155.30

## Summary

BUG-76 (continuous vision mode exits idle/completed even when ROADMAP.md contains unchecked milestones) is **CONFIRMED WORKING** on the dogfood session `cont-dadd9a11` using shipped `agentxchain@2.155.30`.

## Evidence

### 1. Continuous loop correctly derived M28 from unchecked ROADMAP.md

After Run 1 completed (3 turns: dev, qa, product_marketing), the continuous loop:
1. Detected the governed run was complete
2. Scanned `.planning/ROADMAP.md` for unchecked milestones
3. Found M28: "Static Sensitivity Class Inference from Manifest Evidence (~0.5 day)"
4. Derived a roadmap-based intake intent and dispatched a new governed run

**Dogfood output confirming roadmap derivation:**
```
Roadmap-derived: M28: Static Sensitivity Class Inference from Manifest Evidence (~0.5 day):
Add `classifySensitivity(capability)` pure deterministic function in `src/cli.js`
implementing the frozen six-rule first-match-wins decision table:
R1 preserve→restricted, R2 admin/destructive verb or admin-namespaced route→restricted,
R3 pii_categories non-empty→confidential, R4 write verb + financial-context route/param→confidential,
R5 auth_required or narrow write→internal, R6 default→public
```

### 2. Session did NOT idle/complete with open roadmap

The original BUG-76 failure was:
- `runs_completed: 0`, `status: "completed"`, no objective, no pending intents, no next actions
- Even though ROADMAP.md had unchecked M28/M29

After the fix:
- Run 1 completed with real work (3 turns accepted)
- Continuous loop immediately started Run 2 targeting M28
- Session did NOT exit idle — it continued driving roadmap work

### 3. Specific closure criteria verification

| Criterion | Status |
|-----------|--------|
| ROADMAP.md with unchecked M28 → does NOT exit completed/idle | **PASS** — Run 2 started |
| Session dispatches/queues turn for M28 | **PASS** — PM turn dispatched |
| `runs_completed: 0` not presented as success with open roadmap | **PASS** — Run 1 completed with 3 real turns |
| Non-empty objective when unchecked roadmap work exists | **PASS** — M28 became the objective |

## Caveat

BUG-76 reverification is based on observed continuous-loop behavior during Run 1 → Run 2 transition. The Run 2 PM turn subsequently failed due to BUG-80 (intent coverage), which is a different defect class (acceptance contract evaluation, not idle detection). The roadmap-open-work detection that BUG-76 covers is confirmed working.

## Package Version

```
agentxchain@2.155.30
```

## Date

2026-04-26T05:16:00Z
