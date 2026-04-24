# Tester Quote-Back Ask V6 (BUG-60)

Purpose: give the human a copy-pasteable ask for the tester so BUG-60 (perpetual continuous idle-expansion policy) can close on real shipped-package evidence instead of agent-side proof.

Use this when asking the tester to exercise `agentxchain run --continuous --on-idle perpetual` on a shipped package version that includes BUG-60. The architecture spec is `.planning/BUG_60_PLAN.md`; the acceptance-path ingestion lives at `cli/src/lib/continuous-run.js:ingestAcceptedIdleExpansion()`; the validator is `cli/src/lib/idle-expansion-result-validator.js`. This ask is self-contained — no separate runbook to follow.

Companion asks:
- BUG-52 third variant: `.planning/TESTER_QUOTEBACK_ASK_V1.md` (historical, BUG-52 closed)
- BUG-59 / BUG-54: `.planning/TESTER_QUOTEBACK_ASK_V2.md`
- BUG-62 reconcile-state: `.planning/TESTER_QUOTEBACK_ASK_V3.md`
- BUG-61 ghost auto-retry: `.planning/TESTER_QUOTEBACK_ASK_V4.md` (historical, BUG-61 closed)
- BUG-53 auto-chain: `.planning/TESTER_QUOTEBACK_ASK_V5_BUG53.md`

BUG-60 is the perpetual idle-expansion feature. It requires that when `--on-idle perpetual` is set and the vision-scan queue goes empty, the continuous loop dispatches a PM idle-expansion turn to synthesize the next governed increment from broader repo sources (VISION, ROADMAP, SYSTEM_SPEC), instead of exiting. The PM produces either a `new_intake_intent` (which the loop ingests and chains into the next run) or a `vision_exhausted` declaration (which cleanly stops the session).

---

## Setup Prelude

This ask bundles its own scratch fixture to avoid baseline-assumption defects. The tester should run these commands in order from a clean shell.

```bash
# 1. Install the shipped package
npm uninstall -g agentxchain 2>/dev/null || true
TARGET_VERSION="2.155.0"   # Update to actual shipped version
npx --yes -p "agentxchain@${TARGET_VERSION}" -c "agentxchain --version"
```

Expected version output: the `$TARGET_VERSION` or a later published patch.

```bash
# 2. Create the scratch fixture
export BUG60_DIR="/tmp/axc-bug60-test"
rm -rf "$BUG60_DIR" && mkdir -p "$BUG60_DIR" && cd "$BUG60_DIR"
git init && git commit --allow-empty -m "init"

# 3. Scaffold a governed project
npx --yes -p "agentxchain@${TARGET_VERSION}" agentxchain init --governed --template full-local-cli

# 4. Seed VISION.md with exactly 3 concrete goals (two derivable + one already done)
cat > .planning/VISION.md << 'VISION_EOF'
# Product Vision

## CLI Help System
Build a --help flag that prints usage for all commands.

## Error Messages
Improve error messages to include actionable recovery suggestions.

## Initial Scaffold
Set up the project structure with package.json and entry point.
VISION_EOF

# 5. Seed ROADMAP.md with supporting context
cat > .planning/ROADMAP.md << 'ROADMAP_EOF'
# Roadmap

## Current
- [ ] CLI help system: --help flag for all commands
- [ ] Error message improvements: actionable recovery text

## Done
- [x] Initial scaffold: package.json, entry point, test harness
ROADMAP_EOF

# 6. Mark the "Initial Scaffold" goal as addressed via a completed intent
mkdir -p .agentxchain/intake
cat > .agentxchain/intake/intent_scaffold_done.json << 'INTENT_EOF'
{
  "intent_id": "intent_scaffold_done",
  "status": "completed",
  "charter": "Initial Scaffold: Set up the project structure with package.json and entry point.",
  "source": "vision_scan",
  "priority": "p1",
  "template": "generic",
  "created_at": "2026-04-20T00:00:00Z"
}
INTENT_EOF

# 7. Configure perpetual mode with auto-approval and tight caps for the test
cat > agentxchain.json << 'CONFIG_EOF'
{
  "project_name": "bug60-test",
  "roles": {
    "pm": { "mandate": "Product manager", "runtime": "local_cli" }
  },
  "runtimes": {
    "local_cli": { "command": "claude", "args": ["-p"], "prompt_transport": "cli_arg" }
  },
  "run_loop": {
    "continuous": {
      "enabled": true,
      "vision_path": ".planning/VISION.md",
      "max_runs": 5,
      "max_idle_cycles": 2,
      "on_idle": "perpetual",
      "triage_approval": "auto",
      "per_session_max_usd": 50,
      "idle_expansion": {
        "sources": [".planning/VISION.md", ".planning/ROADMAP.md"],
        "max_expansions": 3,
        "role": "pm"
      }
    }
  },
  "approval_policy": {
    "rules": [
      { "gate_type": "planning_signoff", "action": "auto_approve", "reason": "test fixture" },
      { "gate_type": "qa_ship_verdict", "action": "auto_approve", "reason": "test fixture" },
      { "gate_type": "launch_ready", "action": "auto_approve", "reason": "test fixture" }
    ]
  }
}
CONFIG_EOF

git add -A && git commit -m "fixture: BUG-60 perpetual idle-expansion test setup"
```

