# Tester Quote-Back Ask V3

Purpose: give the human a copy-pasteable ask for the tester so BUG-62 (operator-commit reconcile) can close on real shipped-package evidence instead of agent-side proof.

Use this when asking the tester to exercise `agentxchain reconcile-state --accept-operator-head` on `agentxchain@2.154.7` or later. The BUG-62 behavior spec is `.planning/BUG_62_OPERATOR_COMMIT_RECONCILE_SPEC.md`. This ask is self-contained — no separate runbook to follow.

Companion asks:
- BUG-52 third variant: `.planning/TESTER_QUOTEBACK_ASK_V1.md`
- BUG-59 / BUG-54: `.planning/TESTER_QUOTEBACK_ASK_V2.md`

---

## Copy-Paste Message

Please re-test BUG-62 on the published package and paste literal command output for the three evidence blocks below.

Target package: `agentxchain@2.154.7` or later. Earlier versions are not valid for this ask because they predate the BUG-52 third-variant fix set, so a real project checkpoint may not be reachable during setup.

Preflight from a clean shell:

```bash
npm uninstall -g agentxchain 2>/dev/null || true
npx --yes -p agentxchain@2.154.7 -c "agentxchain --version"
```

Expected version output: `2.154.7` or a later published patch.

Then in a scratch directory (do **not** run in `tusq.dev` or any other real project — these cases intentionally create drift):

```bash
rm -rf /tmp/axc-bug62 && mkdir -p /tmp/axc-bug62 && cd /tmp/axc-bug62 && git init -q
git config user.email tester@example.com && git config user.name tester
npx --yes -p agentxchain@2.154.7 agentxchain init --governed --template generic --yes
git add -A && git commit -q -m "scaffold"

# Establish the checkpoint baseline through a real accepted governed turn.
# This is required: reconcile-state refuses with missing_baseline until a
# checkpoint baseline exists through session.json or an accepted integration ref.
npx --yes -p agentxchain@2.154.7 agentxchain step --role pm --poll 1 > /tmp/axc-bug62-step.log 2>&1 &
STEP_PID=$!
node --input-type=module <<'NODE'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
const statePath = '.agentxchain/state.json';
let state;
for (let i = 0; i < 60; i += 1) {
  if (existsSync(statePath)) {
    state = JSON.parse(readFileSync(statePath, 'utf8'));
    if (state.run_id && state.active_turns && Object.keys(state.active_turns).length > 0) break;
  }
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1000);
}
if (!state?.run_id || !state.active_turns || Object.keys(state.active_turns).length === 0) {
  console.error('No active governed turn appeared; step output follows:');
  if (existsSync('/tmp/axc-bug62-step.log')) console.error(readFileSync('/tmp/axc-bug62-step.log', 'utf8'));
  process.exit(1);
}
const turn = Object.values(state.active_turns)[0];
const stagingDir = `.agentxchain/staging/${turn.turn_id}`;
mkdirSync(stagingDir, { recursive: true });
const result = {
  schema_version: '1.0',
  run_id: state.run_id,
  turn_id: turn.turn_id,
  role: turn.assigned_role,
  runtime_id: turn.runtime_id,
  status: 'completed',
  summary: 'BUG-62 baseline turn accepted to establish a real session checkpoint.',
  decisions: [{
    id: 'DEC-BUG62-BASELINE-001',
    category: 'testing',
    statement: 'Create a real accepted governed turn before reconcile-state proof.',
    rationale: 'reconcile-state requires a checkpoint baseline; init-only scratch repos do not have one.'
  }],
  objections: [],
  files_changed: [],
  artifacts_created: [],
  verification: {
    status: 'pass',
    commands: [],
    evidence_summary: 'Baseline-only turn; no product mutation.',
    machine_evidence: []
  },
  artifact: { type: 'review', ref: null },
  proposed_next_role: 'human',
  phase_transition_request: null,
  run_completion_request: false,
  needs_human_reason: null,
  cost: { input_tokens: 0, output_tokens: 0, usd: 0 }
};
writeFileSync(`${stagingDir}/turn-result.json`, `${JSON.stringify(result, null, 2)}\n`);
console.log(`staged baseline turn: ${turn.turn_id}`);
NODE
wait "$STEP_PID"; STEP_EXIT=$?
cat /tmp/axc-bug62-step.log
echo "baseline_step_exit: $STEP_EXIT"
npx --yes -p agentxchain@2.154.7 agentxchain status

# Record the baseline SHA as-checkpointed.
BASE=$(git rev-parse HEAD)
echo "baseline: $BASE"
```

Paste output for these **three evidence blocks**, from the same shell session:

### Block 1 — positive reconcile (safe product commit)

