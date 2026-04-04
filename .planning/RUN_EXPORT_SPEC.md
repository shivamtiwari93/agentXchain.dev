# Run Export Spec

**Status:** shipped
**Slice:** governed audit artifact export
**Created:** Turn 12 — GPT 5.4

## Purpose

Ship a bounded first-party audit export for governed runs.

The command must let an operator produce a single JSON artifact containing the actual repo-native run evidence, not a hand-written summary:

- config
- governed state
- history
- decision ledger
- hook audit and annotations
- dispatch bundle artifacts
- staging artifacts
- intake artifacts when present

This slice exists because "auditable" in `VISION.md` is meaningless if the only proof surface lives scattered across `.agentxchain/` and requires custom scraping.

## Scope Boundary

### In scope

- New top-level command: `agentxchain export`
- Governed projects only
- JSON format only in this slice
- Stdout output by default
- Optional `--output <path>` to write the artifact to disk
- Deterministic snapshot of the governed audit surface under the current project root
- Opportunistic inclusion of `.agentxchain/multirepo/**` if that directory exists under the governed project

### Out of scope

- Tarball or zip export
- Legacy v3 project export
- Pure coordinator-workspace export from `agentxchain-multi.json` roots with no governed `agentxchain.json`
- Planning docs, prompt files, plugin source code, or arbitrary repo files outside the run-audit surface
- Redaction, signing, encryption, or remote upload

## Interface

```bash
agentxchain export [--format json] [--output <path>]
```

### Flags

| Flag | Default | Description |
|------|---------|-------------|
| `--format <format>` | `json` | Export format. Only `json` is accepted in this slice |
| `--output <path>` | stdout | Write the JSON artifact to a file instead of stdout |

## Behavior

### Supported roots

The command succeeds only when run inside a governed project:

- `agentxchain.json` must exist
- the normalized config must resolve to `protocol_mode: "governed"`

Legacy projects must fail clearly instead of exporting partial nonsense.

### Artifact shape

The export artifact is a JSON object with:

- top-level export metadata
- a summary block for fast inspection
- a deterministic `files` map keyed by relative path

Each included file entry contains:

- `format`: `json`, `jsonl`, or `text`
- `bytes`
- `sha256`
- `content_base64`
- `data`

`content_base64` stores the original file bytes so the artifact can re-derive its own digests. Without that, `sha256` is just commentary.

### Included paths

Always include when present:

- `agentxchain.json`
- `.agentxchain/state.json`
- `.agentxchain/history.jsonl`
- `.agentxchain/decision-ledger.jsonl`
- `.agentxchain/hook-audit.jsonl`
- `.agentxchain/hook-annotations.jsonl`
- `.agentxchain/dispatch/**`
- `.agentxchain/staging/**`
- `.agentxchain/transactions/accept/**`
- `.agentxchain/intake/**`

Also include when present:

- `.agentxchain/multirepo/**`

Do not include:

- `.agentxchain/prompts/**`
- `.agentxchain/plugins/**`
- arbitrary project source files

### Determinism

- Included paths are collected in sorted order
- Directory traversal order is stable
- JSON output is pretty-printed
- Missing optional paths are silently skipped
- Original file bytes are preserved in `content_base64` for every entry

### Output behavior

- Without `--output`, the artifact is printed to stdout
- With `--output`, the artifact is written to disk and the command prints a short success message

## Error Cases

1. No governed project found -> fail with a clear operator error
2. Legacy project found -> fail with a clear operator error
3. Unsupported `--format` value -> fail with a clear operator error
4. Malformed included JSON or JSONL file -> fail and identify the bad relative path
5. Output path cannot be written -> fail with the filesystem error

## Acceptance Tests

- AT-EXPORT-001: `agentxchain export --help` shows `--format` and `--output`
- AT-EXPORT-002: `agentxchain export --format json` prints valid JSON for a governed project
- AT-EXPORT-003: the artifact includes config, state, history, decision ledger, dispatch, staging, and hook audit surfaces when present
- AT-EXPORT-004: `.agentxchain/intake/**` and `.agentxchain/multirepo/**` are included when present
- AT-EXPORT-005: `agentxchain export --output <path>` writes the artifact to disk
- AT-EXPORT-006: legacy projects are rejected
- AT-EXPORT-007: unsupported formats are rejected
- AT-EXPORT-008: `/docs/cli` documents `export` in the command map and its flag contract truthfully

## Open Questions

- Whether a later slice should add pure coordinator-workspace export that recursively embeds child repo exports
- Whether a later slice should add archive packaging for easier attachment to tickets and releases
