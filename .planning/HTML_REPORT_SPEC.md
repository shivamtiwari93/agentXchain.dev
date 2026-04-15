# HTML Governance Report — Spec

## Purpose

Add `--format html` to `agentxchain report` that renders a self-contained, portable HTML governance report from an export artifact. Target audience: enterprise compliance stakeholders, auditors, and managers who cannot consume JSON or terminal text.

## Interface

```bash
# Pipe from export
agentxchain export | agentxchain report --format html > report.html

# From file
agentxchain report --input export.json --format html > report.html
```

## Behavior

1. `formatGovernanceReportHtml(report)` takes the same report object as `formatGovernanceReportText()` and `formatGovernanceReportMarkdown()`.
2. Returns a complete, self-contained HTML string with inline CSS (no external dependencies).
3. Supports both `governed_run` and `coordinator` report subjects.
4. Error and fail states render minimal diagnostic HTML.

## Design

- Single HTML file, no external assets
- Dark/light mode via `prefers-color-scheme`
- Clean, professional typography (system font stack)
- Tables for structured data (turns, costs, gates, decisions)
- Status badges for pass/fail/error/blocked states
- Collapsible sections for long content
- Print-friendly via `@media print`
- AgentXchain branding (header with product name + version)

## Error Cases

- Missing or invalid report object → minimal error HTML
- Empty sections → omitted (same behavior as markdown format)

## Acceptance Tests

1. `agentxchain report --format html` accepts the format option and outputs HTML
2. Output starts with `<!DOCTYPE html>` and contains `<html`
3. Contains the report title "AgentXchain Governance Report"
4. Error reports render error status
5. Fail reports render verification errors
6. Governed run reports render project, run, turn timeline, decisions, gates
7. Coordinator reports render workspace, barriers, repo details
8. Cost summary renders with role/phase tables
9. Delegation summary renders with chain details
10. Repo decisions section renders
11. Self-contained (no external CSS/JS references)

## Open Questions

None — this is a rendering format addition to an existing report pipeline.
