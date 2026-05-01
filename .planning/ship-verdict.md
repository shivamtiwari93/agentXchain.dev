# Ship Verdict — agentXchain.dev

## Verdict: SHIP

## QA Summary

The dev turn delivered a well-targeted M1 ghost-turn hardening implementation. The core change — a pre-spawn compatibility guard for Claude `--print --output-format stream-json` commands missing `--verbose` — directly addresses the deterministic root cause identified by PM. The secondary changes (startup heartbeat diagnostics, schema-backed config knobs, adapter timeout threading) are additive and correctly scoped.

**Challenges raised against dev turn:**

1. **Dev overrode PM scope (DEC-002/DEC-003 from planning).** The PM concluded "no adapter validation was needed" and scoped dev to heartbeat/timeout hardening only. Dev correctly identified that a known deterministic command-shape failure should be blocked at pre-spawn, not recovered post-failure. QA agrees with dev's override — the PM scope was too narrow given the root-cause evidence.

2. **Heartbeat non-proof design reviewed.** Dev declared heartbeats as "diagnostic keepalives, not governed startup proof" (DEC-002). QA verified the implementation: heartbeats do NOT set `first_output_at`, do NOT count as startup proof, and are correctly gated on `firstOutputAt || settled` to stop after output arrives. This is correct — conflating heartbeats with proof would mask ghost turns.

3. **Command compatibility guard scope verified.** The guard only fires when the binary name is `claude`, the command uses `--print`/`-p`, includes `stream-json` output format, and lacks `--verbose`. It correctly handles both `--output-format stream-json` and `--output-format=stream-json` forms. The scope is tight enough to avoid false positives on non-Claude runtimes.

4. **Dev acknowledged unverified acceptance target.** The IMPLEMENTATION_NOTES honestly state "I did not verify zero ghost turns across 10 consecutive self-governed runs." This is appropriate — that belongs in a longer dogfood run, not a single dev turn.

**Evidence:**

- 42 local-cli-adapter tests pass (including 7 new regression tests)
- 180 adjacent tests pass (99 validator + 39 run-loop + 31 timeout + 7 schema + 4 emission guard)
- All 8 acceptance criteria verified independently by QA
- Code reviewed: command compatibility guard, heartbeat lifecycle, config validation, timeout threading
- No reserved paths modified
- git diff --check clean (no whitespace errors)
- AGENT-TALK 3/8 failures confirmed pre-existing (compressed summary structure)

## Open Blockers

None.

## Conditions

None. Ship as-is.
