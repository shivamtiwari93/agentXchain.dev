# Export Verification Spec

**Status:** shipped
**Slice:** audit artifact verification
**Created:** Turn 14 — GPT 5.4

## Purpose

Ship a machine-verifiable proof step for `agentxchain export`.

Export artifacts now carry hashes. That is only meaningful if the artifact also carries the original bytes needed to re-derive those hashes. This slice closes that gap by:

- hardening the export schema so each file entry includes `content_base64`
- adding `agentxchain verify export`
- checking both file integrity and summary consistency for run and coordinator exports

## Interface

```bash
agentxchain verify export [--input <path>|-] [--format text|json]
```

### Flags

| Flag | Default | Description |
|------|---------|-------------|
| `--input <path>` | `-` | Export artifact path, or `-` to read JSON from stdin |
| `--format <format>` | `text` | Output format: `text` or `json` |

## Behavior

### Supported schema

- This verifier accepts export artifacts with `schema_version: "0.2"`
- Each file entry must include:
  - `format`
  - `bytes`
  - `sha256`
  - `content_base64`
  - `data`

### File-entry verification

For every exported file entry:

1. Decode `content_base64`
2. Recompute `bytes`
3. Recompute `sha256`
4. Verify that decoded content matches `data`
   - `json` -> `JSON.parse(raw)` deep-equals `data`
   - `jsonl` -> parsed line array deep-equals `data`
   - `text` -> raw UTF-8 string equals `data`

### Run export verification

For `agentxchain_run_export`, the verifier checks:

- `config` matches `files["agentxchain.json"].data`
- `state` matches `files[".agentxchain/state.json"].data`
- summary counts and booleans match the exported file set
- active and retained turn IDs match the exported state

### Coordinator export verification

For `agentxchain_coordinator_export`, the verifier checks:

- `config` matches `files["agentxchain-multi.json"].data`
- summary fields match `.agentxchain/multirepo/state.json` and `barriers.json` when present
- when `summary.aggregated_events` is present, it matches the reconstructed child-repo `events.jsonl` content from embedded successful repo exports
- coordinator summaries fail closed if they claim aggregated events for `repos.<id>.ok === false`, because the artifact does not contain nested proof for that repo
- embedded child repo exports recursively verify when `repos[id].ok === true`
- failed child repo entries require a non-empty `error` string

### Exit semantics

- `0` -> verification passed
- `1` -> artifact parsed but failed integrity or structural verification
- `2` -> command/input error (missing input, unreadable file, invalid JSON)

## Error Cases

1. No `--input` and no stdin pipe -> exit `2`
2. Input file unreadable -> exit `2`
3. Input is not valid JSON -> exit `2`
4. Unsupported `schema_version` -> exit `1`
5. File entry hash, byte count, or content mismatch -> exit `1`
6. Run or coordinator summary drift -> exit `1`
7. Embedded child export invalid -> exit `1`

## Acceptance Tests

- `AT-VERIFY-EXPORT-001`: `agentxchain verify export --help` shows `--input` and `--format`
- `AT-VERIFY-EXPORT-002`: a valid governed run export verifies successfully from a file
- `AT-VERIFY-EXPORT-003`: a valid coordinator export verifies successfully and recursively verifies child exports
- `AT-VERIFY-EXPORT-004`: tampering with `content_base64` or `sha256` causes verification failure
- `AT-VERIFY-EXPORT-005`: summary drift causes verification failure
- `AT-VERIFY-EXPORT-006`: invalid JSON input fails with exit code `2`
- `AT-VERIFY-EXPORT-007`: stdin input is supported via `agentxchain export | agentxchain verify export`
- `AT-VERIFY-EXPORT-008`: coordinator `summary.aggregated_events` count drift fails verification
- `AT-VERIFY-EXPORT-009`: coordinator `summary.aggregated_events.events` order drift fails verification
- `AT-VERIFY-EXPORT-010`: coordinator export fails verification when aggregated events claim a failed child repo
- `AT-VERIFY-EXPORT-011`: `/docs/cli` documents `verify export` and the `content_base64` integrity contract truthfully

## Open Questions

None in this slice. Signing, detached attestations, and archive packaging remain future work.
