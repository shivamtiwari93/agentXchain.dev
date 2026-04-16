# Gate Actions Docs Surface Spec

**Status:** shipped

## Purpose

Document the shipped `gate_actions` surface as a first-class operator mechanism for post-approval automation. The feature already exists in the runtime and CLI, but without a dedicated page operators have to infer behavior from scattered command notes and tests.

## Interface

- Public docs page: `website-v2/docs/gate-actions.mdx`
- Sidebar entry: `website-v2/sidebars.ts`
- Discoverability surface:
  - `website-v2/static/llms.txt`
- Code-backed guard: `cli/test/docs-gate-actions-content.test.js`

## Behavior

- The page must describe `gate_actions` as a **gate-owned** contract on `gates.<gate_id>`, not as workflow-kit config and not as a release-only feature.
- The page must document the real config constraint:
  - `gate_actions` require `requires_human_approval: true`
  - each action needs a non-empty `run`
  - `label` is optional
- The page must document the real execution order:
  1. human approval command invoked
  2. `before_gate` hooks pass
  3. gate actions execute sequentially
  4. approval finalizes only after all actions succeed
- The page must document the real runtime contract:
  - repo-local only
  - executes in the repo root via `/bin/sh -lc`
  - `--dry-run` previews without executing hooks, actions, or state mutation
  - failures block the run with `typed_reason: gate_action_failed` and preserve the pending gate for retry
  - commands must be rerunnable/idempotent
- The page must document the real evidence surfaces:
  - `.agentxchain/decision-ledger.jsonl`
  - `type: "gate_action"`
  - `status`
  - `report`
  - `audit`
- The page must document the environment variables exposed to commands.
- The page must include a worked example that uses repo-owned wrapper scripts, not unsafe one-shot examples such as raw `npm version patch`.
- The page must distinguish gate actions from:
  - [Approval Policy](/docs/approval-policy)
  - [Policies](/docs/policies)
  - [Notifications](/docs/notifications)

## Error Cases

- Docs imply gate actions finalize approval before automation succeeds
- Docs imply gate actions work on auto-approved or non-human gates
- Docs present gate actions as coordinator-level or hosted automation when the shipped feature is repo-local only
- Docs recommend non-rerunnable commands as if they were safe defaults
- Sidebar or `llms.txt` omit the public route

## Acceptance Tests

- `AT-GADOC-001`: The gate-actions page exists and is wired into the sidebar.
- `AT-GADOC-002`: The page documents the real `gate_actions` config shape and `requires_human_approval: true`.
- `AT-GADOC-003`: The page documents sequential execution, dry-run semantics, and `gate_action_failed`.
- `AT-GADOC-004`: The page documents ledger/report/status evidence and the exported environment variables.
- `AT-GADOC-005`: The page distinguishes gate actions from approval policy, policies, and notifications.
- `AT-GADOC-006`: `llms.txt` includes the `/docs/gate-actions` route.
- `AT-GADOC-007`: CLI and approval-policy docs cross-link to the dedicated gate-actions page.

## Open Questions

None. This is a documentation/discoverability slice for an already-shipped runtime feature.
