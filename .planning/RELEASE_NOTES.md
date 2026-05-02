# Release Notes — agentXchain.dev

## Implementation-Phase Completion Guard

**Authoritative implementation turns now require product code changes.** The turn-result validator now rejects completed authoritative turns in the implementation phase that have no product code paths in `files_changed`. Previously, this was a non-blocking warning; it is now a hard validation error.

This prevents implementation turns from completing with only planning artifacts (`.planning/*`), review artifacts (`.agentxchain/reviews/*`), or staging outputs (`.agentxchain/staging/*`) — ensuring the `implementation_complete` gate is backed by actual source changes.

## Verification Summary

- 100 turn-result-validator tests: PASS (including 2 new regression tests)
- 17 staged-result-proof tests: PASS
- 42 local-cli-adapter tests: PASS
- 77 config-schema + timeout-evaluator + run-loop tests: PASS
- **Total: 236 in-scope tests, 0 failures**

## Upgrade Notes

No breaking changes for conformant implementations. Implementation-phase turns that previously completed with only planning file changes will now fail validation. Ensure implementation turns include at least one product source path in `files_changed` (e.g., `cli/src/*`, `src/*`, `tests/*`).

## Known Issues

- AGENT-TALK collaboration log guard tests (3/8 fail) are a pre-existing state issue unrelated to this change. TALK.md lacks compressed summary structure from prior runs.
