# Coordinator Decision Digest Spec

## Purpose

The coordinator governance report currently hides its own decision-ledger behind a `decision_entries` count in `subject.artifacts`. The export carries `.agentxchain/multirepo/decision-ledger.jsonl` with real coordinator-level decisions (scope cuts, dispatch order, interface alignment, etc.), but operators cannot see them in the report without parsing raw JSON.

This spec defines a `decision_digest` field on the coordinator report subject that surfaces coordinator-level decisions as a first-class section, parallel to how single-repo reports already surface `subject.run.decisions`.

## Interface

### Extraction

```
extractCoordinatorDecisionDigest(artifact) → Array<{
  id: string,          // Decision identifier (e.g. 'DEC-COORD-001')
  turn_id: string|null,
  role: string|null,
  phase: string|null,
  category: string|null,
  statement: string,
}>
```

Reads from `.agentxchain/multirepo/decision-ledger.jsonl`. Filters to entries with a string `id` field. Returns entries in ledger order (append order = chronological).

### Report Subject

Added to `buildCoordinatorSubject()` return value:

```
subject.decision_digest: Array<{ id, turn_id, role, phase, category, statement }>
```

### Text Format

When `decision_digest` is non-empty:

```
Coordinator Decisions:
  - DEC-COORD-001 (dev, implementation): Initialize coordinator.
  - DEC-COORD-002 (pm, planning): Dispatch to web first.
```

### Markdown Format

When `decision_digest` is non-empty:

```markdown
## Coordinator Decisions

- **DEC-COORD-001** (dev, implementation phase): Initialize coordinator.
- **DEC-COORD-002** (pm, planning phase): Dispatch to web first.
```

### Empty Behavior

When the coordinator decision-ledger is empty or absent, `decision_digest` is `[]` and the section is omitted from both text and markdown output.

## Behavior

- Only entries with a string `id` field are included. Governance-event entries (e.g. `decision: 'conflict_detected'`) without an `id` field are excluded.
- The `category` field is included when present (one of: `implementation`, `architecture`, `scope`, `process`, `quality`, `release`).
- Entries are returned in ledger append order (no re-sorting).
- This is distinct from per-repo `decisions` already rendered under each repo in the coordinator report.

## Error Cases

- Missing file: return `[]`, omit section.
- Malformed entries (no `id`): silently filtered out.
- Empty file: return `[]`, omit section.

## Acceptance Tests

- `AT-COORD-DECISION-001`: Coordinator decisions extracted from `.agentxchain/multirepo/decision-ledger.jsonl` with correct fields.
- `AT-COORD-DECISION-002`: Every entry has `id` (string) and `statement` (string).
- `AT-COORD-DECISION-003`: Text formatter includes "Coordinator Decisions:" section with all entries.
- `AT-COORD-DECISION-004`: Markdown formatter includes "## Coordinator Decisions" section with all entries.
- `AT-COORD-DECISION-005`: Empty/absent ledger omits section in both formats.
- `AT-COORD-DECISION-006`: Entries without `id` field are filtered out.
- `AT-COORD-DECISION-007`: Spec guard verifying this spec file exists.

## Open Questions

None.
