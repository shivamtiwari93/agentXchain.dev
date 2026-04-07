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

8. Review-artifact truth rerun closed the remaining product-output lie in the QA path.
   - Fresh QA-only workspace: `/tmp/agentxchain-live-turn76-qa-3bDl33`
   - Based on the accepted pre-QA commit from the fresh live rerun (`b83cabf`) with the updated QA prompt synced in
   - QA turn: `turn_fd7f82248d8562b3`
   - Product fixes shipped before this rerun:
     - `api_proxy` review prompts now explicitly forbid claiming `.planning/*` writes the runtime cannot perform
     - accepted `api_proxy` review turns now get a real derived review artifact at `.agentxchain/reviews/<turn_id>-<role>-review.md`
     - review-only turns now fail closed if they claim phantom `.planning/*` or `.agentxchain/reviews/*` writes
   - Result:
     - QA accepted cleanly as `needs_human`
     - no schema failure
     - no invalid `phase_transition_request`
     - no false claim that `.planning/acceptance-matrix.md`, `.planning/ship-verdict.md`, or `.planning/RELEASE_NOTES.md` were created by `api_proxy`
     - derived review artifact was materialized on disk at `.agentxchain/reviews/turn_fd7f82248d8562b3-qa-review.md`
   - Remaining objections were ordinary review judgment:
     - QA cannot independently execute `bash test.sh` from `api_proxy`
     - gate-file contents were not surfaced in context
     - minor test-design concerns

9. Live retained-QA recovery and follow-up implementation rerun exposed the next real blocker.
   - Fresh workspace: `/tmp/agentxchain-live-turn78-Nk27zX`
   - Run: `run_91f4ba5d54707a7e`
   - PM turn: `turn_9cd5b49e9882716f`
   - First dev turn: `turn_90a683e0979e2657`
   - QA turn: `turn_cd88863ae5a8619e`
   - Follow-up dev turn: `turn_1b22674c77374e55`
   - Product work shipped during this rerun:
     - manual seed of real QA gate-file content from observed evidence so the later QA path would not be reviewing placeholders
     - `TURN_RESULT_STATUS_OMISSION_SPEC.md`
     - validator normalization that infers missing `status` only for unambiguous cases:
       - `needs_human_reason` -> `needs_human`
       - `phase_transition_request` or `run_completion_request: true` -> `completed`
   - Result:
     - the live `api_proxy` QA payload was structurally coherent but omitted top-level `status`, causing schema rejection before product fix
     - the exact retained staged QA result was accepted after the normalization patch with no manual JSON edits
     - that accepted QA review raised four non-blocking objections and requested `phase_transition_request: "qa"`
     - a follow-up live dev turn addressed all four objections:
       - IDs now use `max(existing IDs) + 1`
       - `todo.js` now stores next to `__dirname`, not `process.cwd()`
       - corrupt-JSON and non-array-JSON paths are covered by machine-evidenced tests
       - `todo.js` is executable
       - `node test.js` now passes `28/28`
   - Remaining blocker at that point:
     - the run still did **not** advance into the `qa` phase because both live dev turns omitted `phase_transition_request: "qa"` even after satisfying the implementation gate
     - this meant the final-phase QA gate-file preview contract was still unproven live

10. Phase-aware prompt guidance closed the implementation -> qa gap and exercised final-phase QA review live.
   - Same workspace retained: `/tmp/agentxchain-live-turn78-Nk27zX`
   - Run: `run_91f4ba5d54707a7e`
   - Clean-baseline commit before rerun: `adfb6bd` (`Accept retained live rerun implementation fixes`)
   - Verification-only dev turn: `turn_34b01846000101a2`
   - Final-phase QA turn: `turn_8fa2ffe2abc2f3b0`
   - Result:
     - after the prompt change, a fresh live `dev` turn re-ran `node test.js`, repeated the cross-directory check, and explicitly requested `phase_transition_request: "qa"`
     - governed state advanced to `phase: "qa"` with `implementation_complete: "passed"`
     - the live terminal-phase `api_proxy` QA turn accepted as `needs_human`
     - the accepted QA review explicitly cited stale `24 passed` evidence in both `.planning/acceptance-matrix.md` and `.planning/RELEASE_NOTES.md`, which proves the gate-file previews were visible in final-phase `CONTEXT.md`
     - the QA review also confirmed:
       - all five acceptance criteria are documented as passing
       - `.planning/acceptance-matrix.md`, `.planning/ship-verdict.md`, and `.planning/RELEASE_NOTES.md` are present and substantive
       - ship verdict remains YES with no open blockers for the scoped MVP
   - New blocker exposed at that point:
     - terminal-phase QA still chose `status: "needs_human"` instead of `run_completion_request: true`
     - this left final-phase review semantics proven live, but the `pending_run_completion` -> `approve-completion` path still unproven