---

## Copy-Paste Message

Please test BUG-60 on the published package and paste literal output for **all three** evidence blocks below. Block 1 proves PM idle-expansion fires and produces a new intake intent when the vision-scan queue is empty. Block 2 proves the session eventually terminates cleanly (either `vision_exhausted` or `vision_expansion_exhausted`). Block 3 is a summary.

Target package: `agentxchain@${TARGET_VERSION}` or later. Earlier versions do not include the `--on-idle perpetual` feature.

```bash
cd "$BUG60_DIR"
export BUG60_START_TS=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
echo "BUG60_START_TS=$BUG60_START_TS"

npx --yes -p "agentxchain@${TARGET_VERSION}" agentxchain run --continuous \
  --vision .planning/VISION.md \
  --on-idle perpetual \
  --max-runs 5 \
  --max-idle-cycles 2 \
  --poll-seconds 5 \
  --triage-approval auto \
  --auto-checkpoint \
  --no-report
```

### Block 1 — positive (PM idle-expansion dispatched, new intake intent ingested)

After the initial vision-scan runs complete and the idle threshold fires, the perpetual branch should dispatch a PM idle-expansion turn. Watch for log lines containing `idle-expansion` or `Idle threshold reached` followed by a PM dispatch.

```bash
# Current-window idle-expansion events
jq -c --arg since "$BUG60_START_TS" 'select((.event_type == "idle_expansion_dispatched" or .event_type == "idle_expansion_ingested" or .event_type == "idle_expansion_malformed") and .timestamp >= $since) | {event_type, timestamp, payload}' .agentxchain/events.jsonl

# If a new intake intent was ingested, show it
jq -c --arg since "$BUG60_START_TS" 'select(.event_type == "idle_expansion_ingested" and .timestamp >= $since) | .payload' .agentxchain/events.jsonl

# Continuous session state showing expansion_iteration > 0
jq '{status, runs_completed, idle_cycles, expansion_iteration, vision_headings_snapshot}' .agentxchain/continuous-session.json
```

Required shape:
- At least one `idle_expansion_dispatched` event with `expansion_iteration >= 1`.
- At least one `idle_expansion_ingested` event if the PM produced a valid `new_intake_intent` result, OR at least one `idle_expansion_malformed` event if the PM output failed validation.
- `continuous-session.json::expansion_iteration >= 1`, proving the perpetual branch fired.
- `vision_headings_snapshot` is a non-null array of strings capturing the VISION.md headings at session start.

### Block 2 — terminal state (vision_exhausted or vision_expansion_exhausted)

Let the same command from Block 1 continue until the session terminates. The expected terminal states are:
- `vision_exhausted` if the PM declared all VISION.md headings complete/deferred/out-of-scope.
- `vision_expansion_exhausted` if `max_expansions` (3) was reached without productive work.
- `session_budget` if budget was hit (unlikely with the test fixture but valid).

Do NOT expect `idle_exit` — that is the bounded-mode terminal. Perpetual mode should never return `idle_exit` because the idle threshold triggers PM expansion instead of exit.

```bash
# Terminal session state
jq '{status, runs_completed, max_runs, idle_cycles, expansion_iteration}' .agentxchain/continuous-session.json

# Vision-exhausted or expansion-exhausted event
jq -c --arg since "$BUG60_START_TS" 'select((.event_type == "vision_exhausted" or .event_type == "vision_expansion_exhausted") and .timestamp >= $since) | {event_type, timestamp}' .agentxchain/events.jsonl
```

