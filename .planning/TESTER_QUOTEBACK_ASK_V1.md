# Tester Quote-Back Ask V1

Purpose: give the human a copy-pasteable ask for the tester so BUG-52 can close on real shipped-package evidence instead of agent-side proof.

Use this when asking the tester to re-run the BUG-52 third-variant flow on `agentxchain@2.154.7` or later. The full runbook is `.planning/BUG_52_TESTER_QUOTEBACK_RUNBOOK.md`; this is the short message to send.

---

## Copy-Paste Message

Please re-test BUG-52 third variant on the published package and paste literal command output for the seven fields below.

Target package: `agentxchain@2.154.7` or later. Earlier versions are not valid for this bug because `2.152.0` and `2.154.5` still reproduce the realistic PM `needs_human + proposed_next_role: "human" + phase_transition_request: null` loop.

Run this preflight from a clean shell, not from the AgentXchain repo checkout:

```bash
npm uninstall -g agentxchain 2>/dev/null || true
npx --yes -p agentxchain@2.154.7 -c "agentxchain --version"
```

Expected version output: `2.154.7` or a later patch.

Then use `.planning/BUG_52_TESTER_QUOTEBACK_RUNBOOK.md` and paste these exact quote-back fields:

1. Package identity: the `agentxchain --version` output.
2. Pre-unblock state JSON from `agentxchain status --json`, showing `phase: "planning"`, `planning_signoff: "pending"`, `pending_phase_transition: null`, `last_completed_turn.status: "needs_human"`, `last_completed_turn.proposed_next_role: "human"`, and `last_completed_turn.phase_transition_request: null`.
3. Full `agentxchain unblock "$HESC"` stdout, stderr, and exit code.
4. Immediate post-unblock state JSON, showing `phase: "implementation"`, `planning_signoff: "passed"`, `pending_phase_transition: null`, and exactly one new active `dev` turn.
5. Durable event rows for `phase_entered`, `phase_cleanup`, and `gate_passed`.
6. Ghost-turn check output proving no new `ghost_turn` or `stdout_attach_failed` happened after unblock.
7. Negative counter-case output from a scratch project, proving missing `.planning/PM_SIGNOFF.md` does not get rubber-stamped: `unblock` exits `1`, phase stays `planning`, status stays `blocked`, and `planning_signoff` stays `pending`.

Do not paraphrase the output. BUG-52 only closes if all seven fields are quoted from the same shipped `2.154.7+` install. If any command differs from the runbook, include the exact command you ran.

---

## Review Rules For Agents

Reject quote-back if:

- Version is lower than `2.154.7`.
- Pre-unblock `phase_transition_request` is not `null`.
- Pre-unblock `proposed_next_role` is not `"human"`.
- Post-unblock phase does not advance to `implementation`.
- `planning_signoff` does not become `passed`.
- `phase_cleanup.removed_turn_ids` does not include the prior PM turn.
- The negative counter-case exits `0` or advances the phase.
- Any required field is summarized instead of quoted.

When valid quote-back lands, update `.planning/HUMAN-ROADMAP.md`, record the closure decision in `.planning/DECISIONS.md`, and keep BUG-60 blocked until the separate BUG-59 shipped-package quote-back from `.planning/TESTER_QUOTEBACK_ASK_V2.md` also lands and BUG-60's own two-agent research/review pre-work is complete.
