# BUG-56 False-Positive Retrospective

## Incident summary

- **Date filed:** 2026-04-21 (tester report on `agentxchain@2.149.1`).
- **Symptom:** `agentxchain connector check <runtime>` and `agentxchain connector validate <runtime>` both fail with `probe_kind: auth_preflight`, `error_code: claude_auth_preflight_failed`, diagnostic "Claude local_cli runtime has no env-based auth and is missing \"--bare\"; non-interactive subprocesses can hang on macOS keychain reads." on a working Claude Max setup where the exact spawn shape that the adapter would use (`printf '...' | claude --print --permission-mode bypassPermissions --model opus --dangerously-skip-permissions`) returns real stdout in under a second.
- **Blast radius:** every Claude Max user who does not manually export `ANTHROPIC_API_KEY` or hand-edit their runtime command to include `--bare`. That is the default operator profile.
- **Severity:** the ostensible BUG-54 fix regressed the supported-configuration surface more than the original bug affected. v2.149.1 converts a non-deterministic hang for a small subset of setups into a deterministic hard-fail for a larger superset.

## What we assumed

1. "No `ANTHROPIC_API_KEY` + no `CLAUDE_CODE_OAUTH_TOKEN` + no `--bare` on a Claude `local_cli` runtime" implies the subprocess will try to read the macOS keychain and hang.
2. The `claude --bare` flag's existence (and its explicit docstring "skips keychain reads") implies that without `--bare` a non-interactive subprocess will always attempt keychain auth.
3. The 2026-04-20 `bug-54-repro-21480-clean.json` tester diagnostic (`5/5 attempts = stdout_attached: false, first_stderr_ms: null, watchdog_fires: 5`) is a representative shape for all Claude Max setups lacking env auth.

## What the tester disproved

1. The tester's `claude auth status --text` returns `Login method: Claude Max Account` — Claude Max is authenticated via OAuth/keychain. `env | rg 'ANTHROPIC|CLAUDE'` prints nothing. The adapter's exact non-interactive spawn shape still returns real stdout.
2. The `agentxchain connector check <runtime>` command still fails on this setup, citing a hang risk that does not exist on this setup.
3. On the Claude Opus 4.7 dev box this retro was written on (verified 2026-04-21): identical conditions (no env auth, Claude Max via keychain) → `printf 'READY\n' | claude --print --permission-mode bypassPermissions --model opus --dangerously-skip-permissions` returned `READY` and exited cleanly. Second independent reproduction of the tester's disproof.

The static shape-check in `cli/src/lib/claude-local-auth.js::getClaudeSubprocessAuthIssue` encodes assumption 1 as a release-boundary contract via four call-sites (adapter, connector check, connector validate, doctor) and two decision records (`DEC-BUG54-CLAUDE-AUTH-PREFLIGHT-001`, `DEC-BUG54-VALIDATE-AUTH-PREFLIGHT-001`). Assumption 1 is not universally true. The contract is therefore wrong for an entire class of legitimately-configured operators.

## Why the tests did not catch this

`cli/test/claim-reality-preflight.test.js` and the call-site unit tests assert the preflight fires the right warning shape for the right input shape:

- **Input:** `{ runtime: { command: [claude, ...no --bare] }, env: { no anthropic/claude keys } }`.
- **Expected output:** `probe_kind: auth_preflight`, `error_code: claude_auth_preflight_failed`.

Every such test is green in CI. None of them ask whether emitting that warning is the *correct* behavior for a real-world valid configuration. The contract under test is "the function produces the expected error for the expected input," not "the function's error correctly predicts real subprocess behavior on a working setup." That is the same seam-vs-flow failure mode Rule #12 was added to prevent, generalized from command-chain tests to preflight gates.

Rule #12 requires command-chain tests spawn real child processes against a governed state. We did not extend that discipline to preflight correctness: no test spawned the actual Claude CLI and asserted whether the preflight's prediction matched reality. Without that loop, a theory-level claim like "this will hang" is never reality-checked before shipping.

