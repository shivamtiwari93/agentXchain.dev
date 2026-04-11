# Governed Config Command

**Status:** shipped
**Created:** Turn 58 — GPT 5.4

## Purpose

Governed repos need a real CLI mutation path for small config corrections after scaffold. The most common case is an operator who forgets `--goal` during `init --governed` and should not have to hand-edit `agentxchain.json` just to recover mission context.

The shipped `config` command was not truthful for governed repos:

- it loaded only the legacy v3 schema
- the natural `agentxchain config --set <key> <value...>` form failed at argument parsing
- docs were telling operators to edit JSON by hand instead of using a CLI mutation path

This slice fixes the governed operator path instead of papering over it in docs.

## Interface

Supported governed surface:

```bash
agentxchain config
agentxchain config --json
agentxchain config --set <key> <value...>
```

Examples:

```bash
agentxchain config --set project.goal "Build a governed CLI that lints decision logs"
agentxchain config --set roles.qa.runtime manual-qa
```

Backward-compatibility requirement:

- the older single-argument form `agentxchain config --set "project.goal Build a governed CLI"` must continue to work

Legacy-only mutations remain explicit:

- `agentxchain config --add-agent`
- `agentxchain config --remove-agent <id>`

Those stay v3-only because governed repos use `roles` and `runtimes`, not legacy `agents`.

## Behavior

1. `config` must load both legacy v3 and governed v4 repos through version-aware config loading instead of the legacy-only loader.
2. `config --set <key> <value...>` must accept the natural CLI shape where the key is one argv token and the value may span multiple argv tokens.
3. Governed edits must validate against the governed config contract before writing the file back.
4. If a governed edit is invalid, the command must fail closed and leave `agentxchain.json` unchanged.
5. Plain `agentxchain config` on a governed repo must print a governed-oriented summary instead of rejecting the repo.
6. The governed onboarding/docs surface must route omitted-goal recovery through `agentxchain config --set project.goal ...` rather than manual JSON edits.

## Error Cases

- No `agentxchain.json` in the current repo root chain: fail with the existing init guidance
- Invalid JSON or invalid config schema: fail closed through version-aware config loading
- `--set` without both key and value: print usage and exit non-zero
- Invalid dot-path mutation (for example a governed value that violates schema constraints): reject and do not write partial config
- `--add-agent` / `--remove-agent` on governed repos: fail with a clear legacy-only boundary

## Acceptance Tests

- `AT-CFGG-001`: natural `config --set <key> <value...>` works in governed repos and updates `status --json` truth
- `AT-CFGG-002`: backward-compatible quoted single-argument `--set` form still works
- `AT-CFGG-003`: `config --json` returns governed config instead of rejecting v4 repos
- `AT-CFGG-004`: invalid governed edits fail closed without mutating `agentxchain.json`
- `AT-CFGG-005`: plain `config` output works on governed repos
- `AT-PGD-001`: `init --governed` without `--goal` points operators at `config --set project.goal`
- `AT-PGD-003`: getting-started routes omitted-goal recovery through `config --set project.goal`
- `AT-PGD-004`: quickstart routes omitted-goal recovery through `config --set project.goal`
- `AT-PGD-005`: README routes omitted-goal recovery through `config --set project.goal`

## Open Questions

- Whether governed repos eventually need structured subcommands for common mutations (`config set-goal`, `config set-runtime`) instead of only dot-path writes. Not part of this slice.
