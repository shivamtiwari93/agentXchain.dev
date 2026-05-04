# System Spec — Turn-Level Cost Tracking for local_cli Runtimes

**Run:** `run_9a37a5dc395bc9b8`
**Baseline:** git:2379c168b (HEAD at planning start)
**Package version:** `agentxchain@2.155.72`

## Purpose

Parse Claude CLI `--output-format stream-json` stdout events during `local_cli` dispatch to extract turn-level cost and usage telemetry. Override zero-cost agent self-reports with adapter-observed cost at acceptance time. Enables accurate budget tracking, governance reporting, and budget policy enforcement for local_cli runtimes.

**Key gap being closed:** The `api_proxy` adapter tracks cost via API response telemetry (`api-proxy-adapter.js:480-507`). The `local_cli` adapter captures stdout but treats it as opaque log data. Claude CLI's stream-json output includes structured cost events that go unread.

---

## 1. Data Flow Overview

```
Claude CLI subprocess
  │ stdout (stream-json)
  │ {"type":"result","cost_usd":0.05,"usage":{"input_tokens":1234,"output_tokens":5678}}
  ▼
local-cli-adapter.js
  │ StreamJsonCostAccumulator.processLine()
  │ accumulates {input_tokens, output_tokens, usd}
  ├──▶ dispatch-progress.json (live cost field)
  │
  ▼ dispatch result: { ok: true, cost: {input_tokens, output_tokens, usd}, ... }
step.js
  │ passes adapter cost to acceptance flow
  ▼
governed-state.js (acceptGovernedTurnResult)
  │ if turnResult.cost.usd === 0 && adapterCost.usd > 0:
  │   use adapterCost, tag cost_source: 'adapter_stream_json'
  ▼
state.json: budget_status.spent_usd += adapterCost.usd
history.jsonl: cost: {input_tokens, output_tokens, usd, cost_source}
```

---

## 2. Module: stream-json-cost-parser.js

**File:** `cli/src/lib/stream-json-cost-parser.js` (new)

### Exports

```javascript
/**
 * Create a cost accumulator for parsing Claude CLI stream-json events.
 *
 * @param {object} [options]
 * @param {string} [options.model] - model ID for rate-based USD calculation fallback
 * @param {object} [options.config] - project config (for custom cost rate overrides)
 * @returns {StreamJsonCostAccumulator}
 */
export function createStreamJsonCostAccumulator(options = {})

/**
 * @typedef {object} StreamJsonCostAccumulator
 * @property {function(string): void} processLine - Feed a single stdout line
 * @property {function(): ParsedCost|null} getCost - Get accumulated cost (null if no cost events seen)
 * @property {function(): number} getEventCount - Number of cost-bearing events parsed
 */

/**
 * @typedef {object} ParsedCost
 * @property {number} input_tokens
 * @property {number} output_tokens
 * @property {number} usd - USD cost (3 decimal precision)
 */
```

### Event Recognition

The parser recognizes these Claude CLI stream-json event shapes:

| Event Type | Cost Fields | Behavior |
|------------|-------------|----------|
| `{"type": "result", "cost_usd": N, "usage": {input_tokens, output_tokens}}` | `cost_usd` (preferred), `total_cost_usd`, `usage` | Primary cost source. If `total_cost_usd` present, prefer it over summing `cost_usd` |
| `{"type": "result", "usage": {input_tokens, output_tokens}}` (no `cost_usd`) | `usage` only | Calculate USD from `getCostRates(model)` using token counts |
| Any event with `usage.input_tokens` and `usage.output_tokens` | `usage` | Accumulate tokens; update USD if rate available |

### Rules

1. Non-JSON lines are silently skipped (no error, no log)
2. JSON objects without recognized cost fields are silently skipped
3. `total_cost_usd` on a `result` event replaces any accumulated `usd` (it is the authoritative session total)
4. Token counts are always additive across events (except when a `result` event provides `total_cost_usd`)
5. USD is rounded to 3 decimal places (`Math.round(usd * 1000) / 1000`) matching `api-proxy-adapter.js` convention
6. `getCost()` returns `null` if zero cost-bearing events were processed
7. Import `getCostRates` from `../adapters/api-proxy-adapter.js` for rate fallback — do NOT duplicate the rate table

### Design Rationale

Pure function module (no I/O, no side effects) for testability. Accumulator pattern matches `api-proxy-adapter.js`'s `addUsageTotals()` approach. Defensive parsing ensures robustness against format evolution.

