# Live API Proxy Preflight Report — 2026-04-01

Purpose: capture the first real execution of the new `live-api-proxy-preflight-smoke.sh` harness so the preflight tokenization track has evidence beyond unit and adapter tests.

## Scope

- Harness spec: `.planning/LIVE_API_PROXY_PREFLIGHT_SMOKE_SPEC.md`
- Harness script: `cli/scripts/live-api-proxy-preflight-smoke.sh`
- Provider: Anthropic
- Model: `claude-sonnet-4-6`

## Scenario 1 — Local Overflow

- Workspace: `/var/folders/2c/vqqd_9tn4wd_flr5f0690yl80000gn/T/agentxchain-preflight-overflow-GyhTST`
- Run id: `run_fb4f637e819ddb33`
- Turn id: `turn_fb9654287de0191a`
- Result: **pass**

### Evidence

- `TOKEN_BUDGET.json` written
- `CONTEXT.effective.md` written
- `.agentxchain/staging/api-error.json` written with `error_class = "context_overflow"`
- `.agentxchain/staging/provider-response.json` absent
- `TOKEN_BUDGET.json` values:
  - `context_window_tokens = 512`
  - `available_input_tokens = 320`
  - `estimated_input_tokens = 1441`
  - `sent_to_provider = false`

### Judgment

The local short-circuit path is confirmed outside the test suite. The adapter computed the budget, wrote the audit artifacts, and refused to call the provider.

## Scenario 2 — Provider-Backed Happy Path

- Workspace: `/var/folders/2c/vqqd_9tn4wd_flr5f0690yl80000gn/T/agentxchain-preflight-happy-ti3BRt`
- Run id: `run_6b766bec334eb808`
- Turn id: `turn_6b10f34f09392b1f`
- Result: **partial**

### Evidence

- `TOKEN_BUDGET.json` written
- `CONTEXT.effective.md` written
- `TOKEN_BUDGET.json` values:
  - `context_window_tokens = 200000`
  - `available_input_tokens = 198464`
  - `estimated_input_tokens = 1438`
  - `sent_to_provider = true`
- `.agentxchain/staging/api-retry-trace.json` written with:
  - `max_attempts = 3`
  - `attempts_made = 3`
  - `final_outcome = "failure"`
  - aggregate usage:
    - `input_tokens = 4509`
    - `output_tokens = 1536`
    - `usd = 0.036`
- `.agentxchain/staging/api-error.json` written with `error_class = "turn_result_extraction_failure"`
- `.agentxchain/staging/provider-response.json` absent
- `.agentxchain/staging/turn-result.json` absent

### Interpretation

The preflight send path itself is confirmed live:

- the local token-budget evaluator permitted dispatch
- the adapter reached the provider
- the provider consumed tokens on all three attempts

But the end-to-end happy path is **not** yet closed because the adapter failed to extract valid governed JSON from the provider response on every attempt, even after:

- replacing the QA prompt in the temp workspace with a smoke-specific raw-JSON-only override
- reducing `max_output_tokens` to `512`
- enabling adapter-local retries for `turn_result_extraction_failure`

## What This Report Proves

1. Preflight tokenization is live on the real adapter path.
2. Local overflow prevention works exactly as designed.
3. Provider-backed send/no-send accounting is observable through `TOKEN_BUDGET.json` and retry traces.

## What Remains Unproven

1. The provider-backed preflight happy path still does not reliably produce an extractable governed turn result.
2. The adapter does not persist raw provider output on extraction failure, which makes this class of live drift harder to debug than it should be.

## Recommended Next Step

The highest-value follow-up is **not** more tokenization work. It is a narrow auditability/recovery improvement in `api_proxy`:

- persist raw provider response text/body even when extraction fails
- optionally add a bounded JSON-repair pass before returning `turn_result_extraction_failure`

That is the blocker surfaced by this live smoke run.

## Follow-up Diagnosis And Closure

After `provider-response.json` persistence landed, the happy-path smoke was rerun against live Anthropic with preserved temp workspaces.

### Diagnosis

Two consecutive happy-path reruns failed for the same reason:

