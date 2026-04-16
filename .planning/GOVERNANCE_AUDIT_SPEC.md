# Governance Audit Command Spec

**Status:** shipped
**Owner:** GPT 5.4
**Date:** 2026-04-12

## Purpose

Provide a first-class operator command for auditing the **live** governed project or coordinator workspace without forcing a two-step `export` then `report` workflow.

The repo already had the underlying pieces:

- `agentxchain export` for building a portable audit artifact
- `agentxchain report` for rendering a verified export artifact

What it did **not** have was a direct operator command for the common case: "show me the audit report for the repo I am standing in right now." That gap pushed operators toward ad hoc shell pipelines and made the public command surface weaker than the product's auditability story.

## Interface

New CLI command:

```bash
agentxchain audit [--format text|json|markdown|html]
```

### Flags

| Flag | Default | Meaning |
| --- | --- | --- |
| `--format <format>` | `text` | Output `text`, `json`, `markdown`, or `html` |

## Behavior

### Input boundary

- `audit` reads **live repo state** from the current working directory.
- It supports the same detection boundary as `export`:
  - governed project via `agentxchain.json`
  - coordinator workspace via `agentxchain-multi.json`
- Governed project detection takes priority if both files are present.
- It does **not** accept `--input`; offline artifact inspection remains the job of `report`.

### Internal execution model

- `audit` builds the same export artifact that `agentxchain export` would build for the current directory.
- It then verifies that freshly built artifact and runs the same verification-first report builder that powers `agentxchain report`.
- The rendered output contract matches `report` for the selected format.

### Success output

- `text`, `json`, `markdown`, and `html` output reuse the existing governance report renderer.
- The `input` field or header line is the resolved governed project root or coordinator workspace root instead of a file path or `stdin`.
- Governed audits render the same run-level report contract as `report`.
- Coordinator audits render the same coordinator-workspace report contract as `report`.
- For coordinator workspaces, `summary.repo_run_statuses` remains raw coordinator snapshot metadata only. `subject.run.repo_status_counts` and `subject.run.repo_status_drifts` must use authority-first child repo status when a nested child export or repo-local state is readable.
- Coordinator linkage labels like `linked` / `initialized` may remain visible as metadata, but they must not become primary repo-status truth in `audit`.

### Exit codes

| Exit code | Meaning |
| --- | --- |
| `0` | Audit report rendered successfully |
| `1` | Built export artifact failed self-verification |
| `2` | Command/input error (unsupported format, no governed target, export build failure) |

## Error Cases

- Unsupported `--format`
- No governed project or coordinator workspace found from the current directory
- Governed/coordinator export builder returns an error
- Built export artifact fails self-verification

## Acceptance Tests

- `AT-AUDIT-001`: `audit --help` documents `--format`.
- `AT-AUDIT-002`: governed project audit renders the same human-readable governance report contract directly from live repo state.
- `AT-AUDIT-003`: governed project audit `--format json` returns `subject.kind = governed_run` and a live repo path in `input`.
- `AT-AUDIT-004`: coordinator workspace audit renders `subject.kind = coordinator_workspace`.
- `AT-AUDIT-005`: unsupported format fails closed with exit `2`.
- `AT-AUDIT-006`: running outside a governed project or coordinator workspace fails closed with exit `2`.
- `AT-AUDIT-007`: docs truthfully distinguish `audit` (live repo state, no `--input`, verifies a freshly built artifact) from `report` (verified export artifact inspection of an existing input).
- `AT-AUDIT-012`: governance audit docs treat `html` as a first-class output contract and example path, not an undocumented format token.

## Open Questions

- Whether a future slice should let `audit` persist its derived report to a file explicitly instead of relying on shell redirection.
- Whether a later audit-focused report version should surface more workspace provenance directly in the human-readable output.
