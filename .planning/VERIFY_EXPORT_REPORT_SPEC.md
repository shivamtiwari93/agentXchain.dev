# Verify Export Report Surface Specification

## Purpose

Document the machine-readable report shape emitted by `agentxchain verify export --format json` so operators building automation around export verification have a documented contract instead of reverse-engineering the CLI output.

## Current State

- `export-schema.mdx` documents the export **artifact** shape fully (schema 0.2, both kinds, file entry contract, summary fields).
- `cli.mdx` documents flags (`--input`, `--format`) and exit codes (0/1/2).
- Neither page documents the **verification report** JSON shape that `--format json` emits.
- The report has two distinct shapes: success/failure (exit 0 or 1) and command-error (exit 2).

## Report Shapes

### Verification Report (exit 0 or 1)

```json
{
  "overall": "pass" | "fail",
  "schema_version": "<version>" | null,
  "export_kind": "<kind>" | null,
  "file_count": <number>,
  "repo_count": <number>,
  "errors": ["<path>: <message>", ...],
  "input": "<path or stdin>"
}
```

- `overall`: `"pass"` when `errors` is empty, `"fail"` otherwise.
- `schema_version`: from the artifact, or `null` if missing.
- `export_kind`: from the artifact, or `null` if missing.
- `file_count`: count of `files` keys in the artifact.
- `repo_count`: count of `repos` keys (coordinator exports), or `0`.
- `errors`: array of structured error strings, each `"<path>: <message>"`.
- `input`: resolved file path or `"stdin"`.

### Command Error Report (exit 2)

```json
{
  "overall": "error",
  "input": "<path or stdin>",
  "message": "<error description>"
}
```

Emitted when the input cannot be read or is not valid JSON.

## Interface

The report shape documentation goes into `export-schema.mdx` under a new "Verification Report Shape" section, because `export-schema.mdx` already documents the verification contract behaviorally. The CLI docs continue to document flags and exit codes only.

## Acceptance Tests

- `AT-VER-REPORT-001`: `export-schema.mdx` documents all verification report fields (`overall`, `schema_version`, `export_kind`, `file_count`, `repo_count`, `errors`, `input`).
- `AT-VER-REPORT-002`: `export-schema.mdx` documents the command-error report shape (`overall: "error"`, `input`, `message`).
- `AT-VER-REPORT-003`: The documented report fields match the actual fields emitted by `verifyExportArtifact()` in `export-verifier.js` and `verifyExportCommand()` in `verify.js`.
- `AT-VER-REPORT-004`: The guard builds a real export, verifies it, and confirms the report keys match the documented set.

## Open Questions

None. The report shape is stable and already enforced by exit-code tests.
