# PM Signoff — Turn-Level Cost Tracking for local_cli Runtimes

Approved: YES

**Run:** `run_9a37a5dc395bc9b8`
**Phase:** planning
**Turn:** `turn_f3f268bc50a840d9`
**Date:** 2026-05-02

## Discovery Checklist
- [x] Target user defined
- [x] Core pain point defined
- [x] Core workflow defined
- [x] MVP scope defined
- [x] Out-of-scope list defined
- [x] Success metric defined

### Target User

AgentXchain operators running governed sessions with `local_cli` runtimes (e.g., `claude --print --output-format stream-json --verbose`). Currently every local_cli turn reports `cost: {input_tokens: 0, output_tokens: 0, usd: 0}` regardless of actual API spend, making budget tracking and governance reports inaccurate.

### Core Pain Point

The `api_proxy` adapter tracks cost accurately (token-level telemetry from API responses), but the `local_cli` adapter — the most common runtime for Claude Code and Codex — reports zero cost because the agent subprocess doesn't know its own API spend. This means:

1. **Budget tracking is broken**: `budget_status.spent_usd` stays at `$0.00` across entire runs that consume real money
2. **Governance reports lack cost data**: `computeCostSummary()` reports `$0.00 across N turns (0 with cost data)` for local_cli-only runs
3. **Budget guards can't enforce limits**: `per_run_max_usd` budget policies never trigger because observed spend is always zero
4. **Operator blind spot**: No visibility into per-turn or per-role cost during active sessions

### Root Cause

The `local_cli` adapter (`cli/src/lib/adapters/local-cli-adapter.js`) spawns a subprocess and captures stdout, but treats stdout as opaque log data. Claude CLI's `--output-format stream-json` emits structured JSON events to stdout that include cost and usage telemetry — specifically `result` events with `cost_usd`, `total_cost_usd`, and `usage: {input_tokens, output_tokens}` — but the adapter doesn't parse these.

Meanwhile, the agent writes its own turn-result.json with `cost: {input_tokens: 0, output_tokens: 0, usd: 0}` because it doesn't have access to API billing data. The acceptance path at `governed-state.js:5303` reads `turnResult.cost?.usd || 0` and gets zero.

### Core Workflow

1. **PM (this turn)** — Charter dev with stream-json cost parser + adapter integration + acceptance-time override
2. **Dev** — Implements the parser module, hooks it into the adapter, extends dispatch-progress with live cost, adds acceptance-time override, writes tests
3. **QA** — Verifies cost parsing against realistic stream-json fixtures, confirms budget tracking reflects parsed cost, validates governance report accuracy

### MVP Scope (this run)

**PM deliverables (this turn):**
1. PM_SIGNOFF.md: Feature planning with dev charter
2. SYSTEM_SPEC.md: Technical specification with module boundaries, data flow, and acceptance tests
3. ROADMAP.md: Phases table updated for cost tracking run

**Dev deliverables:**
1. `cli/src/lib/stream-json-cost-parser.js` — New pure-function module that parses Claude CLI stream-json events and accumulates cost/usage data
2. `local-cli-adapter.js` integration — Hook parser into stdout handler when stream-json mode is detected; return accumulated cost in dispatch result
3. `dispatch-progress.js` extension — Add `cost` field to progress state for live cost visibility
4. `governed-state.js` cost override — When adapter reports non-zero cost and turn result reports zero, use adapter-observed cost at acceptance time
5. `step.js` plumbing — Pass adapter cost data through to acceptance flow
6. Tests — Parser unit tests + adapter integration tests + acceptance override tests

### Out of Scope

- Parsing non-Claude CLIs (Codex, Gemini) — can be added later with the same parser pattern
- Retroactive cost backfill for historical turns
- Cost alerting or budget-exceeded notifications (existing `budget_exceeded_warn` event handles this once cost data flows)
- Extracting `BUNDLED_COST_RATES` to a shared module — import from `api-proxy-adapter.js` (already exported)
- Changes to `computeCostSummary()` or report rendering — these already handle non-zero cost correctly; they just need non-zero input data
- Parsing cost from non-stream-json output (plain text mode)

### Success Metric

Maps directly to the acceptance contract:

