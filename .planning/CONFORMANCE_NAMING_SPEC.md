# Conformance Surface Naming Canonicalization

## Purpose

Enforce a single canonical identifier per conformance surface across all layers: fixture directory name, fixture JSON `surface` field, `capabilities.json` claims, documentation, and guard tests. Third-party implementors must never encounter an identifier mismatch between what they see in the filesystem and what the verifier, capabilities, or docs use.

## The Defect

The `turn_result_validation` surface uses a shortened directory name (`turn_result`) in `.agentxchain-conformance/fixtures/1/turn_result/` while every other layer uses `turn_result_validation`:

- Fixture JSON `"surface"` fields: `turn_result_validation`
- `capabilities.json` claim: `turn_result_validation`
- Docs (protocol-reference, protocol-implementor-guide): `turn_result_validation`
- Guard tests: `turn_result_validation`

All other 8 surfaces have directory names that exactly match their canonical surface identifier.

## Why This Matters

The verifier reads `surface` from fixture JSON payloads, so the mismatch does not cause runtime failures. But:

1. A third-party implementor copying the fixture layout will see `turn_result/` and assume that is the surface name. When they reference it in `capabilities.json` or `--surface` arguments, it will not match.
2. The inconsistency undermines the claim that the conformance corpus is a specification-grade artifact.
3. Any future tooling that derives surface identity from directory structure will break for this one surface.

## Resolution

- **Canonical identifier:** The `surface` field inside fixture JSON is the single source of truth.
- **Directory naming rule:** Every fixture directory must be named exactly after its canonical surface identifier (the `surface` field value that all fixtures in that directory share).
- **Fix:** Rename `.agentxchain-conformance/fixtures/1/turn_result/` to `.agentxchain-conformance/fixtures/1/turn_result_validation/`.
- **Guard:** Add a test that reads every fixture JSON, extracts its `surface` field, derives the expected directory name from the file path, and asserts they match.

## Acceptance Tests

- `AT-NAMING-001`: Every fixture JSON `surface` field exactly matches its parent directory name.
- `AT-NAMING-002`: Every `capabilities.json` surface key has at least one matching fixture directory.
- `AT-NAMING-003`: No fixture directory exists without at least one fixture whose `surface` matches the directory name.
- `AT-NAMING-004`: The guard test fails if a new fixture is added to a mismatched directory.

## Non-Goals

- Renaming the `surface` field value itself. `turn_result_validation` is the correct canonical name.
- Changing the verifier's fixture discovery logic. It should continue reading `surface` from JSON payloads.
