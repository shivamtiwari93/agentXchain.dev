---
status: shipped
---

# Inspection Command Front-Door Discoverability Spec

## Purpose

Ensure that all governed inspection and audit CLI commands are discoverable from both README front doors (`README.md`, `cli/README.md`) and the LLM discovery surface (`llms.txt`). Currently, the entire governed inspection family (`audit`, `diff`, `report`, `events`, `history`, `role list/show`, `turn show`, `phase list/show`, `gate list/show`) is absent from both README command tables. Several other governed commands are also missing from one or both READMEs.

## Scope

### Commands missing from README.md "Command Groups > Governed run control"

- `run` — present in "Canonical Governed Commands" but missing from "Command Groups"
- `audit` — not mentioned anywhere
- `diff` — not mentioned anywhere
- `report` — not mentioned anywhere
- `events` — not mentioned anywhere
- `history` — not mentioned anywhere
- `role list`, `role show` — not mentioned anywhere
- `turn show` — not mentioned anywhere
- `phase list`, `phase show` — not mentioned anywhere
- `gate list`, `gate show` — not mentioned anywhere
- `doctor` — only in legacy section, but it's a governed-mode command too
- `export`, `restore` — mentioned in prose but not in command groups
- `plugin list-available` — newly added in v2.80.0, not listed

### Commands missing from cli/README.md "Command Sets > Governed" table

- `run` — the primary governed execution command, not in the table
- `audit` — not mentioned
- `diff` — not mentioned
- `report` — not mentioned
- `events` — not mentioned
- `history` — not mentioned
- `role list`, `role show` — not mentioned
- `turn show` — not mentioned
- `phase list`, `phase show` — not mentioned
- `gate list`, `gate show` — not mentioned
- `connector check` — not mentioned
- `doctor` — only in legacy section
- `export`, `restore`, `restart` — not mentioned
- `plugin list-available` — not mentioned

### Commands missing from llms.txt

- `audit`, `diff`, `doctor`, `connector check`, `events`, `history`
- `role list/show`, `turn show`, `phase list/show`, `gate list/show`

## Interface

No new code. Documentation-only changes to:

1. `README.md` — add a new "Governed inspection and audit" command group
2. `cli/README.md` — add missing rows to the Governed command table
3. `website-v2/static/llms.txt` — add inspection command mentions

## Behavior

- Both READMEs must list every shipped governed CLI command in at least one command group
- `llms.txt` must mention the inspection/audit capability family
- Command descriptions must match the shipped CLI help text
- No commands should be documented that don't exist

## Acceptance Tests

- AT-INSPECT-DISC-001: README.md mentions `audit`, `diff`, `report`, `events`, `history`
- AT-INSPECT-DISC-002: README.md mentions `role list`, `turn show`, `phase list`, `gate list`
- AT-INSPECT-DISC-003: cli/README.md mentions `run`, `audit`, `diff`, `report`, `events`, `history`
- AT-INSPECT-DISC-004: cli/README.md mentions `role list`, `turn show`, `phase list`, `gate list`
- AT-INSPECT-DISC-005: cli/README.md mentions `connector check`, `doctor`, `export`, `restore`
- AT-INSPECT-DISC-006: llms.txt mentions inspection/audit capability
- AT-INSPECT-DISC-007: Both READMEs mention `plugin list-available`

## Open Questions

None. This is a documentation-only fix for a grep-verified discoverability gap.
