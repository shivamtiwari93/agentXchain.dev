# Policy Docs Surface Spec

## Purpose

Document the declarative `policies` config surface as a first-class operator-facing governance mechanism, distinct from hooks and gates.

## Interface

- Public docs page: `website-v2/docs/policies.mdx`
- Sidebar entry: `website-v2/sidebars.ts`
- Discoverability surfaces:
  - `website-v2/static/llms.txt`
  - `website-v2/static/sitemap.xml`
- Code-backed guard: `cli/test/docs-policies-content.test.js`

## Behavior

- The page must explain what policies are and where they execute in the acceptance flow.
- The page must clearly distinguish:
  - policies: declarative built-in turn rules
  - hooks: external commands/endpoints
  - gates: phase or completion approval checks
- The page must document every shipped built-in policy rule and every shipped policy action.
- The page must describe the real rule semantics:
  - `max_turns_per_phase` and `max_total_turns` block the next acceptance after the configured cap is already reached.
  - `max_consecutive_same_role` blocks when accepting the current turn would exceed the configured streak limit.
  - `require_status` only accepts the shipped turn statuses.
- The page must include a config example that matches repo truth, including the `enterprise-app` template's default policy set.
- The page must state that policies run after validation and `after_validation` hooks but before conflict detection.

## Error Cases

- Docs claim a rule or action that is not implemented in `policy-evaluator.js`
- Docs describe `require_status` with statuses that config validation rejects
- Docs imply policies are hooks, gates, or arbitrary custom logic
- Sidebar, `llms.txt`, or sitemap omit the public policy route

## Acceptance Tests

- AT-POLDOC-001: The docs page exists and is wired into the Docusaurus sidebar.
- AT-POLDOC-002: The docs page mentions every shipped rule in `VALID_POLICY_RULES`.
- AT-POLDOC-003: The docs page mentions every shipped action in `VALID_POLICY_ACTIONS`.
- AT-POLDOC-004: The docs page distinguishes policies from hooks and gates.
- AT-POLDOC-005: The docs page documents the real `require_status` allowed statuses.
- AT-POLDOC-006: The docs page states the real acceptance-flow placement.
- AT-POLDOC-007: `llms.txt` and `sitemap.xml` include the policy page route.

## Open Questions

None. This is a documentation and discoverability slice for the already-shipped policy engine.
