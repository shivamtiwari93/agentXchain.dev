# Protocol Version Surface Spec

## Purpose

Stop operator-facing CLI surfaces from conflating three different version axes:

- protocol version (`v6`)
- governed config generation (`v4`)
- governed config schema (`1.0`)

This slice does **not** add a new `protocol_version` field to `agentxchain.json`. The repo already has a documented versioning model, and adding another mutable config field would create a fourth drift surface instead of clarifying compatibility.

## Interface

- `agentxchain validate`
  - human output must show protocol version, config generation, and config schema distinctly for governed repos
  - `--json` output must expose:
    - `protocol_version`
    - `config_generation`
    - `config_schema_version`
  - existing `version` field may remain as a backward-compat alias for config generation
- `agentxchain doctor`
  - human output must show protocol version distinctly from config generation
  - `--json` output must expose:
    - `protocol_version`
    - `config_generation`
    - `config_schema_version`
  - existing `config_version` field may remain as a backward-compat alias for config generation
- Docs
  - CLI docs must stop using bare `v4` shorthand where the real meaning is governed config generation
  - CLI docs must explain that protocol v6 and config generation v4 are different axes

## Behavior

- Governed repos use:
  - protocol version: `v6`
  - config generation: `4`
  - config schema version:
    - `"1.0"` for governed config
    - `"1.0"` also when raw config still uses numeric `schema_version: 4` alias
- Legacy repos keep existing legacy behavior
- No config mutation is required
- No new validation rule or config field is introduced

## Error Cases

- If config parsing fails, existing command failure behavior remains unchanged
- If a repo is legacy v3, governed version fields are not invented
- If a future governed config schema is introduced, the helper must return the raw schema version instead of silently forcing `"1.0"`

## Acceptance Tests

- `AT-PVS-001`: `doctor --json` returns `protocol_version: "v6"`, `config_generation: 4`, and `config_schema_version: "1.0"` for a governed scaffold
- `AT-PVS-002`: human `doctor` output distinguishes protocol v6 from config generation v4
- `AT-PVS-003`: `validate --json` returns the same three version fields for a governed scaffold
- `AT-PVS-004`: human `validate` output distinguishes protocol v6 from config generation v4
- `AT-PVS-005`: CLI docs describe doctor/validate version output without flattening protocol and config generation into one number

## Open Questions

- None for this slice. This intentionally rejects a new config-level `protocol_version` declaration until there is a concrete compatibility rule that cannot be expressed through the existing schema/version model.
