# Mission Hierarchy Spec

**Status:** shipped

## Purpose

Freeze the first single-repo hierarchy layer above chained governed runs.

AgentXchain already uses **initiative** for multi-repo coordinator orchestration. Reusing that noun inside a single repo would create operator confusion and documentation drift. This spec defines **mission** as the single-repo, multi-chain grouping surface for long-horizon work inside one governed repo.

## Interface

### CLI

```bash
agentxchain mission start --title <text> --goal <text> [--id <mission_id>] [--plan] [--constraint <text>]... [--role-hint <role>]... [--planner-output-file <path>] [--json] [--dir <path>]
agentxchain mission list [--limit <n>] [--json] [--dir <path>]
agentxchain mission show [mission_id] [--json] [--dir <path>]
agentxchain mission attach-chain [chain_id|latest] [--mission <mission_id>] [--json] [--dir <path>]
```

### Repo Artifacts

- Mission directory: `.agentxchain/missions/`
- Mission file: `.agentxchain/missions/<mission_id>.json`

Mission artifact shape:

```json
{
  "mission_id": "mission-governed-release-hardening",
  "title": "Governed release hardening",
  "goal": "Unify release truth and prevent version-surface drift.",
  "status": "active",
  "created_at": "2026-04-17T01:10:00.000Z",
  "updated_at": "2026-04-17T01:10:00.000Z",
  "chain_ids": ["chain-abc12345"]
}
```

## Behavior

1. `mission start` creates a durable repo-local mission artifact.
2. Mission IDs are filesystem-safe slugs. If the operator omits `--id`, the CLI derives one from the title and prefixes it with `mission-`.
3. `mission start --plan` is a convenience layer, not a governance shortcut. It creates the mission first, then generates one `proposed` plan artifact for that same mission using the shipped mission-planning path.
4. `mission start --plan --json` emits a combined payload `{ mission, plan }`. `mission start --json` without `--plan` preserves the original mission-snapshot payload.
5. `--constraint`, `--role-hint`, and `--planner-output-file` on `mission start` apply only when `--plan` is present and are passed through to the mission planner unchanged.
6. `mission show` renders the latest mission by `updated_at` when no ID is supplied.
7. `mission attach-chain` accepts either an explicit chain ID or `latest`.
8. Attached chains remain references to existing chain reports under `.agentxchain/reports/`; the mission file stores IDs, not duplicated report content.
9. Mission summaries derive aggregate proof from attached chains:
   - `chain_count`
   - `total_runs`
   - `total_turns`
   - `latest_chain_id`
   - `latest_terminal_reason`
   - `active_repo_decisions_count`
10. Mission status is derived for operator visibility:
   - `planned` when no chains are attached
   - `needs_attention` when any attached chain ended with `operator_abort`, `parent_validation_failed`, or includes a `blocked` / `failed` run
   - `degraded` when the mission references missing chain reports
   - `progressing` otherwise
11. Mission summaries surface active repo-decision count so cross-chain decision carryover stays visible instead of hidden behind the separate `decisions` command.

## Error Cases

- Starting a mission with an ID that already exists fails closed.
- `mission start --plan` keeps the created mission artifact even if plan generation fails afterward; the command exits non-zero and surfaces that the mission exists but the plan does not.
- `mission show <id>` fails if the mission does not exist.
- `mission attach-chain` fails if there is no latest mission and `--mission` is omitted.
- `mission attach-chain` fails if the referenced chain report does not exist.
- Re-attaching the same chain is idempotent and must not duplicate `chain_ids`.
- Missing or malformed mission files are skipped by `mission list` instead of crashing the whole surface.

## Acceptance Tests

- `AT-MISSION-CLI-001`: CLI registers the `mission` command family and exports the command handlers.
- `AT-MISSION-CLI-002`: `mission start` creates a durable mission artifact with a normalized mission ID.
- `AT-MISSION-CLI-003`: `mission show` without an ID resolves the latest mission and renders aggregate counts.
- `AT-MISSION-CLI-004`: `mission attach-chain latest` binds the newest chain report and surfaces derived run/turn totals.
- `AT-MISSION-CLI-005`: Mission summaries include active repo-decision count for cross-chain carryover visibility.
- `AT-MISSION-CLI-006`: `mission list` sorts newest-first by `updated_at`.
- `AT-MISSION-CLI-007`: Mission command rows are documented in `website-v2/docs/cli.mdx`.
- `AT-MISSION-CLI-009`: `mission start --plan --planner-output-file <path>` creates both the mission artifact and a proposed plan artifact in one command and emits `{ mission, plan }` in JSON mode.
- `AT-MISSION-CLI-010`: `mission start --plan` forwards repeatable `--constraint` and `--role-hint` values into the created plan artifact input.

## Open Questions

- Should future run-chaining support an active mission pointer so new chain reports auto-attach without an explicit `mission attach-chain` step?
- Should missions eventually own explicit success criteria and completion state, or should they remain a lightweight grouping and evidence surface?
