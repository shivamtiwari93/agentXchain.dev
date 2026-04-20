# Conformance Fixtures README Spec

**Status:** Shipped — `.agentxchain-conformance/fixtures/README.md` is the guarded source-of-truth inventory for the shipped fixture corpus.

> Last updated: 2026-04-19 (Turn 18, GPT 5.4)

---

## Purpose

Keep `.agentxchain-conformance/fixtures/README.md` aligned with the actual shipped fixture corpus so implementors and repo maintainers have one trustworthy place for:

- fixture-tier and surface counts
- fixture-layer operation names
- setup helper inventory
- assertion matcher vocabulary

If this README drifts, downstream docs and specs inherit bad facts.

## Interface

- **File:** `.agentxchain-conformance/fixtures/README.md`
- **Audience:** fixture authors, adapter implementors, and agents updating protocol docs/specs
- **Downstream dependents:** `website-v2/docs/protocol-implementor-guide.mdx`, protocol specs in `.planning/`, and any tests deriving conformance corpus facts

## Behavior

The README must describe the shipped corpus as it exists on disk today:

1. Identify the corpus as the current shipped AgentXchain protocol v7 conformance corpus, not the historical v2.2 corpus.
2. Document the exact fixture-layer operation names currently present in fixture `input.operation`.
3. Document the exact setup helper keys currently present in fixture `setup` objects.
4. Document the assertion matcher vocabulary currently present in fixture `expected` objects.
5. Publish the current tier totals and per-surface counts derived from the JSON corpus.
6. Keep Tier 3 scope honest about what the shipped coordinator fixtures currently prove.

## Error Cases

- The README must not claim outdated protocol labels such as "v2.2" for the shipped corpus.
- The README must not omit setup helpers, operations, or matcher shapes that exist in fixtures on disk.
- The README must not publish tier or surface counts that diverge from the actual JSON files.
- The README must not describe unshipped coordinator proof or omit currently shipped Tier 1 promoted surfaces.

## Acceptance Tests

- [ ] AT-CFR-001: `cli/test/conformance-fixtures-readme-content.test.js` exists.
- [ ] AT-CFR-002: The README no longer describes the shipped corpus as `v2.2`.
- [ ] AT-CFR-003: The README operation list matches the distinct `input.operation` values in the JSON corpus.
- [ ] AT-CFR-004: The README setup helper list matches the distinct `setup` keys in the JSON corpus.
- [ ] AT-CFR-005: The README matcher list covers the distinct `expected.*.assert` shapes in the JSON corpus.
- [ ] AT-CFR-006: The README tier totals and per-surface counts match the JSON corpus exactly.
- [ ] AT-CFR-007: `website-v2/docs/protocol-implementor-guide.mdx` helper inventory stays aligned with the README/helper corpus.

## Open Questions

- Q1: If future fixture helpers grow beyond simple key lists, should helper definitions move into machine-readable metadata beside the corpus instead of prose-only README bullets?
