# CLI Docs Contract: `verify protocol`

**Status:** Shipped
**Turn:** 7
**Scope:** Align the `/docs/cli` `verify protocol` subsection with the shipped verifier implementation

## Problem

The `verify protocol` docs section in `cli.mdx` has three gaps when compared to the shipped implementation in `cli/src/lib/protocol-conformance.js`:

1. **`not_implemented` adapter response is undocumented.** Adapters can return `not_implemented` (exit code 3 from the adapter process), which the verifier treats as non-failing. The overall exit code remains `0` if all other fixtures pass. The docs only list exit codes 0/1/2 with no mention of progressive conformance or `not_implemented`.

2. **Surface enforcement constraint is undocumented.** When `--surface <s>` is specified and `capabilities.json` includes a `surfaces` map, the verifier rejects requests for unclaimed surfaces with exit code 2. If `surfaces` is absent from capabilities, enforcement is skipped. Operators need to know this contract.

3. **`--tier` cumulative semantics are implicit.** The docs say "Maximum conformance tier" but don't explain that `--tier 2` runs both tier 1 AND tier 2 fixtures. The implementation filters by `fixture.tier <= requestedTier`.

## Flag Surface

Flags are correct. No ghost flags, no missing flags:

| Flag | Default | CLI Registration | Docs |
|------|---------|-----------------|------|
| `--tier <tier>` | `1` | `'Conformance tier to verify (1, 2, or 3)'` | "Maximum conformance tier to verify" |
| `--surface <surface>` | (none) | `'Restrict verification to a single surface'` | ✓ |
| `--target <path>` | `.` | ✓ | ✓ |
| `--format <format>` | `text` | ✓ | ✓ |

## Changes Required

1. Add `not_implemented` to the exit codes table with explanation of progressive conformance
2. Add a note under `--surface` about surface enforcement when `capabilities.json.surfaces` exists
3. Clarify `--tier` as cumulative (runs all fixtures up to and including the specified tier)

## Acceptance Tests

- AT-VP-001: Docs mention `not_implemented` adapter response
- AT-VP-002: Docs explain that `not_implemented` fixtures do not cause overall failure
- AT-VP-003: Docs mention surface enforcement when `capabilities.json.surfaces` exists
- AT-VP-004: Docs explain cumulative tier semantics
- AT-VP-005: Guard test reads `protocol-conformance.js` to verify documented adapter statuses match `VALID_RESPONSE_STATUSES`
- AT-VP-006: Guard test reads `agentxchain.js` to verify all documented flags exist in CLI registration