- workspace `/var/folders/2c/vqqd_9tn4wd_flr5f0690yl80000gn/T/agentxchain-preflight-happy-L21eVP`
- workspace `/var/folders/2c/vqqd_9tn4wd_flr5f0690yl80000gn/T/agentxchain-preflight-happy-sWKOBS`

In both cases, `.agentxchain/staging/provider-response.json` showed:

- `schema_version` was present inside the model output
- the JSON object was truncated before closing
- Anthropic returned `stop_reason = "max_tokens"`

This proved the extraction failure was **not** a parser bug and **not** a preflight-tokenization bug. The smoke harness happy profile was simply reserving too little output budget.

### Fix Applied

Updated the happy-path runtime profile in both:

- `.planning/LIVE_API_PROXY_PREFLIGHT_SMOKE_SPEC.md`
- `cli/scripts/live-api-proxy-preflight-smoke.sh`

Change:

- `max_output_tokens: 512 -> 1024 -> 2048`

The intermediate `1024` bump still reproduced truncation, so the final settled value is `2048`.

### Verification

Happy-path rerun with the updated harness:

- workspace `/var/folders/2c/vqqd_9tn4wd_flr5f0690yl80000gn/T/agentxchain-preflight-happy-7g4f5B`
- result: **pass**
- `dispatch_ok = true`
- `validation_ok = true`
- `sent_to_provider = true`
- `TOKEN_BUDGET.json`, `CONTEXT.effective.md`, `provider-response.json`, and `turn-result.json` all present

Full harness rerun:

- command: `bash cli/scripts/live-api-proxy-preflight-smoke.sh --mode both`
- result: **pass**
- overflow scenario still returned `error_class = "context_overflow"` with `sent_to_provider = false`
- happy scenario returned `dispatch_ok = true` with artifacts present

### Updated Judgment

The live preflight smoke harness is now usable again as a real regression check for the send/no-send contract.

## Final Stabilization

Claude's next harness-level prompt fix exposed one remaining local bug before the live API call:

- the script tried to inject `turn_id` into the happy-path override before assigning the QA turn
- first rerun failed locally with `Cannot read properties of null (reading 'turn_id')`

That bootstrap defect was corrected by assigning the QA turn before building the happy-path override. One more determinism issue then surfaced:

- the model still received the generic governed QA prompt plus the role-prompt tail override
- live dispatch succeeded, but `validation_ok = false`
- exact validator failure:
  - stage: `schema`
  - errors:
    - `artifacts_created[0] must be a string.`
    - `artifacts_created[1] must be a string.`

This showed the harness was still testing prompt-following variance instead of the adapter/preflight contract. The final fix was to overwrite the generated `.agentxchain/dispatch/current/PROMPT.md` for the happy path with a minimal literal governed JSON response contract containing the exact assigned `run_id` and `turn_id`.

### Final Verification

Happy-path rerun after the final prompt override:

- command: `bash cli/scripts/live-api-proxy-preflight-smoke.sh --mode happy --keep-temp`
- workspace: `/var/folders/2c/vqqd_9tn4wd_flr5f0690yl80000gn/T/agentxchain-preflight-happy-R4DSEP`
- result: **pass**
- `dispatch_ok = true`
- `validation_ok = true`
- `sent_to_provider = true`

Full harness rerun after the same fix:

- command: `bash cli/scripts/live-api-proxy-preflight-smoke.sh --mode both`
- result: **pass**
- happy workspace: `/var/folders/2c/vqqd_9tn4wd_flr5f0690yl80000gn/T/agentxchain-preflight-happy-KspPi6`
- overflow workspace: `/var/folders/2c/vqqd_9tn4wd_flr5f0690yl80000gn/T/agentxchain-preflight-overflow-SiaGcP`
- happy scenario:
  - `dispatch_ok = true`
  - `validation_ok = true`
  - `sent_to_provider = true`
- overflow scenario:
  - `dispatch_ok = false`
  - `error_class = "context_overflow"`
  - `sent_to_provider = false`

### Final Judgment

The live preflight smoke contract is now closed at the stricter boundary:

1. provider-backed happy-path dispatch succeeds
2. local overflow short-circuit remains correct
3. happy-path staged output is validator-clean (`validation_ok = true`)

The remaining work is no longer in tokenization smoke stability. Any future expansion is optional scope growth, such as compression-success coverage or full `acceptGovernedTurn()` completion.
