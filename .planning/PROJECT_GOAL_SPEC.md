# Project Goal — Spec

> Frozen contract for `project.goal` in `agentxchain.json` and its rendering across governed surfaces.

## Purpose

The dispatch bundle (CONTEXT.md) currently provides the agent with role charter, current state, last turn summary, gate status, and inherited context — but **no project-level mission**. The agent knows *how* it should work (role mandate) and *where* it is (state/phase), but not *what* the project is trying to accomplish.

This is a direct gap against the VISION:
> "The system should be able to take a broad mission, decompose it into governed work…"

Adding `project.goal` gives every dispatched agent clear direction about the project's purpose, enabling more focused decisions and more meaningful challenge.

## Interface

### Config (`agentxchain.json`)

```json
{
  "project": {
    "id": "my-project",
    "name": "My Project",
    "goal": "Build an auth token rotation service with expiry, rollback, and audit logging",
    "default_branch": "main"
  }
}
```

- `project.goal` is an **optional** string field
- When present, must be a non-empty string (trimmed)
- Max length: 500 characters (enough for a focused mission, short enough to keep dispatch bundles tight)
- When absent, no goal renders in dispatch bundles (no default placeholder)

### CLI (`agentxchain init`)

- `agentxchain init --governed --goal "Build X"` sets `project.goal` in the scaffolded config
- If `--goal` is not provided, `project.goal` is omitted from the config

### Dispatch Bundle (CONTEXT.md)

When `project.goal` is present, the CONTEXT.md renders a `## Project Goal` section immediately after `## Current State` and before any inherited context or last-turn summary:

```markdown
## Project Goal

Build an auth token rotation service with expiry, rollback, and audit logging
```

When absent, the section is omitted (no "No goal set" placeholder).

### Status (`agentxchain status`)

- Text output: `Goal: <goal text>` line after project name
- JSON output: `project_goal: "<goal text>"` field (null when absent)

### Report (`agentxchain report`)

- Text/markdown: `Goal: <goal text>` in the report header
- JSON: nested `subject.project.goal: "<goal text>"` field for governed-run reports

### Export (`agentxchain export`)

- `summary.project_goal: "<goal text>"` field in the export summary block

### Demo (`agentxchain demo`)

- The demo config should include a `project.goal` so the demo output demonstrates the goal surface

## Behavior

1. Config validation accepts `project.goal` as an optional string, rejects non-string truthy values, and trims whitespace.
2. Config validation rejects goals exceeding 500 characters.
3. Normalized config preserves `project.goal` when present.
4. `writeDispatchBundle` renders `## Project Goal` in CONTEXT.md when `config.project.goal` is truthy.
5. `statusCommand` includes `project_goal` in JSON and text output.
6. `buildGovernanceReport` includes the goal in governed-run report data at `subject.project.goal`.
7. `buildRunExport` includes `project_goal` in summary.

## Error Cases

- `project.goal` is a number or boolean: validation error "project.goal must be a string"
- `project.goal` is empty string or whitespace-only: validation error "project.goal must be a non-empty string when provided"
- `project.goal` exceeds 500 characters: validation error "project.goal must be 500 characters or fewer"
- `project.goal` absent: no error, no rendering (graceful omission)

## Acceptance Tests

- **AT-PG-001**: Config with `project.goal` validates clean; config without `project.goal` validates clean
- **AT-PG-002**: Config with non-string `project.goal` fails validation with specific error
- **AT-PG-003**: Config with `project.goal` exceeding 500 chars fails validation
- **AT-PG-004**: Dispatch bundle CONTEXT.md includes `## Project Goal` when goal is set
- **AT-PG-005**: Dispatch bundle CONTEXT.md omits `## Project Goal` when goal is absent
- **AT-PG-006**: `status --json` includes `project_goal` field
- **AT-PG-007**: `report --format json` includes `subject.project.goal` for governed-run reports
- **AT-PG-008**: `export` summary includes `project_goal` field

## Non-Scope

- Goal decomposition into tasks/phases (future: goal-driven routing)
- Goal completion assessment (future: post-run goal evaluation)
- Goal mutation during a run (goal is config-level, not run-level state)
- Multi-goal support (one goal per project for v1)

## Decision

- `DEC-PROJECT-GOAL-001`: `project.goal` is an optional config field that renders in dispatch bundles, status, report, and export. It gives agents project-level direction without changing run semantics.
