# Live API Proxy Preflight Smoke Spec

> Contract for a reusable local harness that validates `api_proxy` preflight tokenization against the real Anthropic adapter path.

---

## Purpose

Provide a repeatable smoke harness for the newly implemented preflight tokenization surface so future live checks do not rely on ad hoc terminal history.

This harness is intentionally narrower than full Scenario A dogfood:

- it bootstraps a temp workspace to the `qa` entry point
- it exercises the real `api_proxy` adapter with preflight enabled
- it verifies both:
  - the happy path where a provider request is sent
  - the local overflow path where no provider request is sent

The goal is to validate the preflight contract itself, not to re-prove the full governed PM -> Dev -> QA lifecycle.

---

## Interface/Schema

### Entry Point

```bash
bash cli/scripts/live-api-proxy-preflight-smoke.sh
```

### CLI Options

```text
--mode happy      Run only the provider-backed happy path
--mode overflow   Run only the local-overflow path
--mode both       Run both paths sequentially (default)
--keep-temp       Do not delete temp workspace(s)
```

### Output Contract

The harness MUST:

1. Print the selected mode
2. Print the temp workspace path for each executed scenario
3. Print a JSON summary per scenario
4. Exit `0` only when every requested scenario passes
5. Exit non-zero when any requested scenario fails

### Scenario Summary Shape

Each scenario summary MUST include:

```ts
type LivePreflightSmokeSummary = {
  mode: "happy" | "overflow";
  workspace: string;
  dispatch_ok: boolean;
  validation_ok?: boolean;
  error_class?: string | null;
  sent_to_provider: boolean;
  token_budget_path: string;
  effective_context_path: string;
  provider_response_path: string;
  staged_result_path: string;
};
```

---

## Behavior

### 1. Workspace Bootstrap

For each scenario, the harness MUST:

1. Copy `examples/governed-todo-app` to a temp directory
2. Initialize a git repo in that temp workspace
3. Patch `agentxchain.json` so runtime `api-qa` has preflight enabled
4. Use governed library functions to advance the temp workspace to `phase = "qa"` without relying on a live PM or local CLI dev subprocess

Bootstrap is allowed to use library helpers because the smoke target is the `api_proxy` adapter contract, not the PM/dev adapters.

### 2. Happy Path

The happy path MUST:

1. Assign a QA turn
2. Write the dispatch bundle
3. Invoke the real `dispatchApiProxy()` path with:
   - `provider = "anthropic"`
   - preflight enabled
   - a large enough `context_window_tokens` that the local preflight does not short-circuit
   - a temp-workspace `PROMPT.md` override written after QA assignment and dispatch-bundle generation, containing a literal minimal governed JSON response contract with the actual assigned `run_id` and `turn_id` injected
4. Verify:
   - `dispatch_ok === true`
   - `validation_ok === true`
   - `TOKEN_BUDGET.json` exists
   - `CONTEXT.effective.md` exists
   - `.agentxchain/staging/<turn_id>/provider-response.json` exists
   - `.agentxchain/staging/<turn_id>/turn-result.json` exists
   - `sent_to_provider === true`

The harness MUST run `validateStagedTurnResult()` and require the staged provider output to pass. The happy path is now intentionally validator-deterministic so the smoke checks both provider-backed dispatch and schema-valid governed JSON extraction.

### 3. Overflow Path

The overflow path MUST:

1. Assign a QA turn
2. Inflate the QA prompt template so the request exceeds a deliberately tiny but config-valid token budget
3. Write the dispatch bundle
4. Invoke `dispatchApiProxy()` with preflight enabled
5. Verify:
   - `dispatch_ok === false`
   - `error_class === "context_overflow"`
   - `TOKEN_BUDGET.json` exists
   - `CONTEXT.effective.md` exists
   - `.agentxchain/staging/provider-response.json` does **not** exist
   - `sent_to_provider === false`

This path explicitly validates local short-circuit behavior before any provider call is made.

### 4. Config Profiles

The harness MUST use two separate runtime profiles:

- `happy`
  - `max_output_tokens = 2048`
  - `context_window_tokens = 200000`
  - `preflight_tokenization.safety_margin_tokens = 1024`
  - adapter-local retry enabled for `turn_result_extraction_failure` with `max_attempts = 3`
- `overflow`
  - `max_output_tokens = 128`
  - `context_window_tokens = 512`
  - `preflight_tokenization.safety_margin_tokens = 64`

Both profiles MUST use:

- `preflight_tokenization.enabled = true`
- `preflight_tokenization.tokenizer = "provider_local"`

### 5. Environment

The harness MUST load `ANTHROPIC_API_KEY` from the repo-root `.env` when it is not already present in the shell environment.

If the key is still missing and the selected mode includes the happy path, the harness MUST fail fast with a clear message rather than produce a misleading adapter error later.

---

## Error Cases

| Condition | Required behavior |
|---|---|
| `ANTHROPIC_API_KEY` missing for `happy` or `both` | Exit non-zero before the happy path and name the missing variable |
| Temp workspace creation fails | Exit non-zero and print the failing path/operation |
| Bootstrap to `qa` fails | Exit non-zero and print which governed step failed |
| Happy path returns provider/auth/network error | Exit non-zero and surface the classified adapter error |
| Overflow path sends a provider request anyway | Exit non-zero because the local short-circuit contract failed |
| `TOKEN_BUDGET.json` missing in either mode | Exit non-zero because the audit contract failed |
| `CONTEXT.effective.md` missing in either mode | Exit non-zero because the audit contract failed |
| Provider response missing in happy mode | Exit non-zero because live dispatch did not actually occur |
| Provider response exists in overflow mode | Exit non-zero because the overflow request escaped locally |
| `validation_ok !== true` in happy mode | Exit non-zero because the validator-stable happy-path contract failed |

---

## Acceptance Tests

1. Running `bash cli/scripts/live-api-proxy-preflight-smoke.sh --mode happy` against a valid API key exits `0` and prints a summary with `dispatch_ok = true`, `validation_ok = true`, and `sent_to_provider = true`.
2. The happy path creates `TOKEN_BUDGET.json`, `CONTEXT.effective.md`, `provider-response.json`, and `turn-result.json`.
3. Running `bash cli/scripts/live-api-proxy-preflight-smoke.sh --mode overflow` exits `0` and prints a summary with `dispatch_ok = false`, `error_class = "context_overflow"`, and `sent_to_provider = false`.
4. The overflow path creates `TOKEN_BUDGET.json` and `CONTEXT.effective.md` but does not create `provider-response.json`.
5. Running `--mode both` executes both scenarios and exits non-zero if either one fails.
6. Running with `--keep-temp` preserves the workspace for manual inspection.

---

## Open Questions

1. Should this harness eventually become a manually triggered GitHub Actions workflow once a safe secret strategy exists for the repo?
2. Should a future version also exercise a compression-success case where preflight trims context but still sends the request?
3. Should a future version accept the happy-path turn end-to-end through `acceptGovernedTurn()` rather than stopping at staged validation?
