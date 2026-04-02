# Plugin System Phase 1 Spec

> Minimal installable plugin surface for governed AgentXchain projects

---

## Purpose

Ship the first real extensibility surface on top of the existing hook system without inventing a marketplace or a second execution model.

Phase 1 plugins are packaging and lifecycle management for hooks:

- operators install a plugin from a local path or npm package spec
- the CLI copies the plugin into the governed project under `.agentxchain/plugins/`
- the CLI merges the plugin's hook definitions into `agentxchain.json`
- operators can list installed plugins and remove them cleanly later

This is not dynamic discovery, sandboxing, or remote execution. Plugins remain governed hook subprocesses with the same trust model and tamper protections as hand-written hooks.

---

## Interface

### Manifest

Each plugin root must contain `agentxchain-plugin.json`:

```json
{
  "schema_version": "0.1",
  "name": "@agentxchain/plugin-slack-notify",
  "version": "1.0.0",
  "description": "Posts governed lifecycle notifications to Slack.",
  "hooks": {
    "after_acceptance": [
      {
        "name": "slack_notify_acceptance",
        "type": "process",
        "command": ["node", "./hooks/after-acceptance.js"],
        "timeout_ms": 3000,
        "mode": "advisory"
      }
    ]
  },
  "config_schema": {
    "type": "object"
  }
}
```

Required fields:

- `schema_version`
- `name`
- `version`
- `hooks`

Optional fields:

- `description`
- `config_schema`

### CLI

- `agentxchain plugin install <path|npm-package>`
- `agentxchain plugin list`
- `agentxchain plugin remove <name>`

All three commands operate only on governed projects (`schema_version: "1.0"`).

`plugin list` supports `--json`.

`plugin install` and `plugin remove` support `--json`.

---

## Behavior

### Install

1. Resolve the source:
   - if `<path>` exists on disk and is a directory, treat it as a plugin root
   - if `<path>` exists on disk and is a `.tgz`/`.tar.gz` archive, extract it
   - otherwise resolve it as an npm package spec via `npm pack <spec>`
2. Read and validate `agentxchain-plugin.json`.
3. Refuse install if the plugin name is already installed.
4. Refuse install if any plugin hook name would collide with an existing hook name in the same phase.
5. Copy the plugin payload into `.agentxchain/plugins/<derived-id>/`.
6. Rewrite plugin hook command entries so plugin-relative file paths still resolve after installation.
   - any command token beginning with `./` or `../` is rewritten to the installed project-relative path
7. Merge hooks into `agentxchain.json`.
8. Record plugin metadata in `agentxchain.json.plugins`.

### List

List reads `agentxchain.json.plugins` and reports:

- plugin name
- version
- install path
- source type/spec
- declared hook bindings by phase
- whether the install directory still exists on disk

### Remove

1. Refuse removal if the named plugin is not installed.
2. Remove only the hook names recorded for that plugin.
3. Preserve unrelated operator-defined hooks.
4. Delete the plugin metadata entry.
5. Delete the installed plugin directory under `.agentxchain/plugins/`.

---

## Error Cases

- non-governed project: reject all plugin commands
- missing `agentxchain-plugin.json`: reject install
- invalid manifest shape: reject install with concrete field errors
- invalid hook config inside manifest: reject install
- plugin already installed: reject install
- phase-scoped hook-name collision with existing config: reject install, no mutation
- install directory collision: reject install, no mutation
- npm pack failure: reject install with captured stderr/stdout context
- plugin metadata points outside `.agentxchain/plugins/`: reject removal as unsafe
- partial install failure after copy but before config write: remove staged install directory and leave config unchanged

---

## Acceptance Tests

- `AT-PLUGIN-001`: install from local directory copies plugin payload, rewrites hook paths, merges hooks, and records plugin metadata
- `AT-PLUGIN-002`: install from npm-style package spec (`file:` in test) succeeds through the `npm pack` path
- `AT-PLUGIN-003`: hook-name collision rejects install with no config or filesystem mutation
- `AT-PLUGIN-004`: list returns installed plugin metadata and hook bindings
- `AT-PLUGIN-005`: remove deletes plugin metadata, removes only that plugin's hooks, and deletes the install directory
- `AT-PLUGIN-006`: legacy / non-governed projects reject plugin commands

---

## Open Questions

- `config_schema` is recorded but not enforced in phase 1 because plugin-specific configuration injection does not exist yet.
- Signed plugins, trust policies, and execution isolation are explicitly out of scope for phase 1.
- Reinstall or upgrade flows are deferred. Phase 1 requires remove then install.
