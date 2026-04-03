# V2.1 Plugin Hardening Spec

> Enforced plugin configuration plus atomic upgrade flow for AgentXchain governed projects.

---

## Purpose

Phase 1 plugins proved packaging, install, list, and remove. They did not harden lifecycle integrity:

- `config_schema` was recorded but not enforced
- upgrades required remove-then-install, which is not atomic and can drop hooks or config on failure

This v2.1 component closes those gaps without pretending HTTP hooks belong in the same implementation slice. HTTP transport changes the hook execution boundary and can be shipped separately. Plugin hardening is a self-contained lifecycle contract and should be implemented as one clean surface.

---

## Interface

### CLI

- `agentxchain plugin install <source> [--config <json> | --config-file <path>]`
- `agentxchain plugin upgrade <name> [source] [--config <json> | --config-file <path>]`
- `agentxchain plugin list [--json]`
- `agentxchain plugin remove <name> [--json]`

### Stored metadata

Installed plugin metadata under `agentxchain.json.plugins.<name>` gains:

- `config_schema`: copied from the manifest
- `config`: validated JSON config when provided, or validated default `{}` when the schema exists and no config is supplied

### Runtime env

Installed plugin hooks receive:

- `AGENTXCHAIN_PLUGIN_NAME`
- `AGENTXCHAIN_PLUGIN_VERSION`
- `AGENTXCHAIN_PLUGIN_CONFIG` when validated config exists

This keeps plugin config usable at runtime without inventing a second config file format.

---

## Behavior

### Config enforcement

1. If a plugin manifest declares `config_schema`, install and upgrade validate config against it before any hook merge or config write.
2. If a plugin declares no `config_schema`, passing `--config` or `--config-file` is rejected.
3. Existing installed plugin metadata is validated when plugin lifecycle commands load the project. Invalid stored plugin config blocks further plugin lifecycle mutation until fixed.
4. The stored validated config is injected into plugin hooks via `AGENTXCHAIN_PLUGIN_CONFIG`.

### Upgrade flow

1. Upgrade resolves the source from the explicit `[source]` argument or the installed plugin's recorded `source.spec`.
2. The upgrade source manifest name must match the installed plugin name exactly.
3. The new plugin payload is staged first.
4. The current plugin hooks are stripped from a cloned config, then the new hooks are merged. Hook-name collisions against non-plugin hooks or other plugins still fail closed.
5. Filesystem replacement is atomic from the operator's perspective:
   - move current install to a rollback path
   - move staged upgrade into the canonical install path
   - commit updated `agentxchain.json`
6. If any step after staging fails, rollback restores both:
   - the prior plugin install directory
   - the prior config file contents

---

## Error Cases

1. If plugin config violates `config_schema`, install or upgrade fails before plugin hooks are merged or copied into active config.
2. If plugin config is provided for a plugin with no `config_schema`, install or upgrade fails because there is no contract to validate against.
3. If an upgrade source manifest name differs from the installed plugin name, upgrade fails with no mutation.
4. If hook names from the new version collide with existing non-plugin hooks, upgrade fails with no mutation.
5. If config commit fails after the upgraded files are swapped into place, rollback restores the prior install and config.
6. If the existing install path is missing or unsafe, upgrade fails rather than pretending rollback is possible.

---

## Acceptance Tests

1. `AT-V21-005`: plugin upgrade is atomic and rolls back cleanly on failure.
2. `AT-V21-006`: invalid plugin config is rejected via enforced `config_schema` before runtime use.
3. `AT-V21-PLUGIN-001`: validated plugin config is stored in plugin metadata and injected into hook runtime env.
4. `AT-V21-PLUGIN-002`: happy-path upgrade keeps the canonical install path stable while replacing plugin version and hooks.

---

## Open Questions

1. Should a future plugin config surface support interactive prompts, or is JSON-only operator input sufficient?
2. Should plugin config validation eventually run on generic project load as a hard config error, or remain scoped to plugin lifecycle commands plus validated runtime snapshots?