---

## 3. Integration: local-cli-adapter.js

**File:** `cli/src/lib/adapters/local-cli-adapter.js`

### Changes

**3.1: Detect stream-json mode at dispatch start**

At the existing `usesStreamJson` check site (line ~765), also expose whether the runtime uses stream-json to the dispatch function. Add a helper:

```javascript
function isStreamJsonRuntime(runtime) {
  const tokens = runtime?.command || [];
  const outputFormatIdx = tokens.findIndex(t => t === '--output-format');
  const outputFormatValue = outputFormatIdx >= 0 ? tokens[outputFormatIdx + 1] : null;
  return tokens.includes('--output-format=stream-json')
    || outputFormatValue === 'stream-json';
}
```

**3.2: Create accumulator and feed stdout lines**

Inside `dispatchLocalCli()`, after line ~231 (variable declarations):

```javascript
const streamJsonMode = isStreamJsonRuntime(runtime);
const costAccumulator = streamJsonMode
  ? createStreamJsonCostAccumulator({ model: runtime.model || null, config })
  : null;
```

Inside the `child.stdout.on('data')` handler (line ~367), after existing processing:

```javascript
if (costAccumulator) {
  const lines = text.split('\n');
  for (const line of lines) {
    if (line.trim()) costAccumulator.processLine(line);
  }
}
```

**3.3: Return accumulated cost in dispatch result**

At the settle calls (line ~504 for success, and the authentication failure paths), include:

```javascript
settle({
  ok: true,
  exitCode,
  timedOut: false,
  aborted: false,
  logs,
  firstOutputAt,
  cost: costAccumulator?.getCost() || null,  // NEW
});
```

### Design Constraints

- Cost parsing is best-effort and never blocks or delays dispatch (matches DEC-DISPATCH-PROGRESS-001)
- `processLine()` must not throw — any parse error is swallowed
- Only activated for stream-json runtimes (zero overhead for non-stream-json)
- Stdout chunk boundaries may split JSON lines; handle via line buffering in the accumulator or split-on-newline in the handler

---

## 4. Integration: dispatch-progress.js

**File:** `cli/src/lib/dispatch-progress.js`

### Changes

Add `cost` field to the progress state object (after line ~86):

```javascript
cost: null,  // { input_tokens, output_tokens, usd } when available
```

Add `onCost(cost)` method to the tracker (alongside `onOutput`):

```javascript
onCost(cost) {
  if (cost && typeof cost.usd === 'number') {
    state.cost = { ...cost };
    dirty = true;
    maybeWrite();
  }
},
```

The adapter calls `tracker.onCost(accumulator.getCost())` periodically or on each cost-bearing event.

---

## 5. Integration: governed-state.js

**File:** `cli/src/lib/governed-state.js`

### Changes

**5.1: Accept adapter cost parameter**

The `acceptGovernedTurnResult()` function (or the internal acceptance path near line ~5303) must accept an `adapterCost` option:

```javascript
// Near line 5303:
const agentCostUsd = turnResult.cost?.usd || 0;
const adapterCostUsd = options?.adapterCost?.usd || 0;
const costUsd = agentCostUsd > 0 ? agentCostUsd : adapterCostUsd;
const costSource = agentCostUsd > 0 ? 'turn_result' : (adapterCostUsd > 0 ? 'adapter_stream_json' : 'none');
```

**5.2: Store cost source in history entry**

In the history entry construction (near line ~5195):

```javascript
cost: {
  ...(turnResult.cost || {}),
  ...(costSource === 'adapter_stream_json' && options.adapterCost
    ? {
        input_tokens: options.adapterCost.input_tokens,
        output_tokens: options.adapterCost.output_tokens,
        usd: options.adapterCost.usd,
      }
    : {}),
  cost_source: costSource,
},
```

### Design Rationale

- Agent-reported non-zero cost is always preferred (the agent may have better visibility into its own spend)
- Adapter cost is a lower bound (may miss events due to stdout buffering or partial output)
- `cost_source` tag enables audit: operators can distinguish agent self-reports from adapter-parsed cost
- `readTurnCostUsd()` at line 721 already handles `cost.usd` — no changes needed there

---

## 6. Integration: step.js

**File:** `cli/src/commands/step.js`

### Changes

After `dispatchLocalCli()` returns (line ~770), extract and display adapter cost:

