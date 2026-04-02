# Built-In Plugin Packages Spec

> Contract for the first two built-in plugin packages shipped in the repo under `plugins/`.

---

## Purpose

Close the last explicit v2 scope commitment that still existed only as prose in `V2_SCOPE_BOUNDARY.md`.

The built-in packages are reference integrations that prove the plugin packaging model is real:

- `@agentxchain/plugin-slack-notify`
- `@agentxchain/plugin-json-report`

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

---

## Error Cases

1. If either built-in package is missing `agentxchain-plugin.json` or fails manifest validation, the test fails because v2 built-ins are not installable artifacts.
2. If Slack notify requires unpublished package resolution to be usable, the test fails because the repo-local install path is the real shipped surface.
3. If Slack notify returns `block` for missing webhook or delivery failure, the test fails because notification plugins must be advisory.
4. If JSON report writes outside `.agentxchain/reports/`, the test fails because report artifacts must stay scoped to the governed project.
5. If plugin install does not rewrite hook command paths for the built-in packages, the test fails because the packages are not actually installable through the plugin lifecycle.

---

## Acceptance Tests

1. `AT-BUILTIN-PLUGIN-001`: both built-in plugin packages exist and their manifests validate.
2. `AT-BUILTIN-PLUGIN-002`: the built-in packages install from repo-local paths through the normal plugin install flow.
3. `AT-BUILTIN-PLUGIN-003`: the Slack plugin posts webhook notifications for acceptance, gate, and escalation hooks and degrades to `warn` when webhook configuration is missing.
4. `AT-BUILTIN-PLUGIN-004`: the JSON report plugin writes timestamped and latest report artifacts for acceptance and gate hooks.

---

## Open Questions

1. npm publication of the built-in packages is deferred. v2 requires the packages to exist and install locally from the repo; publishing them as standalone registry packages is release packaging work, not a prerequisite for the component contract.
