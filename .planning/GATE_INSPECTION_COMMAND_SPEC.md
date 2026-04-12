# Gate Inspection Command Spec

**Status:** shipped
**Decision:** DEC-GATE-INSPECT-001, DEC-GATE-INSPECT-003

## Purpose

Provide a dedicated read-only CLI surface for inspecting governed gate definitions, their effective predicate contracts, phase linkage, and live evaluation status. Before this command, operators could only see gate information through `config --get gates` (raw JSON dump) or indirectly through `phase show` (which shows gate ID and status but not the gate contract itself).

## Interface

```
agentxchain gate list [--json]
agentxchain gate show <gate_id> [--json] [--evaluate]
```

### `gate list`

Lists all defined gates with their phase linkage and predicate summary.

- Text output: one row per gate with phase, effective artifact count, and human-approval flag
- JSON output: array of gate summary objects

### `gate show <gate_id>`

Shows a single gate's full contract: predicates, phase linkage, current status, and last failure.

- `--evaluate`: live-evaluate gate predicates against the current repo snapshot using the same merged artifact contract and semantic validators the runtime uses
- Text output: human-readable gate detail
- JSON output: structured gate object

If `gate_id` is omitted, fails with available gate IDs.

## Behavior

### Gate Record Fields

| Field | Source | Description |
|---|---|---|
| `id` | config key | Gate identifier |
| `linked_phase` | routing scan | Phase whose `exit_gate` references this gate |
| `requires_files` | gate config | Array of required file paths |
| `effective_artifacts` | merged gate contract | Additive union of `gates.requires_files` and `workflow_kit.phases[phase].artifacts` with ownership/semantic metadata |
| `requires_verification_pass` | gate config | Boolean |
| `requires_human_approval` | gate config | Boolean |
| `status` | state.phase_gate_status | `pending`, `passed`, `failed`, or `null` |
| `last_failure` | state.last_gate_failure | Last failure details if `gate_type` matches |
| `evaluation` | live filesystem + accepted history | Only with `--evaluate`: effective artifact checks, semantic failures, ownership failures, and latest accepted-turn verification snapshot |

### Phase Linkage

A gate may be referenced by zero or one phase via `routing[phase].exit_gate`. The command scans all routing entries to find the linked phase. If no phase references the gate, `linked_phase` is `null` (orphaned gate definition).

### Live Evaluation (`--evaluate`)

When `--evaluate` is passed to `gate show`:
- The command uses the same effective artifact contract as the runtime gate evaluator:
  - `gates.requires_files`
  - additive `workflow_kit.phases[linked_phase].artifacts`
  - path-derived legacy semantics
  - explicit semantic validators from `workflow_kit`
  - artifact ownership participation checks against accepted turn history
- `requires_verification_pass` is checked against the latest accepted turn in the linked phase, not a fabricated top-level state field
- Results are added under:
  - `evaluation.artifacts[]`
  - `evaluation.semantic_failures[]`
  - `evaluation.ownership_failures[]`
  - `evaluation.verification.{required,source_turn_id,status,passed}`

This is a read-only snapshot, not a gate transition attempt.

## Error Cases

| Condition | Behavior |
|---|---|
| No `agentxchain.json` | Exit 1, "Run `agentxchain init` first" |
| Not governed v4 | Exit 1, "requires v4 config" |
| No gates defined | Exit 1, "No gates defined" |
| Unknown gate ID | Exit 1, list available gate IDs |

## Acceptance Tests

- `AT-GATE-001`: `gate list` text output shows all defined gates with phase linkage
- `AT-GATE-002`: `gate list --json` returns array with correct gate IDs and linked phases
- `AT-GATE-003`: `gate show <id>` text output shows predicates, phase, and status
- `AT-GATE-004`: `gate show <id> --json` returns structured gate object
- `AT-GATE-005`: `gate show <id> --evaluate` reflects semantic and ownership failures from the real gate contract
- `AT-GATE-006`: unknown gate ID exits 1 with available gate list
- `AT-GATE-007`: ungoverned repo exits 1 with clear message
- `AT-GATE-008`: legacy v3 repo exits 1 with "requires v4 config" message
- `AT-GATE-009`: gate inspection includes workflow-kit additive artifacts beyond `gates.requires_files`

## Open Questions

None. This remains a narrow read-only inspection surface. No mutation, no gate evaluation triggering, no approval surface (those belong to `approve-transition` and `approve-completion`).
