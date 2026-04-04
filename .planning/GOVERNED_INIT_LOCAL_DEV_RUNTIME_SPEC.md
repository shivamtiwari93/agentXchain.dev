# Governed Init Local Dev Runtime Spec

## Purpose

Make `agentxchain init --governed` honest and usable with real local agent CLIs at scaffold time.

The current scaffold hardcodes one `local-dev` runtime and forces operators to hand-edit `agentxchain.json` for anything else. Worse, the shipped default command shape for Claude is sloppy. Governed init should expose the local dev runtime as an explicit command-surface contract instead of hiding it in generated JSON.

## Interface

### CLI

```bash
agentxchain init --governed [--template <id>] [--dev-command <parts...>] [--dev-prompt-transport <mode>] [-y]
```

### Files

```text
cli/bin/agentxchain.js
cli/src/commands/init.js
website-v2/docs/cli.mdx
website-v2/docs/quickstart.mdx
README.md
cli/README.md
```

## Behavior

### 1. Default local dev runtime

When no override flags are supplied, governed init writes:

```json
{
  "type": "local_cli",
  "command": ["claude", "--print"],
  "cwd": ".",
  "prompt_transport": "stdin"
}
```

This is the verified default preset for the repo. Do not keep the redundant `--print -p {prompt}` shape.

### 2. Custom local dev command

`--dev-command <parts...>` replaces the `local-dev.command` array in the generated governed config.

Examples:

```bash
agentxchain init --governed --dev-command claude --print --dev-prompt-transport stdin -y
agentxchain init --governed --dev-command my-agent run {prompt} -y
agentxchain init --governed --dev-command ./scripts/dev-agent.sh --dev-prompt-transport dispatch_bundle_only -y
```

### 3. Prompt transport contract

`--dev-prompt-transport` must be one of:

- `argv`
- `stdin`
- `dispatch_bundle_only`

Rules:

- If `argv` is selected, `--dev-command` must include `{prompt}`.
- If `stdin` or `dispatch_bundle_only` is selected, `--dev-command` must **not** include `{prompt}`.
- If a custom `--dev-command` is provided without `{prompt}` and without `--dev-prompt-transport`, init fails closed instead of silently creating a broken scaffold.
- If a custom `--dev-command` includes `{prompt}` and no transport is provided, init resolves `prompt_transport` to `argv`.

### 4. Operator feedback

Governed init output must print the effective dev runtime command and prompt transport so the scaffold contract is visible immediately.

## Error Cases

| Condition | Required behavior |
|---|---|
| Unknown `--dev-prompt-transport` | Exit non-zero before writing files. |
| `--dev-prompt-transport argv` without `{prompt}` in `--dev-command` | Exit non-zero before writing files. |
| `--dev-prompt-transport stdin` or `dispatch_bundle_only` with `{prompt}` in `--dev-command` | Exit non-zero before writing files. |
| Custom `--dev-command` with no `{prompt}` and no `--dev-prompt-transport` | Exit non-zero before writing files. |

## Acceptance Tests

1. `init --governed -y` writes `local-dev.command = ["claude", "--print"]`.
2. `init --governed -y` writes `local-dev.prompt_transport = "stdin"`.
3. `init --governed --dev-command my-agent --dev-prompt-transport dispatch_bundle_only -y` writes the custom command and transport.
4. `init --governed --dev-command my-agent {prompt} -y` resolves `prompt_transport = "argv"`.
5. `init --governed --dev-command my-agent -y` fails before writing files.
6. `init --governed --dev-command my-agent --dev-prompt-transport argv -y` fails before writing files when `{prompt}` is absent.
7. `/docs/cli` documents both new flags and their prompt-delivery contract.
8. `/docs/quickstart`, `README.md`, and `cli/README.md` mention the scaffold-time local dev override path.
