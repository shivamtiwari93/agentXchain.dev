# Tester Quote-Back Ask V2

Purpose: give the human a copy-pasteable ask for the tester so BUG-59 (approval-policy gate coupling) and BUG-54 (local_cli startup watchdog) can close on real shipped-package evidence instead of agent-side proof.

Use this when asking the tester to re-run BUG-59 and BUG-54 on `agentxchain@2.154.7` or later. The full runbook is `.planning/BUG_59_54_TESTER_QUOTEBACK_RUNBOOK.md`; this is the short message to send.

Companion ask for BUG-52 lives at `.planning/TESTER_QUOTEBACK_ASK_V1.md`.

---

## Copy-Paste Message

Please re-test BUG-59 (approval-policy auto-approval) and BUG-54 (local_cli startup watchdog) on the published package and paste literal command output for the five evidence blocks below.

Target package: `agentxchain@2.154.7` or later. Earlier versions (`2.151.0` through `2.154.5`) carry the BUG-59 coupling and the 180 000 ms BUG-54 watchdog, but a routine continuous session on `tusq.dev` will reproduce the BUG-52 third-variant loop before the approval_policy ledger gets exercised. `2.154.7` is the first published pin that is BUG-52-safe for BUG-59/BUG-54 proof.

Run this preflight from the `tusq.dev` repo root, not from the AgentXchain repo checkout:

```bash
npm uninstall -g agentxchain 2>/dev/null || true
pwd
git rev-parse --show-toplevel
npx --yes -p agentxchain@2.154.7 -c "agentxchain --version"
```

Expected version output: `2.154.7` or a later published patch.

Then use `.planning/BUG_59_54_TESTER_QUOTEBACK_RUNBOOK.md` and paste these exact quote-back blocks:

1. **Package identity** — the `agentxchain --version` output from the preflight above, next to the `pwd` / `git rev-parse --show-toplevel` lines so we can see the run happened on `tusq.dev`.

2. **BUG-59 positive state** — after a real continuous run that clears a routine non-credentialed gate, paste:

   ```bash
   jq '{status, phase, pending_run_completion, blocked_on, last_gate_failure}' .agentxchain/state.json
   ```

   Required shape:

   ```json
   {
     "status": "completed",
     "pending_run_completion": null,
     "blocked_on": null,
     "last_gate_failure": null
   }
   ```

3. **BUG-59 approval_policy ledger rows** — paste the output of:

   ```bash
   jq -c 'select(.type == "approval_policy") | {timestamp, gate_type, gate_id, action, from_phase, to_phase, reason, matched_rule}' .agentxchain/decision-ledger.jsonl
   ```

   At minimum the ledger MUST contain one `gate_type=phase_transition action=auto_approve` row and one `gate_type=run_completion action=auto_approve gate_id=qa_ship_verdict` row, each with `matched_rule.when.credentialed_gate: false` or an equivalent generated non-credentialed guard.

4. **BUG-59 credentialed negative** — run the trap-guarded bash block from `BUG_59_54_TESTER_QUOTEBACK_RUNBOOK.md` section "BUG-59 Credentialed Negative Path" verbatim (mutates `agentxchain.json` to add `gates.qa_ship_verdict.credentialed: true`, runs continuous, then restores the file via `EXIT INT TERM` trap). Paste:
   - The final state JSON from the `jq '{status, phase, pending_run_completion, blocked_on, last_gate_failure}'` line inside the heredoc.
   - The `approval_policy` ledger output from inside the heredoc (it MUST NOT contain any row with `gate_id == "qa_ship_verdict" && action == "auto_approve"`).
   - The `git diff --quiet agentxchain.json` post-check line (silent = clean; any `WARNING:` text means quote it and restore manually before continuing).

