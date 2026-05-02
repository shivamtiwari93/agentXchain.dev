# Release Notes

## User Impact

Authoritative implementation turns now require at least one product code change in `files_changed` to complete successfully. Implementation turns that list only planning artifacts (`.planning/*`), review artifacts (`.agentxchain/reviews/*`), or staging outputs (`.agentxchain/staging/*`) — or that list no files at all — are rejected with a hard validation error. This closes the loophole where an implementation turn could satisfy the `implementation_complete` gate without delivering actual source changes.

Non-implementation phases (planning, qa) are unaffected. Blocked or failed implementation turns are also unaffected.

## Verification Summary

- 100 turn-result-validator tests pass (including 2 new implementation-completion regression tests)
- 17 staged-result-proof + turn-result-shape tests pass
- 42 local-cli-adapter tests pass
- 77 config-schema + timeout-evaluator + run-loop tests pass
- **Total: 236 tests, 0 failures**
- All 8 acceptance criteria verified (see acceptance-matrix.md)
- No reserved path modifications confirmed via git diff

## Upgrade Notes

No breaking changes for conformant implementations. Implementation-phase turns that previously completed with only planning file changes will now fail validation. Ensure implementation turns include at least one product source path in `files_changed` (e.g., `cli/src/*`, `src/*`, `tests/*`).

## Known Issues

- AGENT-TALK collaboration log guard tests (3/8 fail) are a pre-existing state issue unrelated to this change. TALK.md lacks compressed summary structure from prior runs.
