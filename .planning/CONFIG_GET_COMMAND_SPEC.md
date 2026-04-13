# Config Get Command

**Status:** shipped
**Created:** Turn 66 — GPT 5.4

## Purpose

`agentxchain config` currently lets operators dump the whole config or mutate a dot-path, but it does not provide a narrow read path for the exact field they want to inspect before or after a change.

That asymmetry is weak product design:

- operators fall back to opening `agentxchain.json`
- docs drift toward manual file inspection because the CLI cannot show a single field cleanly
- automation has to parse the full config blob just to read one value

This slice adds a real config inspection path instead of treating raw file reads as the default.

## Interface

Supported surface:

```bash
agentxchain config --get <key>
agentxchain config --get <key> --json
```

Examples:

```bash
agentxchain config --get project.goal
agentxchain config --get budget.per_run_max_usd
agentxchain config --get roles.qa --json
```

Compatibility requirements:

- plain `agentxchain config` still prints the summary view
- `agentxchain config --json` still prints the full config
- `agentxchain config --set <key> <value...>` behavior is unchanged

## Behavior

1. `config --get <key>` must work in both governed and legacy repos through the same version-aware config loader used by the existing command.
2. Dot-path traversal must reject reserved object path segments (`__proto__`, `prototype`, `constructor`) just like `config --set`.
3. For scalar values, plain `config --get <key>` prints the value in a script-friendly form without extra framing.
4. For object or array values, plain `config --get <key>` prints pretty JSON.
5. `config --get <key> --json` always prints JSON, including quoted JSON strings for string values.
6. Missing paths fail closed with a clear error and a non-zero exit code.
7. `--get` and `--set` are mutually exclusive. The command must reject ambiguous invocation instead of guessing operator intent.
8. Public CLI docs must describe the `--get` surface as the truthful inspection path so operators do not default to opening `agentxchain.json`.

## Error Cases

- no `agentxchain.json` in the current repo root chain: fail with the existing init guidance
- invalid dot-path segment or reserved object path: fail non-zero
- missing path: fail non-zero and do not print partial values
- both `--get` and `--set` passed together: fail non-zero with explicit guidance

## Acceptance Tests

- `AT-CFGGET-001`: `config --get project.goal` prints a governed scalar value
- `AT-CFGGET-002`: `config --get roles.qa --json` prints structured JSON for an object path
- `AT-CFGGET-003`: `config --get missing.path` fails closed with a clear missing-path error
- `AT-CFGGET-004`: `config --get` and `config --set` together fail as mutually exclusive
- `AT-CFGGET-005`: `/docs/cli` documents the `config --get <key>` inspection path

## Open Questions

- Whether the CLI should eventually add a `config paths` discovery surface for common governed keys. Not part of this slice.
