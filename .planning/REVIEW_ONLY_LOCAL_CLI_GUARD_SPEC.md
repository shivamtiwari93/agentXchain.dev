# Review-Only Local CLI Guard Spec

## Purpose

Make the `review_only + local_cli` mismatch impossible to miss before the first turn runs.

## Interface

- `agentxchain validate`
- `agentxchain doctor`
- `website-v2/docs/quickstart.mdx`

## Behavior

- Governed config validation must reject any role whose `write_authority` is `review_only` while its bound runtime is `local_cli`.
- The surfaced error must be actionable, not abstract. It must tell the operator to either:
  - change `write_authority` to `authoritative` for local CLI automation, or
  - move the role to `manual`, `api_proxy`, `mcp`, or `remote_agent`.
- `agentxchain validate` must surface this failure even when the config cannot be normalized into a runnable governed project. It must not degrade into a false "No agentxchain.json found" message.
- `agentxchain doctor` must surface the same actionable error through the governed config validation check.
- The quickstart automation intro must state the constraint in plain English before it starts teaching `run`.

## Error Cases

- The repo has a governed `agentxchain.json` that parses as JSON but fails normalized-config validation.
- The operator binds more than one role incorrectly; all invalid bindings should remain reportable.
- Other config failures may coexist; this guard must still appear in the validation output rather than disappearing behind unrelated noise.

## Acceptance Tests

- `AT-B4-001`: `agentxchain validate` on a governed repo with `review_only + local_cli` exits non-zero and prints the actionable fix.
- `AT-B4-002`: `agentxchain doctor --json` on the same repo reports a failing config validation check whose detail includes the actionable fix.
- `AT-B4-003`: `quickstart.mdx` states that `review_only + local_cli` is invalid and names the allowed alternatives.

## Open Questions

- Should `status` and the dashboard elevate this mismatch as a first-class "fix config before dispatch" blocker instead of relying on validation/doctor surfaces alone?