```javascript
// After line 777 (existing cliResult handling):
if (cliResult.cost) {
  console.log(chalk.dim(`  Cost (stream-json): ${cliResult.cost.input_tokens || 0} in / ${cliResult.cost.output_tokens || 0} out ($${cliResult.cost.usd?.toFixed(3) || '0.000'})`));
}
```

Pass adapter cost to the acceptance flow. The exact integration point depends on how `step.js` invokes acceptance — likely via an options bag that flows to `acceptGovernedTurnResult()`.

---

## Interface

### New Exports

| Module | Export | Type |
|--------|--------|------|
| `stream-json-cost-parser.js` | `createStreamJsonCostAccumulator` | Function |

### Modified Exports

None — all changes are internal to existing functions.

### Behavioral Contract

1. **local_cli turns with stream-json runtimes** now report real cost in `budget_status.spent_usd` and `history.jsonl` entries
2. **local_cli turns without stream-json** continue to report zero cost (no behavior change)
3. **Agent-reported non-zero cost is always preferred** over adapter-parsed cost (backward compatible)
4. **`cost_source` field** added to history entries: `'turn_result'`, `'adapter_stream_json'`, or `'none'`
5. **`dispatch-progress.json`** includes live `cost` field during stream-json dispatch

---

## Dev Charter

### Scope

**Change 1: New module — `cli/src/lib/stream-json-cost-parser.js`**
- `createStreamJsonCostAccumulator(options)` — accumulator with `processLine(line)`, `getCost()`, `getEventCount()`
- Import `getCostRates` from `api-proxy-adapter.js` for rate fallback
- ~80-100 LOC

**Change 2: local-cli-adapter.js integration**
- `isStreamJsonRuntime(runtime)` helper
- Create accumulator on stream-json dispatch
- Feed stdout lines to accumulator
- Return `cost` in dispatch result
- ~30 LOC delta

**Change 3: dispatch-progress.js extension**
- Add `cost` field to progress state
- Add `onCost(cost)` method
- ~15 LOC delta

**Change 4: governed-state.js cost override**
- Accept `adapterCost` option in acceptance path
- Override zero-cost agent reports with adapter cost
- Tag `cost_source` in history entry
- ~20 LOC delta

**Change 5: step.js plumbing**
- Display adapter cost in CLI output
- Pass `adapterCost` to acceptance flow
- ~10 LOC delta

**Change 6: Tests**
- `cli/test/stream-json-cost-parser.test.js` — parser unit tests (~150 LOC)
- Extend `cli/test/local-cli-adapter.test.js` — integration tests for cost extraction
- Extend existing acceptance tests — verify cost override behavior

### Out of Scope

- Codex/Gemini CLI cost parsing (future work)
- Rate table extraction to shared module
- Changes to `computeCostSummary()` or report rendering (already handles non-zero cost)
- Budget alerting beyond existing `budget_exceeded_warn`

### Verification

Dev must confirm:
1. `npm test` passes with 0 failures
2. New parser tests cover: valid result event, result with total_cost_usd, tokens-only event (rate fallback), non-JSON lines, empty input, multiple events
3. Adapter integration test confirms non-zero cost in dispatch result for stream-json runtime
4. Acceptance override test confirms budget_status reflects adapter cost when agent reports zero
5. `cost_source` field present in history entry

## Acceptance Tests

- [ ] `stream-json-cost-parser.js` parses `{"type":"result","cost_usd":0.05,"usage":{"input_tokens":1000,"output_tokens":500}}` → `{input_tokens:1000, output_tokens:500, usd:0.05}`
- [ ] Parser handles `total_cost_usd` field: uses it as authoritative session total
- [ ] Parser returns `null` when no cost events are seen (only non-JSON or non-cost events)
- [ ] Parser handles tokens-only events: calculates USD via `getCostRates(model)` when available
- [ ] `local-cli-adapter.js` returns `cost` field in dispatch result for stream-json runtimes
- [ ] `local-cli-adapter.js` returns `cost: null` for non-stream-json runtimes
- [ ] `dispatch-progress.json` includes `cost` field during active stream-json dispatch
- [ ] Accepted turn with zero agent cost + non-zero adapter cost: `budget_status.spent_usd` reflects adapter cost
- [ ] Accepted turn with non-zero agent cost: agent cost is preserved (adapter cost not used)
- [ ] History entry includes `cost_source: 'adapter_stream_json'` when adapter cost was used
- [ ] `npm test` passes with 0 failures
