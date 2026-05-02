# PM Signoff — M3: Multi-Model Turn Handoff Quality (Item #1: Context Preservation)

Approved: YES

**Run:** `run_fb3583590a1a4799`
**Phase:** planning
**Turn:** `turn_089b8301e9c618c1`
**Date:** 2026-05-01

## Discovery Checklist
- [x] Target user defined
- [x] Core pain point defined
- [x] Core workflow defined
- [x] MVP scope defined
- [x] Out-of-scope list defined
- [x] Success metric defined

### Target User

AgentXchain operators running multi-model governed runs where different roles bind to different runtimes (e.g., PM on Claude Opus 4.7, Dev on GPT 5.5, QA on Claude Opus 4.6).

### Core Pain Point

When a turn completes and the next role is dispatched to a **different model**, the CONTEXT.md handoff document omits which model produced the prior turn's work. Three specific gaps:

1. **"Last Accepted Turn" section lacks `runtime_id`**: The receiving model sees the prior turn's `role`, `summary`, `decisions`, and `objections` but has **no indication which model/runtime produced them**. When QA (Opus 4.6) receives context from Dev (GPT 5.5), it cannot distinguish GPT-authored work from Claude-authored work.

   - **Evidence:** `dispatch-bundle.js:798-813` renders `turn_id`, `role`, `summary`, decisions, objections — no `runtime_id`. The data IS available in the history entry (`governed-state.js:5171` stores `runtime_id: turnResult.runtime_id`), but `renderContext()` never reads or renders it.

2. **Decision history table lacks model attribution**: The cumulative decision history rendered at `dispatch-bundle.js:1415-1420` shows `| ID | Phase | Role | Statement |` — no Runtime column. When a receiving model reads 50+ decisions, it cannot tell which decisions were made by Claude vs GPT. This degrades cross-model challenge quality because the challenger cannot contextualize decisions by their authoring model's known strengths/weaknesses.

   - **Evidence:** `dispatch-bundle.js:1415` renders `| ID | Phase | Role | Statement |`. The decision ledger entries at `governed-state.js:5236-5248` store `id`, `turn_id`, `role`, `phase`, `category`, `statement`, `rationale` — but **no `runtime_id`**. The data is available at write time (`turnResult.runtime_id`) but not persisted.

3. **Decision ledger does not persist `runtime_id`**: Even if we added a Runtime column to the CONTEXT.md table, the underlying data doesn't exist in the ledger. The fix requires both persistence (write `runtime_id` to ledger entries) and rendering (display it in CONTEXT.md).

### Core Workflow

1. PM diagnoses context handoff gaps, scopes dev charter (this turn)
2. Dev adds `runtime_id` to decision ledger entries, renders it in CONTEXT.md "Last Accepted Turn" and decision history table, adds regression tests
3. QA verifies handoff context is complete across cross-model scenarios

### MVP Scope (this run)

- **PM (this turn):** Root-cause the context handoff gaps, scope implementation for dev
- **Dev:** Three code changes + regression tests:
  1. Persist `runtime_id` in decision ledger entries (`governed-state.js:5236`)
  2. Render `runtime_id` in "Last Accepted Turn" section (`dispatch-bundle.js:799`)
  3. Add `Runtime` column to decision history table (`dispatch-bundle.js:1415-1420`)
  4. Regression tests for cross-runtime context rendering
- **QA:** Verify handoff context completeness, run full test suite

### Out of Scope

- M3 item #2 (validate stream-json and --json output format parsing) — separate run
- M3 item #3 (model identity metadata in turn checkpoints) — `runtime_id` already exists in history entries; this run closes the rendering gap, not the storage gap
- M3 item #4 (test cross-model challenge quality) — requires longitudinal assessment across governed runs
- M3 item #5 (acceptance criterion: 3 consecutive PM->Dev->QA cycles) — longitudinal
- Changes to AGENT-TALK.md format or TALK.md rendering
- Changes to the turn-result.json schema (it already includes `runtime_id`)
- AGENT-TALK guard failures (3/8, pre-existing across 8+ consecutive QA runs)

### Success Metric

1. Decision ledger entries include `runtime_id` field — `governed-state.js:5236` adds `runtime_id: turnResult.runtime_id` to each decision entry
2. CONTEXT.md "Last Accepted Turn" section includes `- **Runtime:** {runtime_id}` line — `dispatch-bundle.js` adds render after line 799
3. Decision history table includes `Runtime` column — `dispatch-bundle.js:1415` becomes `| ID | Phase | Role | Runtime | Statement |`
4. Regression test: `renderContext()` with a history entry from `local-gpt-5.5` renders the runtime_id in both the last turn section and decision history
5. Regression test: `renderDecisionHistory()` renders Runtime column from ledger entries with `runtime_id`
6. All existing tests continue to pass

## Challenge to Previous Work

### OBJ-PM-001: M3 was triggered as a fresh milestone despite M1/M2 infrastructure providing partial handoff support (severity: low)

The prior M2 runs (8 consecutive cycles) built substantial infrastructure for the vision scanner, tracking annotations, and three-state detection. However, none of these runs addressed the fundamental handoff quality gap: **CONTEXT.md does not tell the receiving model which model produced the prior turn's work**. This means 8 runs of PM->Dev->QA cycles have been executing without cross-model attribution in the handoff context.

This isn't a failure of prior work — M1/M2 were correctly scoped to ghost-turn elimination and vision derivation. But it does mean the multi-model handoff has been operating with an information deficit since the first cross-model run.

### OBJ-PM-002: The decision ledger schema gap compounds over time (severity: medium)

