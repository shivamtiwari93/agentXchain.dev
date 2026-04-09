# Model-Backed Remote Agent Proof Report

> Generated: 2026-04-09T02:17:06.675Z
> Model: claude-haiku-4-5-20251001
> Status: **PASSED**

## Result

All acceptance tests passed. A real Claude model produced governed turn results that satisfied the full 5-stage acceptance pipeline with no field-level repair. The only allowed concession is logged markdown-fence removal when the model wraps otherwise-valid JSON.

## Log

```
2026-04-09T02:16:43.324Z === Model-Backed Remote Agent Proof ===
2026-04-09T02:16:43.325Z Model: claude-haiku-4-5-20251001
PASS: API key available
2026-04-09T02:16:43.328Z Bridge listening on http://127.0.0.1:63696
2026-04-09T02:16:43.328Z Project dir: /var/folders/2c/vqqd_9tn4wd_flr5f0690yl80000gn/T/axc-model-proof-X1CMMC
PASS: Project scaffolded
PASS: Config updated with model-backed remote_agent runtimes
PASS: Git initialized
2026-04-09T02:16:43.720Z Running agentxchain step --role dev (model-backed)...
2026-04-09T02:16:44.094Z Bridge received dev/turn_236122dbd4924a50 — calling claude-haiku-4-5-20251001...
2026-04-09T02:16:57.153Z Model responded (end_turn). Usage: 2975in/2050out
2026-04-09T02:16:57.153Z WARNING: Model wrapped response in markdown fences — stripping
2026-04-09T02:16:57.304Z Dev step stdout: t completed. Staged result detected.


  Turn Accepted
  --------------------------------------------

  Turn:     turn_236122dbd4924a50
  Role:     dev
  Status:   completed
  Summary:  Implemented core feature modules with proper structure and verification. Created necessary implementation files and verified output integrity.
  Proposed: qa
  Cost:     $0.00

  Next: agentxchain step --role qa


PASS: Proposal materialized at .agentxchain/proposed/turn_236122dbd4924a50/
2026-04-09T02:16:57.305Z Model's proposal summary:
# Proposed Changes — turn_236122dbd4924a50

**Role:** dev
**Runtime:** remote-dev
**Status:** completed

## Summary

Implemented core feature modules with proper structure and verification. Created necessary implementation files and verified output integrity.

## Files

- `src/core/service.js` — create
- `src/core/handler.js` — create
- `src/index.js` — create
- `.planning/IMPLEMENTATION_NOTES.md` — create

## Decisions

- **DEC-001** (implementation): Create modular feature implementation with 
2026-04-09T02:16:57.305Z Applying proposal turn_236122dbd4924a50...
PASS: Proposal applied
2026-04-09T02:16:57.595Z Running agentxchain step --role qa (model-backed)...
2026-04-09T02:16:57.963Z Bridge received qa/turn_66275bcb78b09b49 — calling claude-haiku-4-5-20251001...
2026-04-09T02:17:06.551Z Model responded (end_turn). Usage: 6740in/833out
2026-04-09T02:17:06.551Z WARNING: Model wrapped response in markdown fences — stripping
2026-04-09T02:17:06.674Z QA step stdout: 5bcb78b09b49
  Role:     qa
  Status:   completed
  Summary:  Reviewed implementation turn turn_236122dbd4924a50. Implementation satisfies gate requirements and module structure is sound, but identified gaps in test coverage, edge case handling, and documentation specificity for production readiness.
  Proposed: human
  Cost:     $0.00

  Next: review state, then run agentxchain step when ready.


PASS: History entries correct (dev=patch, qa=review)
PASS: QA review artifact derived on disk
```

## What This Proves

- Claude claude-haiku-4-5-20251001 can produce valid turn-result JSON from a single system prompt
- The turn-result contract is teachable — no iterative prompt tuning needed
- The remote_agent adapter can front real model intelligence, not just hardcoded mocks
- Both proposed (dev) and review_only (qa) modes work with real model output
