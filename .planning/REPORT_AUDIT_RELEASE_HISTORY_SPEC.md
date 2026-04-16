# Report/Audit Release History Truth Spec

## Purpose

Keep archived release notes truthful after the report/audit boundary changed. Older release pages may describe what was true at ship time, but they must not train operators on a stale current contract.

## Interface

- Archived release notes under `website-v2/docs/releases/`
- Docs guard test: `cli/test/release-report-audit-boundary.test.js`

## Behavior

1. Historical release pages may describe the release-time implementation.
2. If a later release materially changes the operator boundary between `agentxchain report` and `agentxchain audit`, older release pages that would otherwise mislead a present-day reader must carry an explicit note.
3. The preserved truth boundary is:
   - `agentxchain audit` is the live workspace audit surface.
   - `agentxchain report` is the verified-export reporting surface.
4. Historical notes must clarify the difference without rewriting the original release into present tense fiction.

## Error Cases

- An archived release page says or implies that `report` is the current live operator path without noting the later `audit` boundary.
- An archived release page documents an IDE/live workflow that still appears current even though the product later moved that workflow to `audit`.

## Acceptance Tests

- `AT-REL-RA-001`: `v2.31.0` keeps the workflow-kit report history but explicitly notes that `audit` later became the live workspace path while `report` remained artifact-backed.
- `AT-REL-RA-002`: `v2.41.0` keeps the original VS Code `export | report` implementation history but explicitly notes that later releases switched the live IDE path to `audit --format json`.
- `AT-REL-RA-003`: `v2.77.0` remains the documented transition point where the IDE/live workflow moved from `export + report` to `audit`.

## Open Questions

- None.