| # | Acceptance Item | Verified By |
|---|----------------|-------------|
| 1 | `stream-json-cost-parser.js` correctly extracts `{input_tokens, output_tokens, usd}` from Claude CLI `result` events | Unit tests with realistic fixtures |
| 2 | `local-cli-adapter.js` returns non-zero cost in dispatch result when subprocess emits cost events | Integration test with mock subprocess |
| 3 | `dispatch-progress.json` includes live `cost` field during dispatch | Progress tracker unit test |
| 4 | Accepted turn's `budget_status.spent_usd` reflects adapter-observed cost when agent reports zero | Acceptance flow integration test |
| 5 | Governance report `computeCostSummary()` renders non-zero cost for local_cli turns | Report test with cost-enriched history |

### Risk Assessment

| Risk | Severity | Mitigation |
|------|----------|------------|
| Claude CLI stream-json format changes | Low | Parser validates event shape defensively; unknown events are ignored |
| Non-JSON stdout lines from verbose mode | Low | Parser wraps `JSON.parse` in try/catch; non-JSON lines are skipped |
| Cost override suppresses legitimate agent-reported cost | Low | Override only activates when agent reports zero; non-zero agent cost is always preserved |
| Multi-turn Claude sessions emit multiple result events | Low | Parser accumulates across all events; `total_cost_usd` from final result is preferred when available |
| Performance impact of per-line JSON parsing | Low | Only activated for stream-json runtimes; parsing is O(1) per line |

## Challenge to Previous Work

### OBJ-PM-001: Previous planning artifacts describe a different feature (severity: high)

PM_SIGNOFF.md, SYSTEM_SPEC.md, and ROADMAP.md all describe the v2.155.73 release cut from run `run_ada69e8852f7487d`. This run's intent is "Add turn-level cost tracking for local_cli runtimes (parse stream-json cost events)" from ROADMAP.md:63. All three artifacts have been rewritten from scratch.

## Notes for Dev

**Your charter is a new stream-json cost parser + adapter integration. 6 code changes + tests.**

1. **Create `cli/src/lib/stream-json-cost-parser.js`**: A pure-function module that:
   - Exports `createStreamJsonCostAccumulator()` returning an accumulator object
   - `accumulator.processLine(line)` — parses a single stdout line, extracts cost if present
   - `accumulator.getCost()` — returns `{input_tokens, output_tokens, usd}` or null if no cost data seen
   - Recognizes Claude CLI `result` events: `{"type": "result", ..., "cost_usd": N, "usage": {input_tokens, output_tokens}}`
   - Defensively ignores non-JSON lines and unknown event types
   - Uses `getCostRates` from `api-proxy-adapter.js` as fallback when event has tokens but no USD

2. **Hook parser into `local-cli-adapter.js`**:
   - At dispatch start: detect stream-json mode (reuse existing `usesStreamJson` check at line 765)
   - If stream-json: create accumulator, feed each stdout chunk to `accumulator.processLine()` (split on newlines)
   - On dispatch completion: include `accumulator.getCost()` in the result object as `cost` field

3. **Extend `dispatch-progress.js`**:
   - Add optional `cost` field to progress state
   - Update `onOutput()` or add `onCost()` method to progress tracker
   - Live cost visible in `agentxchain status` during dispatch

4. **Add cost override in `governed-state.js`**:
   - Near line 5303 where `costUsd = turnResult.cost?.usd || 0`: check for adapter-reported cost
   - If adapter cost is non-zero and turn result cost is zero, use adapter cost
   - Store override provenance in history entry: `cost_source: 'adapter_stream_json'` vs `'turn_result'`

5. **Plumb adapter cost through `step.js`**:
   - After `dispatchLocalCli()` returns, extract `cliResult.cost` and pass it to the acceptance path
   - Display adapter-observed cost in CLI output: `Tokens: N in / N out ($X.XX from stream-json)`

6. **Tests**: See SYSTEM_SPEC.md Acceptance Tests section for specific test cases.

## Notes for QA

- Verify parser handles edge cases: empty lines, partial JSON, non-result events, multiple result events
- Verify cost override only fires when agent reports zero (not when agent reports non-zero)
- Verify `dispatch-progress.json` shows live cost accumulation during dispatch
- Verify governance report `computeCostSummary()` includes adapter-sourced cost
- Verify budget_status.spent_usd increments correctly across multiple turns
- Run full test suite: `cd cli && npm test`

## Acceptance Contract

1. **Roadmap milestone addressed: M4: Recovery & Resilience Hardening** — ROADMAP.md:59
2. **Unchecked roadmap item completed: Add turn-level cost tracking for local_cli runtimes (parse stream-json cost events)** — ROADMAP.md:63
3. **Evidence source: .planning/ROADMAP.md:63** — Item will be checked off after QA ship approval
