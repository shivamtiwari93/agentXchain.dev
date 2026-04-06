# Interface Alignment Contract Spec

> Last updated: 2026-04-06 (Turn 18, GPT 5.4)

---

## Purpose

Replace the `interface_alignment` barrier placeholder with a real, deterministic contract.

The old behavior was indefensible: once every required repo had accepted any turn, `interface_alignment` collapsed to the same outcome as `all_repos_accepted`. That created dead-weight surface area and fake precision in the docs.

This spec defines a real completion contract for multi-repo workstreams that need explicit cross-repo interface acknowledgement before they can advance.

## Interface

When a workstream sets `"completion_barrier": "interface_alignment"`, it MUST also declare explicit per-repo decision IDs:

```json
{
  "workstreams": {
    "delivery": {
      "phase": "implementation",
      "repos": ["api", "web"],
      "entry_repo": "api",
      "depends_on": [],
      "completion_barrier": "interface_alignment",
      "interface_alignment": {
        "decision_ids_by_repo": {
          "api": ["DEC-101"],
          "web": ["DEC-201"]
        }
      }
    }
  }
}
```

## Behavior

1. Config validation rejects `interface_alignment` workstreams that omit `interface_alignment.decision_ids_by_repo`.
2. `decision_ids_by_repo` must declare a non-empty `DEC-NNN` array for every repo in the workstream.
3. The barrier evaluates accepted coordinator projections for the workstream and accumulates accepted decision IDs per repo.
4. The barrier becomes `satisfied` only when every required repo has accepted every decision ID declared for that repo.
5. If at least one required repo has accepted a projection but one or more declared decision IDs are still missing, the barrier remains `partially_satisfied`.
6. Recovery rebuild uses the same contract as live acceptance evaluation. Resync is not allowed to degrade back to repo-counting.
7. Barrier snapshots may expose `alignment_decision_ids` and `satisfied_repos` so operators and downstream repos can see what is still missing.

## Error Cases

| Condition | Required behavior |
|---|---|
| `completion_barrier` is `interface_alignment` but `interface_alignment` is missing | Reject config |
| A workstream repo is missing from `decision_ids_by_repo` | Reject config |
| A declared decision ID does not match `DEC-NNN` | Reject config |
| All repos accepted turns but one repo did not accept its declared decision IDs | Barrier remains `partially_satisfied` |
| Recovery recomputes `interface_alignment` from repo count instead of declared decision IDs | Reject as drift bug |

## Acceptance Tests

1. `AT-IA-001`: config validation accepts `interface_alignment` only with explicit `decision_ids_by_repo`.
2. `AT-IA-002`: acceptance projection leaves the barrier `partially_satisfied` when a repo accepted a turn but missed its declared decision IDs.
3. `AT-IA-003`: acceptance projection moves the barrier to `satisfied` once every repo has accepted its declared decision IDs.
4. `AT-IA-004`: resync rebuild recomputes `interface_alignment` from accepted decision IDs, not accepted repo count.
5. `AT-IA-005`: docs/spec surfaces describe the explicit config contract, not a heuristic placeholder.
6. `AT-IA-006`: Tier 3 conformance includes at least one `interface_alignment` fixture.

## Open Questions

1. Should future versions add a higher-level contract-ref surface so operators do not have to coordinate raw `DEC-NNN` IDs across repos manually?
