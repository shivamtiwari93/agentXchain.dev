# Protocol Implementor Guide Spec

> Last updated: 2026-04-03 (Turn 6, GPT 5.4)

---

## Purpose

Publish a practical protocol-adoption guide for third-party runner and adapter authors at `/docs/protocol-implementor-guide`. The existing protocol page explains what AgentXchain is; this page must explain how another implementation proves conformance against the shipped fixture corpus.

## Interface

- **Doc source**: `website-v2/docs/protocol-implementor-guide.mdx`
- **Public URL**: `/docs/protocol-implementor-guide`
- **Navigation**: lives under a `Protocol` docs section alongside `/docs/protocol`
- **Primary audience**: implementors building a non-reference runner, validator, or compatibility layer

## Behavior

The page must document the repo's actual conformance contract, not an aspirational one:

1. Explain conformance tiers and the current fixture corpus shape:
   - Tier 1: core constitutional behavior
   - Tier 2: trust-hardening surfaces
   - Tier 3: coordinator / multi-repo behavior
2. Explain `.agentxchain-conformance/capabilities.json` with a real example and field-level guidance.
3. Explain the `stdio-fixture-v1` adapter contract:
   - fixture JSON arrives on stdin
   - one JSON result is emitted on stdout
   - adapter exit codes are `0=pass`, `1=fail`, `2=error`, `3=not_implemented`
4. Distinguish adapter exit codes from verifier exit codes:
   - `agentxchain verify protocol` exits `0` on overall pass
   - exits `1` on one or more fixture failures
   - exits `2` on verifier or adapter error
5. Explain progressive conformance truthfully:
   - `not_implemented` is valid adapter output
   - a run can still be overall `pass` when selected fixtures are `pass` or `not_implemented`
6. Explain fixture anatomy using the real fields:
   - `fixture_id`, `tier`, `surface`, `description`, `type`, `setup`, `input`, `expected`
7. Provide one section for each current surface:
   - `state_machine`
   - `turn_result_validation`
   - `gate_semantics`
   - `decision_ledger`
   - `history`
   - `config_schema`
   - `dispatch_manifest`
   - `hook_audit`
   - `coordinator`
8. Tier 1 surface sections must describe the fixture-backed rules actually proven today, not just the surface label:
   - `state_machine` must call out initialization, pause/approve flow, blocked recovery, terminal-state rejection, and `run_id` immutability
   - `turn_result_validation` must call out required fields, assignment matching, reserved artifact paths, `review_only` objection rules, and mutually-exclusive completion requests
   - `decision_ledger` must call out required entry shape, empty statement rejection, category validation, and duplicate decision-id rejection
   - `history` must call out atomic accept+state update, idempotent re-acceptance, and non-active turn rejection
   - `config_schema` must call out entry-role validation, runtime declaration validation, gate declaration validation, and schema-version rejection
9. Call out the current `surfaces` enforcement rule truthfully:
   - when `capabilities.json.surfaces` exists, `--surface <name>` must be explicitly claimed
   - when the `surfaces` map is absent, surface filtering remains backward compatible and unenforced

## Error Cases

- The page must not claim that `surfaces` is purely informational when the verifier enforces it for declared maps.
- The page must not imply that `verify protocol` itself exits `3`; only the adapter uses `3` for `not_implemented`.
- The page must not describe fixture paths, counts, or surface names that diverge from `.agentxchain-conformance/fixtures/README.md`.
- The page must not reduce Tier 1 sections to generic one-line summaries once the corpus proves specific invariants and rejection cases.

## Acceptance Tests

- [ ] AT-1: `website-v2/docs/protocol-implementor-guide.mdx` exists
- [ ] AT-2: `website-v2/sidebars.ts` includes the page under a `Protocol` section
- [ ] AT-3: The page documents `capabilities.json`, `stdio-fixture-v1`, `verify protocol`, and `not_implemented`
- [ ] AT-4: The page distinguishes adapter exit codes from verifier exit codes
- [ ] AT-5: The page names all nine current protocol surfaces
- [ ] AT-6: `.planning/DOCS_SURFACE_SPEC.md` lists `/docs/protocol-implementor-guide`
- [ ] AT-7: Tier 1 sections name the concrete fixture-backed invariants currently proven for `state_machine`, `turn_result_validation`, `decision_ledger`, `history`, and `config_schema`

## Open Questions

- Q1: When surface-level capability claims become enforced, should `capabilities.json` grow a stricter schema version instead of silently tightening the current one?
