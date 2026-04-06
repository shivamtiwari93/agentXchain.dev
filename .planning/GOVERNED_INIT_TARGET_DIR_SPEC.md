# Governed Init Target Directory Spec

## Purpose

Make `agentxchain init --governed` usable for real onboarding flows without forcing interactive folder prompts or accidental nested directories.

The current scaffold behavior is fine for a blank temp directory, but it breaks two common operator paths:

- existing repo bootstrap needs an in-place scaffold target
- copy-paste quickstart flows need an explicit target directory so later `cd` commands are not relying on hidden defaults

This slice adds an explicit target-directory contract. It does not add a second init command.

## Interface

### CLI

```bash
agentxchain init --governed [--dir <path>] [--template <id>] [--dev-command <parts...>] [--dev-prompt-transport <mode>] [-y]
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

### 1. Explicit target directory

`--dir <path>` sets the scaffold destination directory for `init --governed`.

Examples:

```bash
agentxchain init --governed --dir . -y
agentxchain init --governed --dir my-agentxchain-project -y
agentxchain init --governed --template web-app --dir ./apps/customer-portal -y
```

`--dir .` is the non-interactive in-place path for existing repos.

### 2. `-y` no longer implies nested-directory guesswork when `--dir` is present

When `-y` is used without `--dir`, the existing default remains:

- project name: `My AgentXchain Project`
- folder: `my-agentxchain-project`

When `-y` is used with `--dir`, governed init uses the last path segment of the resolved target directory as the default project name and writes directly into that target.

Examples:

- `--dir .` inside `/repos/checkout` infers project name `checkout`
- `--dir customer-portal` infers project name `customer-portal`

This keeps the scaffold truthful for existing repos without adding a required `--name` flag in this slice.

### 3. Interactive mode still works

When `--dir` is provided without `-y`, init still prompts for project name, but it does not ask a second folder-name question. The operator already declared the target path.

### 4. Output contract

Governed init output must reflect the actual target path. If the scaffold target is the current working directory, the post-create guidance must not tell the operator to `cd .`.

## Error Cases

| Condition | Required behavior |
|---|---|
| `--dir` is empty or whitespace | Exit non-zero before writing files |
| `--dir .` targets an existing repo without `agentxchain.json` | Scaffold in place |
| `--dir <path>` targets an existing governed project and `-y` is absent | Prompt before overwrite, same as current behavior |
| `--dir <path>` targets an existing governed project and `-y` is present | Preserve current non-interactive overwrite behavior |

## Acceptance Tests

1. `init --governed --dir . -y` writes `agentxchain.json` in the current working directory and does not create `my-agentxchain-project/`.
2. `init --governed --dir . -y` infers `config.project.name` from the current directory basename.
3. `init --governed --dir my-agentxchain-project -y` writes directly into that directory.
4. Governed init output omits the `cd` follow-up when `--dir .` is used.
5. `/docs/cli`, `/docs/quickstart`, `README.md`, and `cli/README.md` document `--dir` truthfully.
