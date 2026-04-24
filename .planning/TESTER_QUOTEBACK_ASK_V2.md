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
   export BUG54_START_TS="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
   echo "BUG54_START_TS=$BUG54_START_TS"
   npx --yes -p agentxchain@2.154.7 -c 'agentxchain run --continuous --vision .planning/VISION.md --max-runs 10 --max-idle-cycles 3 --poll-seconds 5 --triage-approval auto --auto-checkpoint --no-report'
   ```

   Then, from the same `tusq.dev` repo root, paste the current-window events and adapter diagnostics. This deliberately scopes evidence to turns dispatched after `BUG54_START_TS`; do not use a repo-wide `.agentxchain/` grep, because old failed runs can pollute the quote-back:

   ```bash
   npx --yes -p agentxchain@2.154.7 -c "agentxchain events --since \"$BUG54_START_TS\" --type turn_dispatched,turn_start_failed,runtime_spawn_failed,stdout_attach_failed,run_blocked --json --limit 0" || true

   node <<'BUG54_DIAG'
   const fs = require('fs');
   const path = require('path');
   const sinceMs = Date.parse(process.env.BUG54_START_TS || '');
   if (!Number.isFinite(sinceMs)) {
     console.error('BUG54_START_TS is missing or invalid');
     process.exit(1);
   }
   const eventsPath = path.join('.agentxchain', 'events.jsonl');
   const eventLines = fs.existsSync(eventsPath)
     ? fs.readFileSync(eventsPath, 'utf8').split('\n').filter(Boolean)
     : [];
   const turnIds = new Set();
   for (const line of eventLines) {
     try {
       const evt = JSON.parse(line);
       if (Date.parse(evt.timestamp || '') < sinceMs) continue;
       if (evt?.turn?.turn_id) turnIds.add(evt.turn.turn_id);
     } catch {}
   }
   console.log(`Current-window turn ids: ${turnIds.size ? [...turnIds].join(', ') : '(none)'}`);
   const counters = {
     turns_matched: turnIds.size,
     stdout_logs_present: 0,
     stdout_logs_missing: 0,
     spawn_attached_lines: 0,
     first_output_lines: 0,
     startup_watchdog_fired_lines: 0,
     stdout_attach_failed_lines: 0,
     ghost_turn_lines: 0,
   };
   const diagPattern = /\[adapter:diag\] (spawn_attached|first_output|startup_watchdog_fired)\b|stdout_attach_failed|ghost_turn/;
   for (const turnId of turnIds) {
     const logPath = path.join('.agentxchain', 'dispatch', 'turns', turnId, 'stdout.log');
     if (!fs.existsSync(logPath)) {
       counters.stdout_logs_missing += 1;
       console.log(`${logPath}: missing stdout.log`);
       continue;
     }
     counters.stdout_logs_present += 1;
     fs.readFileSync(logPath, 'utf8').split('\n').forEach((line, idx) => {
       if (!diagPattern.test(line)) return;
       console.log(`${logPath}:${idx + 1}:${line}`);
       if (/\[adapter:diag\] spawn_attached\b/.test(line)) counters.spawn_attached_lines += 1;
       if (/\[adapter:diag\] first_output\b/.test(line)) counters.first_output_lines += 1;
       if (/\[adapter:diag\] startup_watchdog_fired\b/.test(line)) counters.startup_watchdog_fired_lines += 1;
       if (/stdout_attach_failed/.test(line)) counters.stdout_attach_failed_lines += 1;
       if (/ghost_turn/.test(line)) counters.ghost_turn_lines += 1;
     });
   }
   console.log(`BUG-54 SUMMARY: ${JSON.stringify(counters)}`);
   BUG54_DIAG
   ```

   The `BUG-54 SUMMARY:` JSON line is the single check. Closure requires
   `turns_matched >= 10` AND
   `stdout_logs_missing: 0, startup_watchdog_fired_lines: 0, stdout_attach_failed_lines: 0, ghost_turn_lines: 0`.
   If `turns_matched < 10`, run the fallback harness below and paste
   both outputs. Non-zero `stdout_logs_missing` means at least one
   event-derived turn has no dispatch stdout log, so the adapter attempt
   cannot be audited and cannot close BUG-54. Zero `spawn_attached_lines`
   and `first_output_lines` while `stdout_logs_present > 0` means the adapter
   log format drifted and the runbook needs updating before closure — quote
   the SUMMARY and stop.

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
   jq '{runtime_id, runtime_type, resolved_command, resolved_args_redacted, prompt_transport, stdin_bytes, watchdog_ms, env_snapshot, command_probe, summary}' /tmp/bug54-latest.json
   jq '.attempts[] | {attempt_index, classification, first_stdout_elapsed_ms, first_stderr_elapsed_ms, watchdog_fired, exit_signal, stdout_bytes, stderr_bytes}' /tmp/bug54-latest.json
   ```

   Paste both fallback `jq` outputs together if you use the fallback path. The first output carries runtime id, resolved command/args, prompt transport, bundle size, watchdog threshold, auth env snapshot (`env_snapshot.auth_env_present`), command probe, and summary counters; the second carries the ten per-attempt timing rows. `prompt_transport` and `env_snapshot.auth_env_present` are the signals for the two remaining BUG-54 root-cause hypotheses (stdin/EPIPE vs auth env not propagating) — missing either field makes the fallback supporting-only evidence insufficient for hypothesis triage. One without the other is incomplete.

   Quote these fields regardless of path:
   - Runtime id and command (e.g., `local-pm`, `local-dev`, `local-qa`).
   - Ten attempted dispatches or ten diagnostic attempts (per-attempt `first_stdout_elapsed_ms` or equivalent adapter timing).
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

When valid quote-back lands for BUG-59 and BUG-54 separately, update `.planning/HUMAN-ROADMAP.md`, record the closure decision in `.planning/DECISIONS.md`, and keep BUG-60 blocked until BUG-59 has literal tester quote-back and BUG-60's own two-agent research/review pre-work is complete. BUG-52's separate shipped-package quote-back landed on `agentxchain@2.154.11`; do not keep BUG-60 gated on V1 anymore.

---

## Why Two Asks Instead Of One

BUG-52 is a command-chain behavioral bug: reproducible on a scratch project in a few minutes, evidence is small and deterministic. BUG-59 needs a real continuous run that hits at least one routine gate and produces ledger rows; BUG-54 needs ten real adapter-path dispatches at realistic bundle sizes. Different tester effort, different scratch-vs-dogfood setup, different failure modes when something is wrong. Splitting the asks lets the tester do BUG-52 in one sitting and BUG-59/BUG-54 in another without mixing evidence that belongs to different fixes.
