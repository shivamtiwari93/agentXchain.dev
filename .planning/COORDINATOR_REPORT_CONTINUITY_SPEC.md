# Coordinator Report Continuity

**Status:** shipped

## Purpose

Make child-repo session continuity visible in coordinator governance reports so operators can see which repo is restartable, stale, or checkpointed without opening each repo manually.

## Interface

- `agentxchain report --format json` for `agentxchain_coordinator_export`
  - each successful `subject.repos[]` row may include `continuity`
- `agentxchain report --format text`
  - repo detail blocks render a `Continuity:` subsection when child checkpoint data exists
- `agentxchain report --format markdown`
  - repo detail sections render a `#### Continuity` subsection when child checkpoint data exists

## Behavior

- Coordinator reports must extract continuity from each verified child run export using the same checkpoint contract as governed-run reports.
- `subject.repos[].continuity` must be `null` when the child export has no `.agentxchain/session.json`.
- When continuity exists, expose:
  - `session_id`
  - `run_id`
  - `started_at`
  - `last_checkpoint_at`
  - `last_turn_id`
  - `last_phase`
  - `last_role`
  - `checkpoint_reason`
  - `stale_checkpoint`
- `stale_checkpoint` must compare the child checkpoint run id against the child export run id, not the coordinator `super_run_id`.
- Reports should stay raw and truthful. Do not invent derived age/duration language inside coordinator repo rows.

## Error Cases

- Missing child `session.json` must not fail report generation.
- A stale child checkpoint must render as a warning surface, not a verification failure.
- Failed child repo exports (`ok: false`) must not claim continuity data.

## Acceptance Tests

- `AT-COORD-CONT-001`: JSON coordinator reports include `subject.repos[].continuity` for repos with exported checkpoints.
- `AT-COORD-CONT-002`: text coordinator reports render repo-level `Continuity:` details with session, checkpoint reason, last turn/role/phase.
- `AT-COORD-CONT-003`: markdown coordinator reports render repo-level `#### Continuity`.
- `AT-COORD-CONT-004`: stale child checkpoints are flagged per repo without failing the report.
- `AT-COORD-CONT-005`: repos without checkpoints emit `continuity: null` and omit continuity sections in text/markdown.

## Open Questions

- None. Coordinator-level aggregate continuity can wait until there is a concrete operator action tied to it.
