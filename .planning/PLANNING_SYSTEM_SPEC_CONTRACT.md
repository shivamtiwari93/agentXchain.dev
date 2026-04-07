# Planning System Spec Contract

Depends on: [WORKFLOW_KIT_VALIDATE_SPEC.md](./WORKFLOW_KIT_VALIDATE_SPEC.md), [WORKFLOW_GATE_FILE_SEMANTICS_SPEC.md](./WORKFLOW_GATE_FILE_SEMANTICS_SPEC.md), [CLI_SPEC.md](./CLI_SPEC.md)

## Purpose

Make spec-first delivery an actual first-party governed contract instead of a slogan in `VISION.md`.

The governed scaffold already enforced planning signoff, QA evidence, and ship verdict artifacts. What it did not enforce was the baseline technical contract that planning is supposed to hand to implementation. That allowed a repo to claim governed workflow discipline while exiting planning with zero spec artifact.

This contract closes that gap for the first-party governed scaffold.

## Interface

### Files

The governed scaffold now owns one additional workflow-kit file:

- `.planning/SYSTEM_SPEC.md`

### Gate contract

The first-party governed `planning_signoff` gate requires:

- `.planning/PM_SIGNOFF.md`
- `.planning/ROADMAP.md`
- `.planning/SYSTEM_SPEC.md`

### Structural markers

`SYSTEM_SPEC.md` must include:

- `## Purpose`
- `## Interface`
- `## Acceptance Tests`

These markers are checked in two places:

1. workflow-kit validation via `agentxchain template validate`
2. the planning exit gate when the scaffold config includes `.planning/SYSTEM_SPEC.md`

## Behavior

### 1. Governed scaffold writes a baseline system spec

`agentxchain init --governed` creates `.planning/SYSTEM_SPEC.md` with the standard sections:

- Purpose
- Interface
- Behavior
- Error Cases
- Acceptance Tests
- Open Questions

The file is a starter contract, not finished truth. Operators and agents are expected to replace the placeholders with real subsystem content before planning exits.

### 2. Planning cannot exit without a spec artifact

For the first-party governed scaffold, `planning_signoff` includes `.planning/SYSTEM_SPEC.md` in `requires_files`.

If the file is missing, planning stays blocked exactly like any other missing gate file.

### 3. Empty decorative specs do not count

If `SYSTEM_SPEC.md` exists but omits `## Purpose`, `## Interface`, or `## Acceptance Tests`, the planning gate fails with a semantic reason naming the missing sections.

### 4. Workflow-kit validation must surface the same contract

`template validate --json` includes `.planning/SYSTEM_SPEC.md` in `workflow_kit.required_files` and exposes structural checks for the required sections so automation can distinguish:

- missing file
- missing structural markers
- template-specific planning-artifact failures

### 5. Migration repairs the new contract

`agentxchain migrate` must create `.planning/SYSTEM_SPEC.md` when it is absent so migrated repos do not stall on the new first-party planning gate without a scaffolded recovery path.

## Error Cases

| Condition | Required behavior |
|---|---|
| Fresh governed scaffold | `SYSTEM_SPEC.md` exists with the baseline headings |
| `SYSTEM_SPEC.md` deleted | `template validate` fails and planning gate reports missing file |
| `SYSTEM_SPEC.md` exists but omits `## Acceptance Tests` | `template validate` fails the structural check and planning gate fails semantically |
| Migrated repo lacks `SYSTEM_SPEC.md` | `migrate` writes the baseline file |
| Custom non-scaffold config omits `.planning/SYSTEM_SPEC.md` from `planning_signoff.requires_files` | The runtime respects the custom gate config; this contract only hardens the first-party scaffold and migrated config |

## Acceptance Tests

- **AT-PLANNING-SPEC-001**: `init --governed` creates `.planning/SYSTEM_SPEC.md`.
- **AT-PLANNING-SPEC-002**: fresh governed `template validate --json` includes `.planning/SYSTEM_SPEC.md` in `workflow_kit.required_files`.
- **AT-PLANNING-SPEC-003**: removing `.planning/SYSTEM_SPEC.md` makes planning-signoff evaluation fail with a missing-file reason.
- **AT-PLANNING-SPEC-004**: removing `## Acceptance Tests` from `SYSTEM_SPEC.md` makes planning-signoff evaluation fail with a semantic reason.
- **AT-PLANNING-SPEC-005**: `migrate` creates `.planning/SYSTEM_SPEC.md` when absent.

## Open Questions

1. Should future template-specific specs add additional required sections beyond the baseline `Purpose`, `Interface`, and `Acceptance Tests` markers?
