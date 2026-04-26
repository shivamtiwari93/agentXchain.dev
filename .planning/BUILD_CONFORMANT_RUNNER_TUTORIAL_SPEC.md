# Build A Conformant Runner Tutorial Spec

**Status:** Draft for implementation in Turn 48.

## Purpose

Give protocol implementors a concrete tutorial path for building a minimal conformant AgentXchain runner without copying the reference CLI internals.

The existing `/docs/build-your-own-runner` page is for consumers using the published `agentxchain/runner-interface` library boundary. The existing `/docs/protocol-implementor-guide` page is the fixture-backed conformance reference. This tutorial fills the gap between them: it explains the smallest protocol surface a non-reference runner must implement before the conformance corpus is meaningful.

## Interface

- Public route: `/docs/build-conformant-runner`
- Source file: `website-v2/docs/build-conformant-runner.mdx`
- Navigation: under the Protocol docs section, adjacent to `build-your-own-runner` and `protocol-implementor-guide`
- Guard test: `cli/test/build-conformant-runner-content.test.js`

## Decisions

- **DEC-BUILD-CONFORMANT-RUNNER-TUTORIAL-001:** Keep `/docs/build-conformant-runner` separate from `/docs/build-your-own-runner`. The former is for independent protocol implementors who own state-machine behavior and conformance proof; the latter is for library-backed runners using the shipped `agentxchain/runner-interface` boundary.

## Behavior

The page must:

1. Distinguish two build paths:
   - library-backed runners use `agentxchain/runner-interface`
   - independent protocol implementations implement the protocol state machine and then prove behavior with conformance fixtures
2. Define the minimum viable protocol surface:
   - governed state machine
   - turn contract
   - staged turn-result validation
   - acceptance and history write
   - phase and completion gates
   - blocked recovery
   - append-only event and decision evidence
3. Include concrete code examples for:
   - state shape
   - assignment guard
   - turn-result validation
   - acceptance transition
   - gate approval
   - blocked recovery
   - a `stdio-fixture-v1` adapter skeleton
4. Tie every step back to the conformance surfaces:
   - `state_machine`
   - `turn_result_validation`
   - `history`
   - `decision_ledger`
   - `gate_semantics`
   - `config_schema`
   - `event_lifecycle`
5. Tell implementors when to graduate from Tier 1 to Tier 2 and Tier 3.
6. Warn against common false-conformance traps:
   - accepting unassigned turns
   - advancing gates because an agent requested them
   - overwriting history or decisions instead of appending
   - treating `needs_human` as a generic error
   - ignoring event ordering
   - returning `pass` for unimplemented fixture operations

## Error Cases

- If the page reads like another reference-runner library tutorial, the test must fail.
- If the page omits any of state machine, turn validation, acceptance, gates, recovery, events, or conformance adapter proof, the test must fail.
- If the page does not distinguish `fail`, `error`, and `not_implemented`, the test must fail.
- If the page is not discoverable from the Protocol sidebar and docs surface spec, the test must fail.

## Acceptance Tests

- `AT-BCR-001`: page, sidebar entry, and docs surface declaration exist.
- `AT-BCR-002`: page distinguishes library-backed runners from independent protocol implementations.
- `AT-BCR-003`: page documents the minimum viable protocol surface.
- `AT-BCR-004`: page includes concrete code examples for assignment, validation, acceptance, gates, recovery, and `stdio-fixture-v1`.
- `AT-BCR-005`: page maps the tutorial steps to conformance surfaces and fixture tiers.
- `AT-BCR-006`: page warns against false-conformance traps.

## Open Questions

1. Should a future release include a tiny independent reference implementation that intentionally does not import `agentxchain/runner-interface`, so implementors can run the conformance corpus against a second codebase?
