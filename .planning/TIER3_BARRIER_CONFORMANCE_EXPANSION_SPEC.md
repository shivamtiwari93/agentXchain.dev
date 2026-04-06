# Tier 3 Barrier Conformance Expansion Spec

> Last updated: 2026-04-06 (Turn 16, GPT 5.4)

---

## Purpose

Expand Tier 3 protocol conformance so the fixture corpus proves more of the shipped coordinator barrier semantics instead of stopping at:

- coordinator config validation
- `all_repos_accepted` partial/full transitions
- cross-repo write isolation

That previous Tier 3 corpus was not worthless, but calling it "complete" was lazy. The runtime already ships additional barrier behavior for `ordered_repo_sequence` and `shared_human_gate`, and those semantics were only protected by repo-local unit tests. Third-party implementors could not prove them against the public corpus.

## Interface

No new command surface.

This slice expands the existing Tier 3 conformance surface:

- Fixture directory: `.agentxchain-conformance/fixtures/3/coordinator/`
- Fixture README: `.agentxchain-conformance/fixtures/README.md`
- Public implementor docs: `website-v2/docs/protocol-implementor-guide.mdx`
- Self-validation guard: `cli/test/protocol-conformance.test.js`

## Behavior

### 1. Add ordered-repo barrier proof

Tier 3 must prove that `ordered_repo_sequence` does not become satisfied just because a downstream repo accepts first.

The corpus should encode the current shipped status model honestly:

- `pending` before any acceptance
- `partially_satisfied` after downstream acceptance only
- `satisfied` after the entry repo accepts

This is already how `cli/src/lib/coordinator-acceptance.js` behaves. Conformance needs to prove it, not merely assume it.

### 2. Add shared-human-gate proof

Tier 3 must prove that `shared_human_gate` never auto-satisfies from repo-local acceptances, even when every required repo has accepted.

That matters because it is the explicit coordinator-level human authority boundary. If this is not in the public corpus, the most governance-heavy multi-repo barrier remains an internal convention instead of an adoption contract.

### 3. Do not canonize `interface_alignment` yet

Do not add an `interface_alignment` fixture in this slice.

Current implementation truth:

- `interface_alignment` currently degrades to a heuristic placeholder
- once all required repos have accepted, the barrier returns `satisfied`
- there is no stable decision-matching contract yet

Freezing that into protocol conformance now would be fake rigor. Public docs should say it is deferred from fixture promotion until the runtime owns a non-heuristic rule.

### 4. Fix public count surfaces and authoring-status truth

Intentional fixture expansion must update every surface that publishes the corpus size:

- fixture README
- protocol implementor guide
- homepage proof stat
- launch/marketing count guards
- self-validation test expectations

Also: Tier 3 must stop calling itself "complete" while `interface_alignment` is still deferred.

## Error Cases

| Condition | Required behavior |
|---|---|
| Ordered downstream acceptance marks the barrier `satisfied` before entry-repo acceptance | Fixture fails |
| Shared human gate auto-satisfies from repo-local acceptances | Fixture fails |
| Tier 3 count increases without public count-surface updates | Guard tests fail |
| Docs still claim Tier 3 is complete while `interface_alignment` is deferred | Fixture README / guide are false and must be corrected |
| `interface_alignment` is fixture-promoted before the contract stops being heuristic | Reject the change as premature |

## Acceptance Tests

1. `AT-T3B-001`: Tier 3 self-validation passes with `7` coordinator fixtures.
2. `AT-T3B-002`: A fixture proves `ordered_repo_sequence` remains non-satisfied after downstream-only acceptance.
3. `AT-T3B-003`: A fixture proves `shared_human_gate` remains `pending` after all required repos accept.
4. `AT-T3B-004`: `.agentxchain-conformance/fixtures/README.md` reports Tier 3 as `7` fixtures and explicitly defers `interface_alignment`.
5. `AT-T3B-005`: Public count surfaces report `76` total fixtures.
6. `AT-T3B-006`: The implementor guide names the newly-proven barrier semantics and states why `interface_alignment` is deferred.

## Open Questions

1. What exact non-heuristic contract should eventually promote `interface_alignment` into conformance: explicit matching decision IDs, declared contract refs, or a stronger coordinator artifact?
