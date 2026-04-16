# Governance Report Spec

**Status:** shipped
**Owner:** GPT 5.4
**Date:** 2026-04-03

## Purpose

Provide a first-class operator command for turning an AgentXchain export artifact into a concise governance summary that can be pasted into pull requests, release notes, audits, and handoff surfaces.

The command exists because `agentxchain export` and `agentxchain verify export` provide machine-proof artifacts, but operators still have to reverse-engineer those JSON payloads to answer basic questions:

- What project or workspace does this artifact describe?
- Is the artifact self-consistent?
- What is the current run or coordinator status?
- How many active turns, decisions, notifications, and staged artifacts exist?
- Which repos are healthy or failing inside a coordinator export?

## Interface

New CLI command:

```bash
agentxchain report [--input <path>|-] [--format text|json|markdown|html]
```

### Flags

| Flag | Default | Meaning |
| --- | --- | --- |
| `--input <path>` | `-` | Read an export artifact from a file, or `-` for stdin |
| `--format <format>` | `text` | Output format: `text`, `json`, `markdown`, or `html` |

## Behavior

### Input boundary

- `report` consumes only export artifacts.
- It does **not** read live repo state directly.
- It reuses the same artifact loading contract as `verify export`.

### Verification requirement

- `report` must internally verify the export artifact before rendering a governance summary.
- If artifact loading fails or the JSON is invalid, the command exits `2`.
- If the export artifact fails self-verification, the command exits `1` and reports verification failures instead of emitting a success summary.
- Only verifier-clean artifacts produce a governance summary and exit `0`.

### Supported artifact kinds

- `agentxchain_run_export`
- `agentxchain_coordinator_export`

For partial coordinator exports where `repos.<repoId>.ok === false`, report must preserve coordinator-level readability and export-health totals while omitting child drill-down fields for the failed repo. A missing embedded child export is not permission to synthesize turns, decisions, gates, hooks, or recovery data.

### Success output: text / markdown / html

The human-readable formats must summarize:

- input source
- export kind
- verification status
- project/workspace identity
- run/coordinator status and phase
- active/retained turn counts for governed exports
- repo/workstream/barrier counts for coordinator exports
- repo status breakdown for coordinator exports
- artifact evidence counts (history, decisions, notifications, hooks, dispatch/staging where applicable)
- blocked state and budget summary when present

`markdown` exists so operators can paste a report into PRs, releases, or tickets without reformatting.
`html` exists so operators can hand off a portable, self-contained governance report with inline CSS, dark mode, and print styles.

### Success output: json

`json` emits a stable operator contract with:

- `report_version`
- `overall`
- `generated_at`
- `input`
- `export_kind`
- `verification`
- `subject`

`subject.kind` is:

- `governed_run` for `agentxchain_run_export`
- `coordinator_workspace` for `agentxchain_coordinator_export`

The JSON payload is intentionally derived from verified export content. It is not a second export format.

### Failure output

#### Command error (`exit 2`)

JSON format:

```json
{
  "overall": "error",
  "input": "stdin",
  "message": "..."
}
```

#### Verification failure (`exit 1`)

JSON format:

```json
{
  "overall": "fail",
  "input": "stdin",
  "message": "Cannot build governance report from invalid export artifact.",
  "verification": {
    "overall": "fail",
    "schema_version": "0.2",
    "export_kind": "agentxchain_run_export",
    "file_count": 12,
    "repo_count": 0,
    "errors": ["summary.status: must match state.status"]
  }
}
```

This preserves the verifier output as the authoritative failure explanation.

## Error Cases

- Unsupported `--format`
- Missing stdin/file input
- Invalid JSON input
- Unsupported or malformed export artifact
- Export artifact that fails integrity or summary verification

## Acceptance Tests

- `AT-REPORT-001`: `report --help` documents `--input` and `--format`.
- `AT-REPORT-002`: governed export produces text summary with project, run status, phase, active/retained turn counts, and verification pass.
- `AT-REPORT-003`: governed export produces markdown summary suitable for paste surfaces.
- `AT-REPORT-004`: governed export produces JSON summary with `report_version`, `verification`, and `subject.kind = governed_run`.
- `AT-REPORT-005`: coordinator export produces repo/workstream/barrier counts and repo status breakdown.
- `AT-REPORT-006`: invalid export artifact fails with exit `1` and surfaces verifier errors instead of a success summary.
- `AT-REPORT-007`: unreadable/invalid input fails with exit `2` and command-error shape.
- `AT-REPORT-008`: docs surface truthfully documents the CLI contract and the stable JSON/markdown/html intent.
- `AT-REPORT-009`: completed coordinator HTML report keeps terminal drift observable without reopening recovery work.
- `AT-REPORT-011`: warn-mode budget state is preserved across text, JSON, markdown, and html report formats.
- `AT-REPORT-012`: partial coordinator exports remain reportable with `repo_ok_count` / `repo_error_count` export-health visibility, and failed child repos keep no drill-down fields because no nested child export exists.

## Open Questions

- Whether a future slice should add machine-friendly diffing between two export artifacts.
- Whether report output should later support a stricter PR-comment profile with redacted raw paths.
