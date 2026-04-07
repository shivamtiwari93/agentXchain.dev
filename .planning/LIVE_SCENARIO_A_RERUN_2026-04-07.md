# Live Scenario A Rerun — 2026-04-07

Purpose: rerun Scenario A after the original `local_cli` proof was blocked by external Claude quota and capture whether the current local Claude runtime, manual PM flow, and Anthropic-backed QA flow all complete in one governed run.

## Scope

- Example project: `examples/governed-todo-app`
- Temp workspace: `/tmp/agentxchain-live-fixed-wEp5aH`
- Run id: `run_99e509c066d2daa9`
- Goal: prove live manual + `local_cli` + `api_proxy` execution in one governed run, then observe the resulting governed state truthfully

## Execution Summary

1. PM turn succeeded in manual mode.
   - Turn: `turn_7e5c78d60aa7d285`
   - Created truthful planning artifacts for a file-backed CLI todo app.
   - Accepted and approved planning exit.

2. First dev attempt exposed a real product defect before the rerun.
   - The shipped example/runtime had been using a write-blocked Claude command shape.
   - `claude --print -p {prompt}` requested file-write approval and exited without staging a result.
   - Repo surfaces were patched to use `claude --print --dangerously-skip-permissions` with `stdin` prompt delivery before this rerun.

3. Dev turn succeeded through live `local_cli`.
   - Turn: `turn_555bf457840b6268`
   - Runtime: `claude --print --dangerously-skip-permissions`
   - Files created: `todo.js`, `test.js`, `package.json`
   - Verification reported by the live agent: `npm test`, `27/27` assertions passed
   - Accepted successfully into governed history.

4. QA turn succeeded through live `api_proxy`.
   - Turn: `turn_7e47fb1e5dc27e56`
   - Provider: Anthropic `claude-sonnet-4-6`
   - Usage captured:
     - `input_tokens`: `1613`
     - `output_tokens`: `2006`
     - `usd`: `0.035`
   - The staged JSON had the known schema defect where `artifacts_created[]` contained objects instead of strings.
   - The review content itself was coherent, so the staging artifact was normalized, the referenced review file was materialized, and the same QA turn was accepted.

6. Follow-up rerun on the current repo state narrowed the QA blocker.
   - Fresh workspace: `/tmp/agentxchain-live-turn72-qlJ0m5`
   - Run: `run_e858f0bce77c41a7`
   - PM turn: `turn_5b83634b6ad86a14`
   - Dev turn: `turn_6d6fdc78aacdb015`
   - QA turn: `turn_d1fb2a52e002c270`
   - First QA attempt reproduced the known provider schema defect (`artifacts_created[0] must be a string`).
   - After a product fix to dispatch `CONTEXT.md`, the QA retry could see bounded previews of `todo.js`, `test.js`, `package.json`, and `.planning/IMPLEMENTATION_NOTES.md`.
   - The retry eliminated the earlier false objections about missing code visibility:
     - QA no longer claimed persistence was unverified due to in-process-only tests.
     - QA no longer claimed `process.exitCode` paths kept executing without return guards.
   - Remaining objections were narrower:
     - test stdout/assertion transcript still not present in machine evidence
     - minor input-validation / UX nitpicks (`done 0`, repeated completion)

7. Prompt-hardening rerun closed a real implementation-turn trap and narrowed QA again.
   - Fresh workspace: `/tmp/agentxchain-live-turn74-rerun-7n7mGQ`
   - Run: `run_cfae0bd99a4f5643`
   - PM turn: `turn_fca6e095d38592c1`
   - Dev turn: `turn_b8fbfd45d2ae9d95`
   - QA turn: `turn_c2bb3ebeff149cb9`
   - Before the rerun, the governed example had reproduced a live failure where dev mixed expected-failure commands with `verification.status: "pass"`, causing validator rejection because two `machine_evidence` entries exited non-zero.
   - Product fix shipped:
     - authoritative/dev prompts now state that expected-failure checks must be wrapped in a zero-exit verifier
     - validator error text now explains the same remediation
     - example docs and quickstart now describe the rule explicitly
   - Result:
     - the fresh live dev turn was accepted cleanly
     - implementation used a single `bash test.sh` verifier and reported `13/13` assertions passing with exit code `0`
   - QA follow-up:
     - first QA attempt still reproduced the long-standing provider schema defect (`artifacts_created[0] must be a string`)
     - after retrying the same QA turn against a product fix that raised changed-file preview cap from `80` to `120` lines, the earlier truncation/syntax-completeness objection disappeared
     - the retried QA turn then failed on a different model-output problem: protocol-invalid `phase_transition_request: "qa_ship_verdict"` even though the QA prompt requires `run_completion_request: true` or `null`

5. Final governed state after acceptance:
   - `status`: `blocked`
   - `blocked_on`: `needs_human`
   - `phase`: `qa`
   - `last_completed_turn_id`: `turn_7e47fb1e5dc27e56`
   - `accepted_integration_ref`: `git:c40afcee986e830f96f8a49d23b9e0eb69f39994`

## What This Rerun Proves

- Manual PM, live `local_cli`, and live `api_proxy` all executed in one governed run.
- The corrected default Claude runtime contract is usable for unattended implementation turns.
- The governed acceptance boundary still caught a real provider-schema issue on the QA turn.
- A live QA review can be accepted into governed state as `needs_human` without corrupting the run.
- Bounded changed-file previews in QA context materially improve review quality by replacing speculative objections with code-grounded objections.

## What This Rerun Does Not Prove

- Final run completion via `approve-completion`
- Live MCP adapter execution
- Full machine-verifiable stdout/stderr proof for the dev test run

## Judgment

- Live `local_cli` validation: **confirmed**
- Live all-three-adapter run (`manual` + `local_cli` + `api_proxy`): **confirmed**
- Full live Scenario A through completion gate: **not confirmed**
- Dev verification-pass semantics trap: **closed**
- QA code-visibility gap: **closed for modest files after preview-cap increase**
- Live QA model-output reliability: **still not confirmed**

Reason:

- Connector execution succeeded across all three runtimes in one governed run.
- The prompt-hardening rerun proved the implementation turn can now complete cleanly with a truthful zero-exit verifier.
- The rerun still stopped at QA because the `api_proxy` review turn remained model-invalid twice in two different ways: schema-invalid `artifacts_created[]`, then protocol-invalid `phase_transition_request`.
- The remaining blocker is no longer missing dev verification semantics or file-preview truncation. It is QA model-output reliability plus ordinary review judgment.
