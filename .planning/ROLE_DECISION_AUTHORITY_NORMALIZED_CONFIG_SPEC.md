## Purpose

Freeze the `agentxchain role` authority-inspection contract after normalized governed config began preserving `role.decision_authority`.

## Interface

- `agentxchain role list`
- `agentxchain role list --json`
- `agentxchain role show <role_id>`
- `agentxchain role show <role_id> --json`

## Behavior

- Role inspection reads `decision_authority` from normalized governed role objects.
- `role list --json` includes `decision_authority` when the role declares it.
- human-readable `role list` includes the compact `dec:<n>` suffix when configured.
- `role show --json` includes `decision_authority` when configured.
- human-readable `role show` prints a `Decision:` line when configured.
- Roles that do not declare `decision_authority` do not receive invented defaults.
- `agentxchain role` does not special-case `rawConfig` for authority metadata once normalization preserves the field.

## Error Cases

- Repos without `agentxchain.json` still fail with the existing init guidance.
- Legacy non-v4 repos still fail with the existing governed-project requirement.
- Unknown roles still fail with the existing available-role guidance.

## Acceptance Tests

- `cli/test/role-command.test.js` proves `role list --json` returns `decision_authority` for configured roles.
- `cli/test/role-command.test.js` proves `role show --json` returns `decision_authority` for configured roles.
- `cli/test/role-command.test.js` proves human-readable `role show` still prints `Decision: <n>`.

## Open Questions

- None for this slice. Normalized config is now the contract owner for role authority metadata.