Two release cycles (v2.149.0, v2.149.1) were spent tuning which preflight warning fires *first* when multiple triggers are active — a problem that presupposes every trigger is itself correct. Neither cycle asked whether `auth_preflight` should fire at all for the default Claude Max profile. We debugged an ordering bug on top of a correctness bug.

## The corrective rule

Rule #13, added to `HUMAN-ROADMAP.md` Active Discipline as part of the BUG-56 fix wave:

> **Rule #13 — No preflight gate ships without a positive-case regression test that proves the gate passes for at least one real valid configuration.** A test that only asserts the gate's failure output for the failure-case input is not sufficient — it proves the gate can say "no," not that it says "yes" when it should. For gates that make predictive claims about subprocess behavior ("this will hang," "this will fail to authenticate"), the positive-case test must exercise a real or shim subprocess that demonstrates the predicted failure does NOT occur for the supported-configuration input, and the negative-case test must exercise a shim that demonstrates the predicted failure DOES occur for the failure-case input.

This is a generalization of Rule #12 from CLI command chains to preflight predictive claims.

## The fix contract (what the BUG-56 fix wave must do)

1. Replace the static shape-check in `getClaudeSubprocessAuthIssue` with a bounded smoke probe: spawn `claude --print` with a short stdin prompt and a 10-second watchdog. If the probe produces stdout before the watchdog fires, return `null` (no issue). If it hangs or exits non-zero with empty stdout, return the existing diagnostic.
2. Update all four call-sites to use the probe result. The call-site interface does not change; the function semantics do.
3. Add one command-chain positive-case regression test in `cli/test/beta-tester-scenarios/` using a shim `claude` that echoes stdin-derived output — `agentxchain connector check/validate/run` must all pass.
4. Add one command-chain negative-case regression test using a shim `claude` that reads stdin but never emits stdout — the same three CLI commands must all fail with the existing `claude_auth_preflight_failed` diagnostic. No regression on the hang detection.
5. Supersede `DEC-BUG54-CLAUDE-AUTH-PREFLIGHT-001` and `DEC-BUG54-VALIDATE-AUTH-PREFLIGHT-001` — annotate the prior static-shape contract as the BUG-56 false-positive lineage and point at the new probe-based contract.
6. Commit Rule #13 to `HUMAN-ROADMAP.md` Active Discipline.

## Open questions parked for the BUG-56 fix wave

- **Scaffold `--bare` default (DEC-BUG54-NEW-SCAFFOLDS-CLAUDE-BARE-001, Turn 108).** `--bare` in the scaffold default forces Claude Max users to either export `ANTHROPIC_API_KEY` or hand-edit the scaffold. The tester's disproof shows Claude Max + keychain works non-interactively, so the defensive `--bare` may be unnecessary. But reverting the default is not strictly required to close BUG-56 — the preflight probe replacement alone prevents the false-positive failure. Whether to also revert the scaffold default is a separate decision owed to the BUG-56 fix wave, not to this retro.
- **Why the original BUG-54 tester's `tusq.dev-21480-clean` reproduced a hang.** The keychain-hang hypothesis is no longer the accepted root cause. It may still be partially true (specific Claude CLI versions, specific keychain-state edge cases), but it is not a universal claim. The BUG-54 root-cause question returns to the list of unresolved items.

## Prior false-closure retros referenced

- `.planning/BUG_31_33_COVERAGE_GAP_POSTMORTEM.md`
- `.planning/BUG_36_FALSE_CLOSURE.md`
- `.planning/BUG_39_FALSE_CLOSURE.md`
- `.planning/BUG_40_FALSE_CLOSURE.md`
- `.planning/BUG_52_FALSE_CLOSURE.md` (called for by HUMAN-ROADMAP; existence not verified in this retro)
