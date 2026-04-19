# Model Compatibility Matrix — api_proxy + proposed

**Status:** Shipped
**Created:** 2026-04-13

## Purpose

Establish an empirical, reproducible proof surface that classifies model-level reliability for `api_proxy` roles using `write_authority: "proposed"`. The matrix replaces anecdotal claims with measured data.

## Scope

- **Providers in scope:** Anthropic (only provider with credentials available in the environment today)
- **Models probed:** `claude-haiku-4-5-20251001`, `claude-sonnet-4-6`
- **Write authority:** `proposed` only (the reliability-sensitive path)
- **Probe type:** lightweight single-turn dispatch that requests a small `proposed_changes` response

## What the probe measures

For each model, a single governed turn is dispatched requesting:
1. A valid `schema_version: "1.0"` turn result JSON
2. At least one entry in `proposed_changes` with `action: "create"` and non-empty `content`
3. Correct `status`, `role`, and `summary` fields

The probe records:
- `extraction_success`: did `extractTurnResultFromText()` find valid JSON?
- `schema_valid`: does the extracted JSON have `schema_version`?
- `proposed_changes_present`: is `proposed_changes` a non-empty array?
- `proposed_changes_well_formed`: does each entry have `path`, `action`, and `content` (for create/modify)?
- `latency_ms`: wall-clock time for the API call
- `cost_usd`: computed from usage tokens + bundled rates
- `raw_error`: any error class or extraction failure message

## Classification

Each model receives one of three labels:
- **reliable**: extraction succeeds, schema validates, proposed_changes are well-formed across all probe attempts
- **inconsistent**: extraction succeeds but proposed_changes are missing/malformed in some attempts
- **unsupported**: extraction fails or the model cannot produce the required schema

## What this is NOT

- Not a load test or throughput benchmark
- Not a quality assessment of proposed code content
- Not a basis for blocking any model — operators choose their models, the matrix informs
- Not doctrine: one model's failure does not change the protocol or the adapter (per `DEC-GATE-WARNING-002`)

## Acceptance Tests

- `AT-MCM-001`: probe script runs against Haiku and returns a structured result object
- `AT-MCM-002`: probe script runs against Sonnet and returns a structured result object
- `AT-MCM-003`: results are written to a durable JSON file in `.planning/`
- `AT-MCM-004`: a docs page or AGENT-TALK entry publishes the classification

## Open Questions

- Should the matrix probe be a CI workflow (nightly/weekly)? Deferred — the first iteration is manual.
- Should non-Anthropic providers be probed when credentials become available? Yes, but only when real API keys are in the environment. No fake results.