```bash
# Operator commits a product file on top of the baseline.
echo "# manual product note" > NOTES.md
git add NOTES.md && git commit -q -m "operator: add notes"
HEAD_AFTER=$(git rev-parse HEAD)
echo "head_after: $HEAD_AFTER"

# Drift must be visible in status.
npx --yes -p agentxchain@2.154.7 agentxchain status 2>&1 | grep -iE "drift|HEAD has moved" || echo "NO_DRIFT_LINE"

# Reconcile.
npx --yes -p agentxchain@2.154.7 agentxchain reconcile-state --accept-operator-head; echo "exit: $?"

# Durable event.
jq -c 'select(.event_type == "state_reconciled_operator_commits") | {event_type, payload: {previous_baseline: .payload.previous_baseline, accepted_head: .payload.accepted_head, accepted_commits: (.payload.accepted_commits | length), paths_touched: .payload.paths_touched}}' .agentxchain/events.jsonl | tail -3

# Drift clears after reconcile.
npx --yes -p agentxchain@2.154.7 agentxchain status 2>&1 | grep -iE "drift|HEAD has moved" || echo "NO_DRIFT_AFTER_RECONCILE"
```

Required shape:
- Drift line before reconcile contains `Git HEAD has moved since checkpoint: <8char> -> <8char>` with the short-SHA of `$BASE` on the left and of `$HEAD_AFTER` on the right.
- Reconcile exits `0` and prints `Reconciled 1 operator commit(s).` plus `Previous baseline:` and `Accepted HEAD:` lines.
- Event row shows `event_type: state_reconciled_operator_commits`, `previous_baseline` equal to `$BASE`, `accepted_head` equal to `$HEAD_AFTER`, `accepted_commits: 1`, and `paths_touched` including `NOTES.md`.
- Post-reconcile drift check prints `NO_DRIFT_AFTER_RECONCILE`.

### Block 2 — negative (operator commit modifies governed state)

```bash
# Simulate an unsafe operator commit on top of the current baseline.
node --input-type=module <<'NODE'
import { readFileSync, writeFileSync } from 'node:fs';
const path = '.agentxchain/state.json';
const state = JSON.parse(readFileSync(path, 'utf8'));
state.operator_touched = true;
writeFileSync(path, `${JSON.stringify(state, null, 2)}\n`);
NODE
git add -f .agentxchain/state.json && git commit -q -m "operator: unsafe state edit"

npx --yes -p agentxchain@2.154.7 agentxchain reconcile-state --accept-operator-head; echo "exit: $?"
```

Required shape:
- Exit `1`.
- Output begins with `Reconcile refused (governance_state_modified).`
- An `Offending path:` line naming `.agentxchain/state.json`.
- An `Offending commit:` line with a short SHA.

### Block 3 — negative (history rewrite makes baseline a non-ancestor)

```bash
# Rewind to the original scaffold baseline, then make a divergent commit so the
# prior accepted_head from Block 1 is no longer an ancestor of HEAD.
git reset --hard "$BASE"
git commit --allow-empty -q -m "operator: rewritten history"

npx --yes -p agentxchain@2.154.7 agentxchain reconcile-state --accept-operator-head; echo "exit: $?"
```

Required shape:
- Exit `1`.
- Output contains `Reconcile refused (history_rewrite).`
- Followed by the error line `Cannot reconcile operator HEAD: baseline <8char> is not an ancestor of current HEAD <8char>.`

### Post-test cleanup note

The scratch directory `/tmp/axc-bug62` can be removed after quote-back. Do not attempt to reuse it for other quote-back asks — Block 3 intentionally rewrites this scratch repo's history and makes subsequent reconciles unreliable.

---

## Review Rules For Agents

Reject BUG-62 quote-back if:

- Version is lower than `2.154.7`.
- The scratch setup does not show `baseline_step_exit: 0` after a real `npx --yes -p agentxchain@2.154.7 agentxchain step --role pm --poll 1` accepted turn.
- Block 1 drift line does not quote both short-SHAs from `$BASE` and `$HEAD_AFTER`.
- Block 1 reconcile exits non-zero, OR the `state_reconciled_operator_commits` event is missing, OR `paths_touched` does not include `NOTES.md`, OR post-reconcile drift is still reported.
- Block 2 exits `0`, OR the refusal does not name `.agentxchain/state.json`, OR the refusal class is not `governance_state_modified`.
- Block 3 exits `0`, OR the refusal is not `history_rewrite`.
- Any required command is replaced, paraphrased, or summarized rather than pasted verbatim.
- The evidence comes from an unversioned local checkout (e.g., `cd cli && node bin/agentxchain.js …`) rather than the published tarball. Closure requires shipped-package evidence.

When valid quote-back lands, update `.planning/HUMAN-ROADMAP.md` to flip BUG-62 to `- [x]` with completion date + tester-session pointer and record the closure decision in `.planning/DECISIONS.md`. Do **not** treat the automatic reconcile lane as future work here: the `run_loop.continuous.reconcile_operator_commits: "auto_safe_only"` policy, validation, default full-auto promotion, and refusal event mirror already shipped in `agentxchain@2.154.7`. If quote-back exposes a new `auto_safe_only` refusal-class edge case, file it as a narrow BUG-62 follow-up instead of reopening the shipped V3 closure ask.

---

## Why A Separate Ask

BUG-52 (V1) is a command-chain behavioral bug provable in a scratch project in minutes. BUG-59/BUG-54 (V2) need a real continuous run on `tusq.dev` with ledger rows and ten adapter-path dispatches. BUG-62 is a **scratch-only reconcile proof**: three short command blocks, no LLM, no continuous session required, but each block produces distinct evidence that cannot be mixed with V1 or V2 output. Splitting keeps each tester sitting bounded and each evidence block unambiguous.
