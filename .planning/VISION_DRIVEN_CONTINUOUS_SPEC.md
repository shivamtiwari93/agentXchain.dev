# Vision-Driven Continuous Mode — Spec

> `DEC-VISION-CONTINUOUS-001`

## Purpose

Enable AgentXchain to run in a mode where the only human-supplied input is a project-relative `VISION.md`, and the agent fleet continues driving work forward toward that vision indefinitely without per-turn human intervention.

## Critical Scope Separation

VISION.md is a **project-relative artifact**, not a hard-coded path:

- **This repo's VISION.md** — human-owned vision for agentXchain the product
- **Downstream project VISION.md** — any future project that adopts agentxchain for governed delivery

The `--vision` flag accepts an absolute or project-relative path, resolved against the governed project's root. The vision-reader module operates on the provided path, never reaches back to the agentxchain.dev repo.

## Interface

```
agentxchain run --continuous --vision <path> [--max-runs N] [--auto-approve] [--poll-seconds N] [--max-idle-cycles N]
```

### Flags

| Flag | Default | Description |
|------|---------|-------------|
| `--continuous` | false | Enable continuous vision-driven loop |
| `--vision <path>` | `.planning/VISION.md` | Path to VISION.md (project-relative or absolute) |
| `--max-runs` | 100 | Maximum consecutive governed runs before stopping |
| `--auto-approve` | false | Auto-approve gates (required for lights-out) |
| `--poll-seconds` | 30 | Seconds between idle-detection cycles |
| `--max-idle-cycles` | 3 | Stop after N consecutive idle cycles with no derivable work |

### Config

```json
{
  "run_loop": {
    "continuous": {
      "enabled": false,
      "vision_path": ".planning/VISION.md",
      "max_runs": 100,
      "poll_seconds": 30,
      "max_idle_cycles": 3,
      "triage_approval": "auto"
    }
  }
}
```

`triage_approval`: `"auto"` (default) or `"human"`. When `"auto"`, vision-derived intents are auto-approved through the intake pipeline. When `"human"`, they are left in `triaged` status for operator review.

## Behavior

### Session Lifecycle

1. **Start**: Validate `--vision` path exists and is readable. Fail closed with clear error if missing.
2. **Loop iteration**:
   a. Check for pending approved/planned intents in the intake queue. If found, start next run from queue.
   b. If queue empty, run **vision scan**: parse VISION.md sections, compare against completed intents/runs, derive candidate work.
   c. If vision scan produces candidates, record → triage → approve (if auto) through the existing intake pipeline.
   d. Before each governed run, the loop must consume the target intent through the real intake lifecycle:
      - `approved` → `planIntent()`
      - `planned` → `startIntent()`
      - `executing` → continue the already-started run
   e. After the run completes, the loop must call `resolveIntent()` so the intake artifact lands in `completed` or `blocked` instead of lingering in `approved`/`executing`.
   f. If no candidates (vision fully satisfied or unable to derive work), increment idle counter.
   g. Loop back to step 2.
3. **Terminal conditions** (any one stops the loop):
   - `max_runs` reached → exit 0
   - `max_idle_cycles` consecutive idle cycles → exit 0
   - SIGINT/SIGTERM → clean shutdown, exit 0
   - Run blocked on human escalation (`needs_human`) → pause, escalate, wait for `agentxchain unblock` (if `triage_approval: auto`)
   - Approval gate pause (if `requires_human_approval: true` gates exist and `--auto-approve` not set) → pause, wait for operator
4. **Stop**: `agentxchain stop` or Ctrl+C stops the loop cleanly.

### Vision Reader

The vision reader is a structured markdown parser. It:

1. Reads the VISION.md file
2. Extracts top-level sections (H2 headings) as vision areas
3. For each area, extracts bullet points as individual vision goals
4. Compares goals against existing evidence:
   - Completed intents in `.agentxchain/intake/intents/`
   - Run history in `.agentxchain/history.jsonl`
   - Decision ledger entries in `.agentxchain/decision-ledger.jsonl`
   - Existing code/docs artifacts (by keyword match against signal descriptions)
5. Produces a ranked list of **unaddressed** vision goals as candidate intents

The vision reader does NOT modify VISION.md. It is read-only.

### Provenance

Every vision-derived run must trace back to a specific vision section:

```json
{
  "trigger": "vision_scan",
  "intake_intent_id": "intent_...",
  "created_by": "continuous_loop",
  "trigger_reason": "Core Thesis: explicit decision history"
}
```

### Continuous Session State

Persisted to `.agentxchain/continuous-session.json`:

```json
{
  "session_id": "cont-<uuid>",
  "started_at": "ISO",
  "vision_path": ".planning/VISION.md",
  "runs_completed": 3,
  "max_runs": 100,
  "idle_cycles": 0,
  "max_idle_cycles": 3,
  "current_run_id": "run-xyz",
  "current_vision_objective": "explicit decision history",
  "status": "running|idle|paused|stopped|completed"
}
```

`agentxchain status` reads this file and shows the continuous session and current vision-derived objective.

## Error Cases

1. **VISION.md missing**: Exit 1 with error pointing user to create one. No bundled fallback.
2. **VISION.md empty/unparseable**: Exit 1 with "VISION.md has no extractable sections."
3. **All vision goals satisfied**: Exit 0 after `max_idle_cycles` with "All vision goals appear addressed."
4. **Run blocked on human**: Pause session, escalate via `ensureHumanEscalation()`, resume on `unblock`.
5. **Intake pipeline failure**: Log error, skip candidate, continue to next.
6. **SIGINT during run**: Let current run finish its turn, then stop loop.

## Acceptance Tests

- `AT-VCONT-001`: Launch `agentxchain run --continuous --vision <temp-project>/.planning/VISION.md --max-runs 3` in a temp governed project with runnable mock runtimes. Observe 3 consecutive governed runs complete without human input. Verify each run-history entry carries `trigger: "vision_scan"`, `created_by: "continuous_loop"`, and an `intake_intent_id`.
- `AT-VCONT-002`: Launch with all vision goals already addressed (intake has matching completed intents). Observe idle → idle → idle → exit with "All vision goals appear addressed."
- `AT-VCONT-003`: Verify VISION.md missing exits with clear error, never falls back to bundled file.
- `AT-VCONT-004`: Verify `agentxchain status` shows continuous session and current vision objective.
- `AT-VCONT-005`: Verify provenance on each vision-derived run contains `trigger: "vision_scan"` and `vision_section`.
- `AT-VCONT-006`: `--max-runs 2` stops after exactly 2 runs.
- `AT-VCONT-007`: SIGINT stops the loop cleanly (exit 0, not crash).
- `AT-VCONT-008`: Verify vision path is project-relative, not hardcoded to agentxchain.dev's VISION.md. Run from a different temp dir with its own VISION.md.
- `AT-VCONT-009`: Verify `triage_approval: "human"` leaves derived intents in `triaged` status instead of auto-approving.
- `AT-VCONT-010`: Verify each vision-derived intake intent is resolved to `completed` (or `blocked` on failure) after its governed run, rather than lingering in `approved` or `executing`.

## Open Questions

None. This is the smallest vertical slice of HUMAN-ROADMAP item 1. Future work:
- Mission auto-promotion from large vision goals
- Multi-repo vision coordination
- Adaptive backlog prioritization based on run outcomes
