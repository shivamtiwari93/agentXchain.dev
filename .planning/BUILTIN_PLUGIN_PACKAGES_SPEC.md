# Built-In Plugin Packages Spec

> Contract for the built-in plugin packages shipped in the repo under `plugins/`.

---

## Purpose

Close the last explicit v2 scope commitment that still existed only as prose in `V2_SCOPE_BOUNDARY.md`.

The built-in packages are reference integrations that prove the plugin packaging model is real:

- `@agentxchain/plugin-slack-notify`
- `@agentxchain/plugin-json-report`
- `@agentxchain/plugin-github-issues`

They must be installable today from repo-local paths, must validate as normal plugins, and must perform useful hook work without any unpublished marketplace or special runtime.

---

## Interface

### Package layout

Each built-in plugin package lives under `plugins/<package-dir>/` and includes:

- `package.json`
- `agentxchain-plugin.json`
- `README.md`
- hook scripts under `hooks/`

### `@agentxchain/plugin-slack-notify`

- Install path: `./plugins/plugin-slack-notify`
- Hook phases:
  - `after_acceptance`
  - `before_gate`
  - `on_escalation`
- Runtime configuration:
  - reads webhook URL from `AGENTXCHAIN_SLACK_WEBHOOK_URL`
  - falls back to `SLACK_WEBHOOK_URL`
  - optional `AGENTXCHAIN_SLACK_MENTION` prefix

### `@agentxchain/plugin-json-report`

- Install path: `./plugins/plugin-json-report`
- Hook phases:
  - `after_acceptance`
  - `before_gate`
  - `on_escalation`
- Output location:
  - `.agentxchain/reports/`
- Required outputs:
  - timestamped report file per invocation
  - `latest.json`
  - `latest-<hook_phase>.json`

### `@agentxchain/plugin-github-issues`

- Install path: `./plugins/plugin-github-issues`
- Hook phases:
  - `after_acceptance`
  - `on_escalation`
- Runtime configuration:
  - `repo` in `owner/name` form
  - `issue_number`
  - optional `token_env`
  - optional GitHub API base URL override
  - optional managed `label_prefix`

---

## Behavior

### Slack notify

1. Read the hook envelope from stdin.
2. Build a concise text notification using the hook phase plus key payload fields.
3. POST JSON to the configured Slack incoming webhook URL.
4. Return:
   - `allow` on 2xx response
   - `warn` if webhook env is missing
   - `warn` if the request fails or returns non-2xx

The hook is advisory in all phases. Notification failure must never block governed progress.

### JSON report

1. Read the hook envelope from stdin.
2. Write a structured JSON report containing:
   - plugin name
   - hook phase
   - run id / turn id
   - timestamp
   - payload
3. Persist the report to `.agentxchain/reports/`.
4. Refresh `latest.json` and `latest-<hook_phase>.json`.
5. Return `allow` on success.

The JSON report plugin is intentionally filesystem-local so CI jobs and operators can consume artifacts without external services.

### GitHub issues

1. Read the hook envelope from stdin.
2. Resolve a configured GitHub issue from plugin config.
3. Upsert one plugin-owned comment per run using the run id marker.
4. Sync only managed labels:
   - phase label on `after_acceptance`
   - blocked label on `on_escalation`
5. Preserve non-AgentXchain labels already on the issue.
6. Return:
   - `allow` on successful GitHub API writes
   - `warn` if config, token, or API calls fail

The GitHub plugin is intentionally advisory. It mirrors governed truth into an issue. It does not close issues or claim post-gate approval state because the shipped hook surface does not provide post-gate evidence.

---

## Error Cases

1. If either built-in package is missing `agentxchain-plugin.json` or fails manifest validation, the test fails because v2 built-ins are not installable artifacts.
2. If Slack notify requires unpublished package resolution to be usable, the test fails because the repo-local install path is the real shipped surface.
3. If Slack notify returns `block` for missing webhook or delivery failure, the test fails because notification plugins must be advisory.
4. If JSON report writes outside `.agentxchain/reports/`, the test fails because report artifacts must stay scoped to the governed project.
5. If plugin install does not rewrite hook command paths for the built-in packages, the test fails because the packages are not actually installable through the plugin lifecycle.
6. If the GitHub issues plugin duplicates comments for the same run, the test fails because idempotent run binding is broken.
7. If the GitHub issues plugin removes unrelated issue labels, the test fails because external ticket metadata must be preserved.
8. If the GitHub issues plugin claims issue closure or approval completion, the test fails because the hook surface cannot prove post-gate state.

---

## Acceptance Tests

1. `AT-BUILTIN-PLUGIN-001`: all built-in plugin packages exist and their manifests validate.
2. `AT-BUILTIN-PLUGIN-002`: the built-in packages install from repo-local paths through the normal plugin install flow.
3. `AT-BUILTIN-PLUGIN-003`: the Slack plugin posts webhook notifications for acceptance, gate, and escalation hooks and degrades to `warn` when webhook configuration is missing.
4. `AT-BUILTIN-PLUGIN-004`: the JSON report plugin writes timestamped and latest report artifacts for acceptance and gate hooks.
5. `AT-BUILTIN-PLUGIN-005`: the GitHub issues plugin upserts one comment per run, preserves unrelated labels, switches managed phase/blocked labels truthfully, and degrades to `warn` when token configuration is missing.

---

## Open Questions

1. npm publication of the built-in packages is deferred. v2 requires the packages to exist and install locally from the repo; publishing them as standalone registry packages is release packaging work, not a prerequisite for the component contract.
