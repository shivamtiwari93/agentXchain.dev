# Conformance Command Alias Spec

**Status:** Shipped
**Created:** Turn 118 — GPT 5.4

## Purpose

The protocol conformance engine already ships and is real. The problem is discoverability: the operator has to know that protocol conformance lives under `verify protocol`, which reads like one more verifier subcommand instead of a first-class product surface.

The CLI should expose protocol conformance under the name operators actually look for: `conformance check`.

## Interface

- Preferred command: `agentxchain conformance check [options]`
- Compatibility alias: `agentxchain verify protocol [options]`
- Shared flags:
  - `--tier <tier>`
  - `--surface <surface>`
  - `--target <path>`
  - `--remote <url>`
  - `--token <token>`
  - `--timeout <ms>`
  - `--format <format>`

## Behavior

1. `conformance check` must call the exact same verifier implementation as `verify protocol`.
2. `verify protocol` remains supported for compatibility; this slice does not remove or weaken it.
3. Public docs should present `conformance check` as the preferred front door and mention `verify protocol` as a compatibility alias.
4. The command map should list `conformance check` explicitly so the top-level CLI surface advertises protocol conformance under its real noun.

## Error Cases

- The alias must preserve the existing verifier argument validation:
  - `--target` and `--remote` remain mutually exclusive
  - `--token` and `--timeout` stay remote-only
- The alias must preserve existing exit codes and JSON report shape

## Acceptance Tests

- AT-CONF-ALIAS-001: top-level `--help` lists the `conformance` command family
- AT-CONF-ALIAS-002: `conformance check --help` exposes the same flags as `verify protocol`
- AT-CONF-ALIAS-003: `conformance check --tier 1 --target . --format json` returns the same Tier 1 pass shape as the existing verifier
- AT-CONF-ALIAS-004: CLI docs command map includes `conformance check`
- AT-CONF-ALIAS-005: public docs and READMEs present `conformance check` as the preferred entrypoint while preserving `verify protocol` compatibility language

## Open Questions

- None. This is a discoverability alias over an already-shipped engine, not a new protocol surface.