Required shape:
- `continuous-session.json::status` is one of `vision_exhausted`, `vision_expansion_exhausted`, or `session_budget`. NOT `idle_exit`, NOT `paused`, NOT `completed` (which means max_runs fired).
- At least one terminal event (`vision_exhausted` or `vision_expansion_exhausted`) in the current window.

### Block 3 — SUMMARY

```bash
jq -s --arg since "$BUG60_START_TS" '{
  idle_expansion_dispatched: map(select(.event_type == "idle_expansion_dispatched" and .timestamp >= $since)) | length,
  idle_expansion_ingested: map(select(.event_type == "idle_expansion_ingested" and .timestamp >= $since)) | length,
  idle_expansion_malformed: map(select(.event_type == "idle_expansion_malformed" and .timestamp >= $since)) | length,
  vision_exhausted: map(select(.event_type == "vision_exhausted" and .timestamp >= $since)) | length,
  vision_expansion_exhausted: map(select(.event_type == "vision_expansion_exhausted" and .timestamp >= $since)) | length,
  run_completed: map(select(.event_type == "run_completed" and .timestamp >= $since)) | length,
  session_continuation: map(select(.event_type == "session_continuation" and .timestamp >= $since)) | length
}' .agentxchain/events.jsonl

jq '{status, runs_completed, expansion_iteration, idle_cycles}' .agentxchain/continuous-session.json
```

Required shape:
- `idle_expansion_dispatched >= 1` — the perpetual branch fired at least once.
- `vision_exhausted + vision_expansion_exhausted >= 1` — the session terminated through a BUG-60 terminal path.
- `expansion_iteration >= 1` in `continuous-session.json`.

---

## Stretch Evidence (optional, not required for closure)

If the session successfully ingested a PM-derived `new_intake_intent` AND that intent started a new run, paste:

```bash
# Show the PM-derived intake intents
ls -la .agentxchain/intake/ | grep -v scaffold_done

# Show session_continuation events (if PM-derived run chained)
jq -c --arg since "$BUG60_START_TS" 'select(.event_type == "session_continuation" and .timestamp >= $since) | {event_type, payload: {previous_run_id: .payload.previous_run_id, next_run_id: .payload.next_run_id, next_objective: .payload.next_objective, trigger: .payload.trigger}}' .agentxchain/events.jsonl
```

This proves the full end-to-end: vision scan exhausts queue -> PM idle-expansion fires -> PM produces new_intake_intent -> intake pipeline ingests it -> next run starts from PM-synthesized work. This is the "2 chained runs where run 2's intent was PM-synthesized on idle" acceptance criterion from HUMAN-ROADMAP.

---

## Review Rules For Agents

Reject BUG-60 quote-back if:

- Version is lower than the BUG-60 release version.
- Evidence comes from a local checkout, unversioned build, or source-tree `node bin/agentxchain.js`.
- No `idle_expansion_dispatched` event appears — the perpetual branch never fired.
- Terminal status is `idle_exit` — that means the bounded exit path ran instead of the perpetual branch, indicating `on_idle: perpetual` was not respected.
- Terminal status is `paused` without a corresponding `idle_human_review_required` event — that is a BUG-53 regression.
- `expansion_iteration` in `continuous-session.json` is 0 or missing — the PM idle-expansion mechanism was never invoked.
- `vision_headings_snapshot` is null or empty — VISION snapshot capture failed at session start.
- Any required command is replaced, paraphrased, or run without `$BUG60_START_TS` scoping.

When valid quote-back lands, update `.planning/HUMAN-ROADMAP.md` to flip BUG-60 to `- [x]` with completion date + tester-session pointer, and only then consider BUG-60 closed.

---

## Why A Separate Ask

BUG-60's evidence lane is distinct from all prior asks:
- BUG-53 (V5) proves bounded auto-chain and clean `idle_exit`. BUG-60 proves perpetual expansion — they exercise different `on_idle` paths.
- BUG-54 (V2) proves adapter reliability. BUG-60 depends on adapters working but tests the continuous loop's perpetual branch, not the adapter.
- BUG-62 (V3) proves operator-commit reconcile. BUG-60 does not involve operator commits.

The fixture is self-contained per the cross-cutting observation in HUMAN-ROADMAP: it bundles its own setup prelude rather than assuming any tester-project baseline.