5. **BUG-54 ten-dispatch watchdog evidence** — ten real adapter-path dispatches from the shipped `2.154.7` package on your machine.

   **Primary path (dogfood).** Run from the `tusq.dev` repo root:

   ```bash
   npx --yes -p agentxchain@2.154.7 -c 'agentxchain run --continuous --vision .planning/VISION.md --max-runs 10 --max-idle-cycles 3 --poll-seconds 5 --triage-approval auto --auto-checkpoint --no-report'
   ```

   Then, from the same `tusq.dev` repo root, paste the adapter-diagnostic grep (matches zero lines is the success case — `|| true` keeps the exit code clean):

   ```bash
   grep -RInE 'spawn_attached|first_output|startup_watchdog_fired|stdout_attach_failed|ghost_turn' .agentxchain 2>/dev/null || true
   ```

   **Fallback path (no derivable work on `tusq.dev`).** Extract the shipped repro harness from the published tarball and run it from the `tusq.dev` repo root so it auto-discovers the project's `agentxchain.json` runtimes. This mirrors `BUG_59_54_TESTER_QUOTEBACK_RUNBOOK.md` verbatim — if a drift ever appears between the two, the runbook is canonical:

   ```bash
   REPRO_DIR="$(mktemp -d -t agentxchain-bug54-repro.XXXXXX)"
   if ! curl -fsSL https://registry.npmjs.org/agentxchain/-/agentxchain-2.154.7.tgz \
     | tar -xzC "$REPRO_DIR"; then
     echo "Direct registry download failed; retrying through npm pack..." >&2
     TARBALL="$(npm pack agentxchain@2.154.7 --pack-destination "$REPRO_DIR" | tail -n 1)"
     tar -xzf "$REPRO_DIR/$TARBALL" -C "$REPRO_DIR"
   fi
   node "$REPRO_DIR/package/scripts/reproduce-bug-54.mjs" \
     --attempts 10 --watchdog-ms 180000 --out /tmp/bug54-latest.json
   rm -rf "$REPRO_DIR"
   jq '{command_probe, summary}' /tmp/bug54-latest.json
   jq '.attempts[] | {attempt, classification, first_stdout_ms, first_stderr_ms, watchdog_fired, exit_signal, stdout_bytes_total, stderr_bytes_total}' /tmp/bug54-latest.json
   ```

   Quote these fields regardless of path:
   - Runtime id and command (e.g., `local-pm`, `local-dev`, `local-qa`).
   - Ten attempted dispatches or ten diagnostic attempts (per-attempt `first_stdout_ms` or equivalent adapter timing).
   - Every adapter diagnostic line containing `spawn_attached` or `first_output`.
   - Confirmation that NO line contains `startup_watchdog_fired`, `stdout_attach_failed`, or `ghost_turn`.

   The fallback harness alone is supporting timing evidence. Closure still requires ten real adapter-path attempts — if the dogfood run produced fewer than ten, name the `agentxchain run` / `agentxchain step` invocations you attempted so we can tell the BUG-54 closure path from a harness-only proof.

Do not paraphrase the output. BUG-59 and BUG-54 only close if all five blocks are quoted from the same shipped `2.154.7+` install. If any command differs from the runbook, include the exact command you ran.

---

## Review Rules For Agents

Reject BUG-59 positive evidence if:

- Version is lower than `2.151.0`, or is not a published tarball (`2.149.0` was never published; any `2.151.x` is allowed but `2.154.7+` is preferred because earlier pins can hit BUG-52 before producing a ledger row).
- `state.json` reports `status != "completed"` with the auto-approval rows missing.
- The ledger has zero `approval_policy` rows, or every row has `action != "auto_approve"`.
- No row covers `gate_type == "run_completion" && gate_id == "qa_ship_verdict"`.
- The positive auto-approval rows do not show `matched_rule.when.credentialed_gate: false` or an equivalent generated non-credentialed guard. Missing guard evidence is not enough.
- `matched_rule.when.credentialed_gate` is `true` (that's the wrong lane — credentialed hard-stop is the negative case, not the positive case).

Reject BUG-59 credentialed negative if:

- `qa_ship_verdict` completes silently.
- The ledger shows an `auto_approve` row against `qa_ship_verdict` during the credentialed-mutation window.
- `git diff --quiet agentxchain.json` post-check emits the `WARNING:` line and the tester does not then quote a manual restore.

Reject BUG-54 evidence if:

- Fewer than ten adapter-path attempts are quoted.
- The attempts use synthetic sub-KB prompts (bundle must be the real `tusq.dev` dispatch shape or at least 10 KB on the fallback path).
- Any attempt line shows `startup_watchdog_fired: true`.
- Any state/history event shows `stdout_attach_failed` or `ghost_turn` for those ten attempts.
- Watchdog threshold quoted is not `180000` (or higher via explicit override).
- The evidence comes only from the standalone repro harness with no adapter-path attempts at all (harness is supporting timing evidence; closure requires adapter-path proof).

When valid quote-back lands for BUG-59 and BUG-54 separately, update `.planning/HUMAN-ROADMAP.md`, record the closure decision in `.planning/DECISIONS.md`, and only then unlock BUG-60 work (BUG-52 quote-back per `TESTER_QUOTEBACK_ASK_V1.md` is also a precondition for BUG-60).

---

## Why Two Asks Instead Of One

BUG-52 is a command-chain behavioral bug: reproducible on a scratch project in a few minutes, evidence is small and deterministic. BUG-59 needs a real continuous run that hits at least one routine gate and produces ledger rows; BUG-54 needs ten real adapter-path dispatches at realistic bundle sizes. Different tester effort, different scratch-vs-dogfood setup, different failure modes when something is wrong. Splitting the asks lets the tester do BUG-52 in one sitting and BUG-59/BUG-54 in another without mixing evidence that belongs to different fixes.
