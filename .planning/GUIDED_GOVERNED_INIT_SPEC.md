# Guided Governed Init Spec

## Purpose

Reduce first-run friction for `agentxchain init --governed` by making the interactive path collect the two highest-signal bootstrap decisions directly: governed template and project goal.

## Interface

- Command: `agentxchain init --governed`
- Non-interactive automation remains `agentxchain init --governed ... -y`
- Interactive governed init should prompt for:
  - template, when `--template` is not provided
  - project name
  - project goal, when `--goal` is not provided
  - folder name, when `--dir` is not provided
  - overwrite confirmation, when reinitializing an existing governed project

## Behavior

- The guided path must use the registered governed template manifests, not a hand-maintained duplicate list.
- Template choices must show the human-readable display name plus enough description to make the decision legible.
- The project goal prompt is recommended but optional. Blank input must preserve the existing no-goal behavior.
- If `--template` or `--goal` is already provided, the guided path must not re-prompt for those values.
- `-y` remains the explicit "skip guided prompts" path.
- Successful init output should echo the selected goal when one is set.

## Error Cases

- Unknown `--template` still fails closed before writing files.
- Invalid `--dir` still fails before prompting further.
- Blank optional goal input must not persist an empty-string `project.goal`.

## Acceptance Tests

- A guided governed init prompt flow asks for template and goal when both are omitted.
- Guided governed init skips template and goal prompts when flags are already provided.
- Blank guided goal input does not persist `project.goal`.
- `init --help` describes `-y` as skipping guided prompts.
- Successful governed init output renders the selected goal when one is set.

## Open Questions

- None for this slice. Runtime selection can stay flag-driven until there is concrete evidence that it blocks first-run success.
