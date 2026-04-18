# Protocol V8 Boundary Spec

## Purpose

Freeze `DEC-PROTOCOL-V8-NO-BUMP-001` as a durable repo contract instead of leaving it as a single changelog note.

The repo has shipped major reference-runner features after protocol v7, including mission hierarchy, mission plans, dashboard surfaces, and richer operator reporting. Those are real product improvements, but they are not automatically protocol changes. Without an explicit boundary, docs and future agents will slowly relabel reference-runner workflow features as constitutional requirements and force fake protocol-v8 drift.

## Interface

- Repo-native protocol reference:
  - `PROTOCOL-v7.md`
- Public docs:
  - `website-v2/docs/protocol-reference.mdx`
  - `website-v2/docs/protocol-implementor-guide.mdx`
- Conformance declaration:
  - `.agentxchain-conformance/capabilities.json`
- Regression proof:
  - `cli/test/protocol-v8-boundary-content.test.js`

## Behavior

1. The current protocol version remains `v7`.
2. Shipping reference-runner workflow features alone does not create protocol v8.
3. The following surfaces remain reference-runner or operator workflow surfaces, not protocol-v7 requirements, until they are explicitly promoted into the conformance corpus or a new normative artifact contract:
   - mission hierarchy and mission plan artifacts under `.agentxchain/missions/`
   - dashboard APIs, ports, views, and browser UX
   - export/report/release operator surfaces
4. A non-reference runner may truthfully claim protocol-v7 conformance without implementing those workflow surfaces, as long as it satisfies the shipped fixture corpus.
5. A future protocol v8 cut requires durable promotion work, not narration. Minimum bar:
   - update the versioned protocol reference
   - update the public protocol boundary docs
   - update `.agentxchain-conformance/capabilities.json`
   - add promoted fixture coverage or a new normative artifact/state contract

## Error Cases

- Public docs imply that mission plans or dashboard UX are mandatory for protocol-v7 conformance
- `capabilities.json` starts claiming workflow surfaces that are not fixture-backed
- A release note or changelog line implies a protocol bump without updating the versioned spec and proof surface
- A future agent changes `protocol_version` to `v8` without adding promoted conformance or normative artifact changes

## Acceptance Tests

- `AT-PV8-001`: `protocol-reference.mdx` explicitly says mission hierarchy/plans, dashboard surfaces, and export/report/release surfaces are not protocol-v7 requirements
- `AT-PV8-002`: `protocol-implementor-guide.mdx` explicitly says non-reference runners can claim v7 without those workflow surfaces
- `AT-PV8-003`: `PROTOCOL-v7.md` states that a future v8 requires promoted conformance or a new normative artifact/state contract
- `AT-PV8-004`: `.agentxchain-conformance/capabilities.json` still declares `protocol_version: "v7"`
- `AT-PV8-005`: `.agentxchain-conformance/capabilities.json` does not declare workflow surfaces like `mission`, `dashboard`, `report`, or `export`

## Open Questions

- None for this slice. The point is to stop accidental v8 drift until there is concrete promoted scope.
