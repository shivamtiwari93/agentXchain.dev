# Recovery Report Rendering Spec

## Purpose

When a coordinator enters `blocked` state, the system scaffolds `.agentxchain/multirepo/RECOVERY_REPORT.md` and requires operators to fill it before `multi resume` can succeed (see `RECOVERY_REPORT_CONTRACT_SPEC.md`). However, `agentxchain export` does not include this file in coordinator exports, and `agentxchain report` does not render its content. This means the recovery audit trail is invisible in governance reports — the one place operators are supposed to review coordinator lifecycle evidence.

This spec adds the recovery report to both the export artifact and the rendered governance report.

## Interface

### Export Inclusion

Add `.agentxchain/multirepo/RECOVERY_REPORT.md` to `COORDINATOR_INCLUDED_ROOTS` in `cli/src/lib/export.js`. The file is optional — absent files are silently skipped by `collectPaths()`.

### Report Extraction: `extractRecoveryReportSummary(artifact)`

New function in `cli/src/lib/report.js`:

- Looks for `.agentxchain/multirepo/RECOVERY_REPORT.md` in `artifact.files`
- If absent: returns `null`
- If present: decodes `content_base64`, extracts sections `## Trigger`, `## Impact`, `## Mitigation`, `## Owner`, `## Exit Condition`
- Returns `{ present: true, trigger, impact, mitigation, owner, exit_condition }` with each field as trimmed string content or `null`

### Report Subject Addition

`buildCoordinatorSubject()` adds `recovery_report` field to the returned subject object, placed after `decision_digest` and before `repos`.

### Text Rendering

After the "Coordinator Decisions" section and before "Repo details":

```
Recovery Report:
  Trigger: <content or "n/a">
  Impact: <content or "n/a">
  Mitigation: <content or "n/a">
  Owner: <content or "n/a">
  Exit Condition: <content or "n/a">
```

Only rendered when `recovery_report` is non-null.

### Markdown Rendering

After "## Coordinator Decisions" and before "## Repo Details":

```markdown
## Recovery Report

- **Trigger:** <content>
- **Impact:** <content>
- **Mitigation:** <content>
- **Owner:** <content or "n/a">
- **Exit Condition:** <content or "n/a">
```

Only rendered when `recovery_report` is non-null.

## Acceptance Tests

- AT-RR-RENDER-001: Coordinator export without `RECOVERY_REPORT.md` produces `recovery_report: null` in report subject
- AT-RR-RENDER-002: Coordinator export with `RECOVERY_REPORT.md` produces `recovery_report` object with extracted sections
- AT-RR-RENDER-003: Text format includes "Recovery Report:" section with trigger/impact/mitigation
- AT-RR-RENDER-004: Markdown format includes "## Recovery Report" section with trigger/impact/mitigation
- AT-RR-RENDER-005: Missing optional sections (`## Owner`, `## Exit Condition`) render as "n/a"
- AT-RR-RENDER-006: Spec guard

## Open Questions

None.