11. Terminal completion-signaling rerun closed the last live completion gap.
   - Same workspace retained: `/tmp/agentxchain-live-turn78-Nk27zX`
   - Same run: `run_91f4ba5d54707a7e`
   - Retried terminal QA turn: `turn_9710c088069f0ff2`
   - Product fixes shipped before this rerun:
     - terminal review-only prompt now explicitly distinguishes:
       - ship-ready verdict -> `status: "completed"` + `run_completion_request: true`
       - real blocker -> `status: "needs_human"`
       - "Do NOT use `needs_human` to mean human should approve the release"
     - normalization Rule 3 now safely recovers the predictable drift where terminal review-only QA says "human should approve" via `needs_human` instead of the governed completion signal
   - Result:
     - the retained run reactivated from the old blocked-human path and dispatched a fresh terminal QA turn
     - accepted QA turn `turn_9710c088069f0ff2` completed cleanly and requested run completion
     - governed state entered:
       - `status: "paused"`
       - `blocked_on: "human_approval:qa_ship_verdict"`
       - `pending_run_completion.gate: "qa_ship_verdict"`
     - operator action `agentxchain approve-completion` then completed the run successfully
     - run completed at `2026-04-07T11:14:16.734Z`

12. Final governed state after live completion approval:
   - `status`: `completed`
   - `phase`: `qa`
   - `completed_at`: `2026-04-07T11:14:16.734Z`
   - `last_completed_turn_id`: `turn_9710c088069f0ff2`
   - `accepted_integration_ref`: `git:adfb6bd79173c2ff91c0856fd6a9b490db978e12`

## What This Rerun Proves

- Manual PM, live `local_cli`, and live `api_proxy` all executed in one governed run.
- The corrected default Claude runtime contract is usable for unattended implementation turns.
- The governed acceptance boundary still caught a real provider-schema issue on the QA turn.
- A live QA review can be accepted into governed state as `needs_human` without corrupting the run.
- Bounded changed-file previews in QA context materially improve review quality by replacing speculative objections with code-grounded objections.
- The `api_proxy` QA path now accepts without schema drift or gate-name drift and materializes a real review artifact instead of recording a missing one.
- The product now tells the truth that `api_proxy` review turns do not directly author `.planning/*` gate files.
- A retained live `api_proxy` QA turn can now recover from a missing top-level `status` field when the payload already contains an unambiguous `phase_transition_request` or `run_completion_request`.
- A follow-up live dev turn can resolve the concrete QA objections around ID assignment, cwd-relative storage, and missing negative-case machine evidence.
- A later live dev verification turn can now advance the run from `implementation` to `qa` by explicitly setting `phase_transition_request: "qa"` after satisfying `implementation_complete`.
- Final-phase (`qa`) gate-file preview semantics are now proven live:
  - the terminal QA review referenced stale `24 passed` text from `.planning/acceptance-matrix.md`
  - the same review referenced stale `24 passed` text from `.planning/RELEASE_NOTES.md`
  - those objections only exist if the gate-file contents were actually surfaced in `CONTEXT.md`
- A later fresh terminal QA turn can now request governed completion truthfully:
  - accepted `qa` turn `turn_9710c088069f0ff2` entered `pending_run_completion`
  - the run paused on `human_approval:qa_ship_verdict`
  - `agentxchain approve-completion` then completed the run
- Full live governed completion is now proven for the `manual` + `local_cli` + `api_proxy` path.

## What This Rerun Does Not Prove

- Live MCP adapter execution
- Full machine-verifiable stdout/stderr proof for the dev test run
- Independent QA execution of the dev test suite from the `api_proxy` runtime

## Judgment

- Live `local_cli` validation: **confirmed**
- Live all-three-adapter run (`manual` + `local_cli` + `api_proxy`): **confirmed**
- Full live Scenario A through completion gate: **confirmed**
- Dev verification-pass semantics trap: **closed**
- QA code-visibility gap: **closed for modest files after preview-cap increase**
- Live QA model-output reliability: **confirmed for the two previously failing defect classes**
- Review-artifact truth for `api_proxy` QA: **confirmed**
- Missing-status recovery for coherent `api_proxy` review payloads: **confirmed**
- Live implementation -> qa phase transition intent from dev output: **confirmed**
- Final-phase (`qa`) gate-file preview semantics in live review context: **confirmed**
- Live `approve-completion` path from terminal QA output: **confirmed**

Reason:

- Connector execution succeeded across all three runtimes in one governed run.
- The prompt-hardening rerun proved the implementation turn can now complete cleanly with a truthful zero-exit verifier.
- A later QA-only rerun confirmed that those two previously failing `api_proxy` defects are now handled: the accepted turn neither drifted `artifacts_created[]` nor used the exit gate as a phase name, and the review artifact was actually materialized on disk.
- A later retained-QA rerun confirmed that a third `api_proxy` output defect is now handled narrowly and truthfully: when the provider omits top-level `status` but still supplies an explicit forward-progress signal (`phase_transition_request` or `run_completion_request`), the acceptance boundary recovers that intent without manual JSON editing.
- A final retained dev verification turn then proved the implementation -> qa transition path live: the accepted turn set `phase_transition_request: "qa"` and the governed state advanced to `phase: "qa"` with `implementation_complete: "passed"`.
- The subsequent final-phase QA turn proved the review-context fix where it matters most: the accepted objections quoted stale `24 passed` evidence in `.planning/acceptance-matrix.md` and `.planning/RELEASE_NOTES.md`, which only appears if gate-file previews are present in terminal-phase `CONTEXT.md`.
- A final retained terminal QA rerun then proved the completion-signaling fix live: accepted turn `turn_9710c088069f0ff2` requested run completion, the run entered `pending_run_completion`, and explicit human approval via `agentxchain approve-completion` completed the governed run.
