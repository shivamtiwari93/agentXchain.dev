# CLI Docs Contract: `verify protocol`

**Status:** Shipped
**Turn:** 7
**Scope:** Align the `/docs/cli` `verify protocol` subsection with the shipped verifier implementation

## Problem

The `verify protocol` docs section in `cli.mdx` has two categories of required truth:

1. **Behavioral semantics must stay aligned.** `not_implemented`, surface enforcement, and cumulative tier behavior are real verifier contracts and must stay documented.
2. **The remote transport slice must be documented.** The shipped verifier now supports both repo-local `stdio-fixture-v1` adapters and remote `http-fixture-v1` endpoints. The docs must list the remote-only flags and describe the HTTP endpoint shape truthfully.

## Flag Surface

Current shipped flags:

| Flag | Default | CLI Registration | Docs |
|------|---------|-----------------|------|
| `--tier <tier>` | `1` | `'Conformance tier to verify (1, 2, or 3)'` | "Maximum conformance tier to verify" |
| `--surface <surface>` | (none) | `'Restrict verification to a single surface'` | ✓ |
| `--target <path>` | `.` | ✓ | ✓ |
| `--remote <url>` | (none) | `'Remote HTTP conformance endpoint base URL'` | must exist |
| `--token <token>` | (none) | `'Bearer token for remote HTTP conformance endpoint'` | must exist |
| `--timeout <ms>` | `30000` | `'Per-fixture remote HTTP timeout in milliseconds'` | must exist |
| `--format <format>` | `text` | ✓ | ✓ |

## Changes Required

0. Present `conformance check` as the preferred operator-facing entrypoint while keeping `verify protocol` documented as a compatibility alias
1. Keep `not_implemented` in the exit-code explanation with progressive-conformance semantics
2. Keep the `capabilities.json.surfaces` enforcement note
3. Keep `--tier` documented as cumulative
4. Document remote mode with `http-fixture-v1`, `GET /conform/capabilities`, and `POST /conform/execute`
5. Document `--remote`, `--token`, and `--timeout`
6. Make it explicit that `--remote` and `--target` are mutually exclusive, and `--token` / `--timeout` are remote-only

## Acceptance Tests

- AT-VP-001: Docs mention `not_implemented` adapter response
- AT-VP-002: Docs explain that `not_implemented` fixtures do not cause overall failure
- AT-VP-003: Docs mention surface enforcement when `capabilities.json.surfaces` exists
- AT-VP-004: Docs explain cumulative tier semantics
- AT-VP-005: Guard test reads `protocol-conformance.js` to verify documented adapter statuses match `VALID_RESPONSE_STATUSES`
- AT-VP-006: Guard test reads `agentxchain.js` to verify all documented flags exist in CLI registration
- AT-VP-007: Docs mention `http-fixture-v1`
- AT-VP-008: Docs mention `--remote`
- AT-VP-009: Docs mention `conformance check` as the preferred entrypoint and `verify protocol` as a compatibility alias