Every accepted turn since the first governed run has written decisions to the ledger **without `runtime_id`**. The current ledger contains 63+ decisions with no model attribution. After dev adds `runtime_id` to new entries, the historical entries will still lack it. This is acceptable for now (the rendering code should handle `d.runtime_id || ''` gracefully), but it means the decision history table will show blank Runtime cells for all pre-M3 decisions.

This is a conscious trade-off: backfilling historical ledger entries would require parsing history.jsonl to correlate turn_ids with runtime_ids and rewriting the ledger — complex, risky, and low-value since the historical decisions are already understood.

## Notes for Dev

Your charter is **model identity attribution in CONTEXT.md handoffs**: persist `runtime_id` in the decision ledger, and render it in two CONTEXT.md sections.

### 1. Persist `runtime_id` in decision ledger entries

In `cli/src/lib/governed-state.js`, at the decision ledger entry construction (approximately line 5236):

```javascript
// Current:
ledgerEntries.push({
  id: decision.id,
  turn_id: turnResult.turn_id,
  role: turnResult.role,
  phase: state.phase,
  category: decision.category,
  statement: decision.statement,
  rationale: decision.rationale,
  objections_against: [],
  status: 'accepted',
  overridden_by: null,
  created_at: now,
});

// Updated — add runtime_id:
ledgerEntries.push({
  id: decision.id,
  turn_id: turnResult.turn_id,
  role: turnResult.role,
  runtime_id: turnResult.runtime_id,
  phase: state.phase,
  category: decision.category,
  statement: decision.statement,
  rationale: decision.rationale,
  objections_against: [],
  status: 'accepted',
  overridden_by: null,
  created_at: now,
});
```

### 2. Render `runtime_id` in "Last Accepted Turn"

In `cli/src/lib/dispatch-bundle.js`, `renderContext()` at approximately line 799, after the Role line:

```javascript
// Current:
lines.push(`- **Role:** ${lastTurn.role}`);
lines.push(`- **Summary:** ${lastTurn.summary}`);

// Updated:
lines.push(`- **Role:** ${lastTurn.role}`);
if (lastTurn.runtime_id) {
  lines.push(`- **Runtime:** ${lastTurn.runtime_id}`);
}
lines.push(`- **Summary:** ${lastTurn.summary}`);
```

### 3. Add `Runtime` column to decision history table

In `cli/src/lib/dispatch-bundle.js`, `renderDecisionHistory()` at approximately line 1415:

```javascript
// Current:
lines.push('| ID | Phase | Role | Statement |');
lines.push('|----|-------|------|-----------|');
for (const d of displayed) {
  const stmt = (d.statement || '').replace(/\|/g, '\\|').replace(/\n/g, ' ');
  lines.push(`| ${d.id} | ${d.phase || ''} | ${d.role || ''} | ${stmt} |`);
}

// Updated:
lines.push('| ID | Phase | Role | Runtime | Statement |');
lines.push('|----|-------|------|---------|-----------|');
for (const d of displayed) {
  const stmt = (d.statement || '').replace(/\|/g, '\\|').replace(/\n/g, ' ');
  lines.push(`| ${d.id} | ${d.phase || ''} | ${d.role || ''} | ${d.runtime_id || ''} | ${stmt} |`);
}
```

### 4. Regression tests

Add tests in the appropriate test files (likely `dispatch-bundle.test.js` or a new `context-handoff.test.js`):

**Test A: renderContext includes runtime_id in Last Accepted Turn**
- Fixture: state with `last_completed_turn_id`, history entry with `runtime_id: 'local-gpt-5.5'`
- Assert: rendered CONTEXT.md contains `- **Runtime:** local-gpt-5.5`

**Test B: renderDecisionHistory includes Runtime column**
- Fixture: decision ledger with entries containing `runtime_id: 'local-gpt-5.5'` and entries without `runtime_id` (pre-M3 legacy)
- Assert: table header includes `| Runtime |`
- Assert: entries with runtime_id show it; entries without show empty

**Test C: Cross-runtime handoff scenario**
- Fixture: history entry from `local-gpt-5.5` (Dev), decision ledger with mixed runtime_ids
- Assert: both sections render correctly when the receiving runtime is `local-opus-4.6`

### 5. Check off M3 item #1

In `.planning/ROADMAP.md` line 39, change:
```
- [ ] Ensure Claude-to-GPT and GPT-to-Claude handoffs preserve full context via CONTEXT.md
```
to:
```
- [x] Ensure Claude-to-GPT and GPT-to-Claude handoffs preserve full context via CONTEXT.md
```

## Notes for QA

- Verify `runtime_id` appears in CONTEXT.md "Last Accepted Turn" when the history entry has one
- Verify the decision history table has a Runtime column
- Verify legacy ledger entries (without `runtime_id`) render gracefully with an empty Runtime cell
- Verify the `runtime_id` persisted in new ledger entries matches `turnResult.runtime_id`
- Run the full test suite — confirm no regressions
- Check that existing CONTEXT.md snapshot tests (if any) are updated to reflect the new fields

## Acceptance Contract Response

1. **Roadmap milestone addressed: M3: Multi-Model Turn Handoff Quality** — YES. This run addresses the first M3 item: ensuring cross-model handoffs preserve full context by adding model identity attribution to CONTEXT.md.

2. **Unchecked roadmap item completed: Ensure Claude-to-GPT and GPT-to-Claude handoffs preserve full context via CONTEXT.md** — YES (after dev implements). Three gaps identified and scoped: (a) decision ledger missing `runtime_id`, (b) "Last Accepted Turn" missing runtime, (c) decision history table missing Runtime column. Dev charter is bounded to these three code changes + regression tests.

3. **Evidence source: .planning/ROADMAP.md:39** — Line 39 will be checked off by dev after implementation. Evidence: `runtime_id` rendered in CONTEXT.md "Last Accepted Turn" section and decision history table.
