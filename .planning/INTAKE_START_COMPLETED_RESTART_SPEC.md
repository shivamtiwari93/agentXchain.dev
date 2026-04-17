# Intake Start Completed-Restart Spec

> Narrow additive spec that amends `V3_S3_START_SPEC.md` with an explicit operator surface for restarting intake-driven work after a completed governed run.

---

## Purpose

`startIntent()` already has an internal terminal-restart path used by continuous mode, but the operator-facing `agentxchain intake start` surface does not expose it. That leaves manual intake operators with a dead end after one completed run and, worse, currently points them at a nonexistent `agentxchain init --force` flag.

This slice exposes the truthful public restart surface instead of documenting the dead end better.

---

## Interface

### CLI

```bash
agentxchain intake start --intent <id> [--role <role>] [--restart-completed] [--json]
```

- `--restart-completed` is optional and only matters when governed state is `completed` with no active turns.
- Without `--restart-completed`, completed-state starts still fail closed.

---

## Behavior

1. If governed state is `completed` and `--restart-completed` is not passed, `intake start` must fail with a deterministic recovery message that points to `agentxchain intake start --intent <id> --restart-completed`.
2. If governed state is `completed`, there are no active turns, and `--restart-completed` is passed, `intake start` must:
   - initialize a fresh governed run via the existing terminal-restart path
   - assign the requested or default role into that fresh run
   - transition the planned intent to `executing`
   - record the new `target_run`, `target_turn`, and `started_at`
3. The restarted run must get a new `run_id`. The prior completed run must remain historical only.
4. The restart path must reuse the existing governed-state initializer. No custom state-reset logic is allowed in `intake start`.

---

## Error Cases

1. Completed state without `--restart-completed`: exit 1 with recovery guidance that names the real flag.
2. `--restart-completed` with active turns present: still reject on the existing busy-run rule.
3. `--restart-completed` on non-completed state: no special behavior; existing idle/active/blocked/paused rules still apply.

---

## Acceptance Tests

- `AT-ISR-001`: `intake start` on a completed governed state rejects with recovery guidance that names `--restart-completed`
- `AT-ISR-002`: `intake start --restart-completed` on a completed governed state initializes a fresh run and transitions the intent to `executing`
- `AT-ISR-003`: restarted execution records a new `run_id` distinct from the completed run

---

## Open Questions

None. This slice only exposes the already-existing terminal restart path to operators.
