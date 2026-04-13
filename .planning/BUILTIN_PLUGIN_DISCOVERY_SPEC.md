# Spec: Built-in Plugin Discovery and Short-Name Install

## Purpose

Operators who install AgentXchain via npm or Homebrew cannot install built-in plugins because the `./plugins/` directory doesn't exist outside the cloned repo. This spec defines how built-in plugins are bundled with the CLI package and discoverable/installable by short name.

## Interface

### `agentxchain plugin list-available [--json]`

Lists built-in plugins that are bundled with the CLI and available for installation.

**Text output:**
```
Available built-in plugins: 3
  slack-notify
    Posts governed lifecycle notifications to a Slack incoming webhook.
    Install: agentxchain plugin install slack-notify
  json-report
    Writes structured JSON lifecycle reports into .agentxchain/reports/.
    Install: agentxchain plugin install json-report
  github-issues
    Mirrors governed run status into a configured GitHub issue using advisory hooks.
    Install: agentxchain plugin install github-issues
```

**JSON output:**
```json
{
  "plugins": [
    {
      "short_name": "slack-notify",
      "name": "@agentxchain/plugin-slack-notify",
      "version": "0.1.0",
      "description": "...",
      "install_command": "agentxchain plugin install slack-notify"
    }
  ]
}
```

### Short-name install

`agentxchain plugin install <short-name>` resolves built-in short names before falling back to npm:

- `slack-notify` → `cli/builtin-plugins/plugin-slack-notify/`
- `json-report` → `cli/builtin-plugins/plugin-json-report/`
- `github-issues` → `cli/builtin-plugins/plugin-github-issues/`

Source type is recorded as `builtin` in `agentxchain.json`.

## Behavior

1. Built-in plugins are copied into `cli/builtin-plugins/` and included in the npm package via the `files` field.
2. `resolvePluginSource()` tries builtin resolution after local path/archive checks but before npm fallback.
3. `listAvailablePlugins()` reads manifests from the bundled directory.
4. Resolution order: local path → archive → builtin short name → npm package.
5. The bundled plugin copies are a packaging mirror of the repo-local plugin source trees. Shipped files (`README.md`, `package.json`, `agentxchain-plugin.json`, and hook files) must stay byte-identical between `plugins/` and `cli/builtin-plugins/`.
6. Packaging proof must validate the actual npm tarball file list, not only `package.json` intent.

## Error Cases

- Unknown short name: falls through to npm fallback (existing behavior).
- Bundled plugin directory missing or corrupt: falls through to npm fallback.

## Acceptance Tests

- AT-PLUGIN-BUILTIN-001: `plugin list-available` lists all 3 built-in plugins
- AT-PLUGIN-BUILTIN-002: `plugin list-available --json` returns structured data
- AT-PLUGIN-BUILTIN-003: `plugin install slack-notify` installs from bundled path
- AT-PLUGIN-BUILTIN-004: `plugin install json-report` installs from bundled path
- AT-PLUGIN-BUILTIN-005: `plugin install github-issues` installs from bundled path
- AT-PLUGIN-BUILTIN-006: short-name install records source type as `builtin`
- AT-PLUGIN-BUILTIN-007: `npm pack --json --dry-run` includes bundled plugin files in the tarball
- AT-PLUGIN-BUILTIN-008: shipped files under `cli/builtin-plugins/` stay byte-identical to their source-plugin counterparts under `plugins/`

## V2 Scope Compliance

This does NOT introduce a plugin marketplace or remote registry (`DEC-V2-SCOPE-005`). It bundles existing plugins with the CLI package and adds a local discovery command. All resolution is local filesystem.
