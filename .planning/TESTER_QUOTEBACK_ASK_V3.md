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
mkdir -p /tmp/axc-bug62 && cd /tmp/axc-bug62 && git init -q
git config user.email tester@example.com && git config user.name tester
npx --yes -p agentxchain@2.154.7 agentxchain init --governed --template generic --yes
git add -A && git commit -q -m "scaffold"
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
agentxchain status 2>&1 | grep -iE "drift|HEAD has moved" || echo "NO_DRIFT_LINE"

# Reconcile.
agentxchain reconcile-state --accept-operator-head; echo "exit: $?"

# Durable event.
jq -c 'select(.event_type == "state_reconciled_operator_commits") | {event_type, payload: {previous_baseline: .payload.previous_baseline, accepted_head: .payload.accepted_head, accepted_commits: (.payload.accepted_commits | length), paths_touched: .payload.paths_touched}}' .agentxchain/events.jsonl | tail -3

# Drift clears after reconcile.
agentxchain status 2>&1 | grep -iE "drift|HEAD has moved" || echo "NO_DRIFT_AFTER_RECONCILE"
```

Required shape:
- Drift line before reconcile contains `Git HEAD has moved since checkpoint: <8char> -> <8char>` with the short-SHA of `$BASE` on the left and of `$HEAD_AFTER` on the right.
- Reconcile exits `0` and prints `Reconciled 1 operator commit(s).` plus `Previous baseline:` and `Accepted HEAD:` lines.
- Event row shows `event_type: state_reconciled_operator_commits`, `previous_baseline` equal to `$BASE`, `accepted_head` equal to `$HEAD_AFTER`, `accepted_commits: 1`, and `paths_touched` including `NOTES.md`.
- Post-reconcile drift check prints `NO_DRIFT_AFTER_RECONCILE`.

### Block 2 — negative (operator commit modifies governed state)

```bash
# Simulate an unsafe operator commit on top of the current baseline.
node -e 'const fs=require("fs");const p=".agentxchain/state.json";const s=JSON.parse(fs.readFileSync(p,"utf8"));s.operator_touched=true;fs.writeFileSync(p, JSON.stringify(s, null, 2)+"\n");'
git add .agentxchain/state.json && git commit -q -m "operator: unsafe state edit"

agentxchain reconcile-state --accept-operator-head; echo "exit: $?"
```

Required shape:
- Exit `1`.
- Output begins with `Reconcile refused (governance_state_modified).`
- An `Offending path:` line naming `.agentxchain/state.json`.
- An `Offending commit:` line with a short SHA.

### Block 3 — negative (history rewrite makes baseline a non-ancestor)

```bash
# Rewind to before the state-edit commit, then make an orphan commit so the
# prior accepted_head from Block 1 is no longer an ancestor of HEAD.
git reset --hard "$BASE"
git commit --allow-empty -q -m "operator: rewritten history"

agentxchain reconcile-state --accept-operator-head; echo "exit: $?"
```

Required shape:
- Exit `1`.
- Output contains `Reconcile refused (history_rewrite).`
- Followed by the error line `Cannot reconcile operator HEAD: baseline <8char> is not an ancestor of current HEAD <8char>.`

### Post-test cleanup note

The scratch directory `/tmp/axc-bug62` can be removed after quote-back. Do not attempt to reuse it for other quote-back asks — the rewritten history from Block 3 makes subsequent reconciles unreliable.

---

## Review Rules For Agents

Reject BUG-62 quote-back if:

- Version is lower than `2.154.7`.
- Block 1 drift line does not quote both short-SHAs from `$BASE` and `$HEAD_AFTER`.
- Block 1 reconcile exits non-zero, OR the `state_reconciled_operator_commits` event is missing, OR `paths_touched` does not include `NOTES.md`, OR post-reconcile drift is still reported.
- Block 2 exits `0`, OR the refusal does not name `.agentxchain/state.json`, OR the refusal class is not `governance_state_modified`.
- Block 3 exits `0`, OR the refusal is not `history_rewrite`.
- Any required command is replaced, paraphrased, or summarized rather than pasted verbatim.
- The evidence comes from an unversioned local checkout (e.g., `cd cli && node bin/agentxchain.js …`) rather than the published tarball. Closure requires shipped-package evidence.

When valid quote-back lands, update `.planning/HUMAN-ROADMAP.md` to flip BUG-62 to `- [x]` with completion date + tester-session pointer, record the closure decision in `.planning/DECISIONS.md`, and only then begin the **automatic continuous-mode reconciliation** follow-up work (`reconcile_operator_commits: "auto_safe_only"` — currently still pending per Turn 184 partial-ship note in the BUG-62 HUMAN-ROADMAP entry).

---

## Why A Separate Ask

BUG-52 (V1) is a command-chain behavioral bug provable in a scratch project in minutes. BUG-59/BUG-54 (V2) need a real continuous run on `tusq.dev` with ledger rows and ten adapter-path dispatches. BUG-62 is a **scratch-only reconcile proof**: three short command blocks, no LLM, no continuous session required, but each block produces distinct evidence that cannot be mixed with V1 or V2 output. Splitting keeps each tester sitting bounded and each evidence block unambiguous.
