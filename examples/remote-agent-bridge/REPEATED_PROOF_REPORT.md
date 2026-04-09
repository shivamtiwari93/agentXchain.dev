# Repeated Model-Backed Proof Report

> Generated: 2026-04-09T02:58:36.534Z
> Model: claude-haiku-4-5-20251001
> Runs: 5
> Pass Rate: **5/5 (100%)**

## Summary

| Metric | Value |
|--------|-------|
| Total runs | 5 |
| Passed | 5 |
| Failed | 0 |
| Pass rate | 100% |
| Total input tokens | 41,501 |
| Total output tokens | 11,215 |
| Fence strips | 10 |
| Estimated cost | $0.0976 |

## Per-Run Results

| Run | Dev Turn | QA Turn | Result | Failure Reason |
|-----|----------|---------|--------|----------------|
| 1 | PASS | PASS | PASS | — |
| 2 | PASS | PASS | PASS | — |
| 3 | PASS | PASS | PASS | — |
| 4 | PASS | PASS | PASS | — |
| 5 | PASS | PASS | PASS | — |

## Failure Taxonomy

No failures.

## What This Proves

- Claude claude-haiku-4-5-20251001 reliably produces governed turn results across 5 independent runs
- The turn-result contract is teachable from a single system prompt without retries
- Both proposed (dev) and review_only (qa) modes work consistently with real model output
- No field-level repair was applied; only logged markdown-fence removal is permitted

## Proof Boundary

- **Model**: claude-haiku-4-5-20251001 (Anthropic Haiku — smallest, cheapest model)
- **Transport concession**: outer markdown-fence stripping only (10 occurrence(s) across 10 model calls)
- **No field-level repair**: decision IDs, objections, proposed_changes, status, and all other fields are the model's raw output
- **No retries**: each model call is a single attempt
