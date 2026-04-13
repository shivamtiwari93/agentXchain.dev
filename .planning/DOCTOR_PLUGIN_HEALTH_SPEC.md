# Spec: Doctor Plugin Health Check

## Purpose

Add installed plugin health verification to `agentxchain doctor` so operators know whether their plugins are functional before starting a governed run.

## Problem

`doctor` checks config, roles, runtimes, state, schedules, and workflow-kit artifacts — but completely ignores installed plugins. An operator can install `slack-notify`, run `doctor`, see "Governed project is ready", then get a runtime hook failure mid-turn because `SLACK_WEBHOOK_URL` is unset or the hook files are missing.

## Interface

No new commands. Extends the existing `doctor` output with a new check section.

### New checks (per installed plugin):

| Check ID | Name | Level | Detail |
|----------|------|-------|--------|
| `plugin_<name>` | Plugin: `<name>` | pass/warn/fail | Status message |

### Check logic:

For each plugin in `rawConfig.plugins`:
1. **Install path exists** — `meta.install_path` resolves to an existing directory → fail if missing
2. **Manifest valid** — `agentxchain-plugin.json` exists and parses as valid JSON → fail if broken
3. **Hook files exist** — every hook file referenced in the manifest exists at the install path → fail if missing
4. **Config env vars set** (warn only) — if the manifest declares `config_schema` with env-backed fields (e.g., `webhook_env`), and the plugin has install-time config referencing env vars, warn if those vars are unset

## Behavior

- Plugin checks only appear when `rawConfig.plugins` has entries (like schedule checks only appear when schedules exist)
- Each plugin gets its own check entry in the `checks` array
- A missing install path or broken manifest is a `fail`
- A missing env var for plugin config is a `warn` (plugin may still work with defaults)
- JSON output includes plugin checks in the same `checks` array as all other checks
- Text output renders plugin checks with the same PASS/WARN/FAIL badges

## Error Cases

- No plugins installed → no plugin checks rendered (same as schedules)
- Plugin install path exists but manifest is corrupt → `fail` with parse error
- Plugin hook file declared but missing → `fail` with file path
- Plugin env var missing → `warn` with var name

## Acceptance Tests

- AT-DOCTOR-PLUGIN-001: `doctor --json` includes plugin health check when plugins are installed
- AT-DOCTOR-PLUGIN-002: `doctor` reports `fail` when a plugin's install path is missing
- AT-DOCTOR-PLUGIN-003: `doctor` reports `fail` when a plugin's manifest is corrupt JSON
- AT-DOCTOR-PLUGIN-004: `doctor` reports `warn` when a plugin's config env var is unset
- AT-DOCTOR-PLUGIN-005: `doctor` omits plugin checks when no plugins are installed
- AT-DOCTOR-PLUGIN-006: `doctor --json` plugin check includes `plugin_name` field for programmatic consumption

## Open Questions

None — this is a narrow extension of an existing surface.
