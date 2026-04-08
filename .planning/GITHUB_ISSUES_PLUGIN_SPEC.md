# GitHub Issues Plugin Spec

> Reference ticketing integration for governed runs

---

## Purpose

Prove that AgentXchain can participate in a real ticketing surface without lying about lifecycle authority.

The first slice is intentionally narrow:

- bind one governed project to one operator-specified GitHub issue
- write one plugin-owned run-status comment per run
- keep phase and blocked labels synchronized when the shipped hook phases make that truthful

This is not a generic GitHub sync engine and it is not a full issue-lifecycle manager.

---

## Interface

### Package

- Package name: `@agentxchain/plugin-github-issues`
- Install path: `./plugins/plugin-github-issues`
- Hook phases:
  - `after_acceptance`
  - `on_escalation`

### Plugin config

```json
{
  "repo": "owner/name",
  "issue_number": 42,
  "token_env": "GITHUB_TOKEN",
  "api_base_url": "https://api.github.com",
  "label_prefix": "agentxchain"
}
```

### Config fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `repo` | string | Yes | Authoritative issue repository in `owner/name` form |
| `issue_number` | integer | Yes | Authoritative issue number |
| `token_env` | string | No | Env var containing the GitHub token. Default runtime fallback: `GITHUB_TOKEN` |
| `api_base_url` | string | No | GitHub API base URL. Supports GitHub Enterprise and local test servers |
| `label_prefix` | string | No | Managed label prefix. Default runtime fallback: `agentxchain` |

Issue identity is operator-supplied config. The plugin does not infer the issue from branch names, prompt text, or repo files.

---

## Behavior

### `after_acceptance`

1. Read the hook envelope from stdin.
2. Load plugin config from `AGENTXCHAIN_PLUGIN_CONFIG`.
3. Resolve the GitHub token from `token_env` or `GITHUB_TOKEN`.
4. Upsert a single plugin-owned issue comment keyed by `run_id`.
5. Synchronize managed labels to:
   - `<label_prefix>`
   - `<label_prefix>:phase:<phase>`
6. Remove any previously-managed phase or blocked labels before writing the new set.
7. Return `allow` on successful GitHub API writes.

### `on_escalation`

1. Read the hook envelope from stdin.
2. Upsert the same plugin-owned issue comment for the current `run_id`.
3. Synchronize managed labels to:
   - `<label_prefix>`
   - `<label_prefix>:blocked`
4. Return `allow` on successful GitHub API writes.

### Comment contract

- One comment per run, not one comment per turn
- Stable marker: `<!-- agentxchain:github-issues:run:<run_id> -->`
- Re-runs update the existing plugin-owned comment instead of appending duplicates
- The body must include:
  - run id
  - latest event (`after_acceptance` or `on_escalation`)
  - latest known phase or blocked state
  - latest turn / role context when present
  - timestamp

### Why no issue open/close lifecycle in v1

The current shipped hook surface has no post-gate hook. That means the plugin cannot truthfully know when:

- a `before_gate` approval was actually granted
- a phase transition actually committed
- a run completion approval actually closed the run

Because that evidence does not exist in the hook contract, v1 must not:

- close GitHub issues automatically
- reopen issues automatically
- set persistent `awaiting approval` labels that it cannot clear truthfully

Anything broader would be fake lifecycle authority.

---

## Failure Semantics

- The plugin is advisory in all shipped phases.
- Missing token, missing config, invalid repo format, or GitHub API failure return `warn`, not `block`.
- The governed run remains authoritative; GitHub is an external mirror, not the source of truth.

---

## Error Cases

1. If `repo` or `issue_number` is missing or invalid, install must fail via `config_schema`.
2. If the configured token env var is unset at runtime, the hook must return `warn`.
3. If the issue fetch/comment/label API returns non-2xx, the hook must return `warn`.
4. If the same run triggers the hook multiple times, the plugin must update its prior comment instead of creating duplicates.
5. If the issue already has non-AgentXchain labels, the plugin must preserve them.
6. If the run moves from blocked back to accepted work, the plugin must remove the managed blocked label on the next accepted turn update.
7. If the run reaches a human approval gate, the plugin must not claim completion or approval because there is no post-gate hook.

---

## Acceptance Tests

1. `AT-GHI-001`: manifest exists, validates, and matches the package metadata.
2. `AT-GHI-002`: repo-local install succeeds through the normal plugin lifecycle.
3. `AT-GHI-003`: `after_acceptance` creates or updates exactly one comment per run and syncs phase labels while preserving unrelated labels.
4. `AT-GHI-004`: `on_escalation` updates the same run comment and replaces managed phase labels with the managed blocked label.
5. `AT-GHI-005`: missing token degrades to `warn` instead of blocking the governed run.
6. `AT-GHI-006`: the plugin never claims issue closure, approval completion, or other post-gate state the hook surface cannot prove.

---

## Open Questions

1. Multi-issue routing is deferred. v1 binds one governed project install to one GitHub issue.
2. True issue lifecycle management should wait for a shipped post-gate hook or another evidence-backed completion callback.
