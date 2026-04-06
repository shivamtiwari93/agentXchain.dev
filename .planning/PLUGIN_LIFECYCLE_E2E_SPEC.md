# Plugin Lifecycle E2E Proof Spec

**Status:** Shipped
**Owner:** GPT 5.4
**Depends on:** `PLUGIN_HOOK_SYSTEM_SPEC.md`, `AGENTXCHAIN_RUN_SPEC.md`

---

## Purpose

Prove that the shipped plugin lifecycle is real in the governed run path, not just in config-editing helpers.

The current test surface already proves manifest validation, install/list/remove/upgrade commands, config-schema enforcement, and rollback behavior. That is necessary but not sufficient. The remaining product question is whether a plugin that the CLI installs actually executes during a real `agentxchain run`, whether an upgraded plugin changes that execution surface, and whether a removed plugin is truly gone from that surface.

This proof closes that gap.

---

## Interface

### New proof surface

- Test file: `cli/test/e2e-plugin-lifecycle.test.js`

### Commands exercised

- `agentxchain plugin install`
- `agentxchain plugin upgrade`
- `agentxchain plugin remove`
- `agentxchain run`

### Runtime strategy

- Use a real governed project scaffolded through `scaffoldGoverned()`.
- Patch governed runtimes to `local_cli` backed by the existing `mock-agent.mjs` so the full governed run can complete deterministically.
- Use repo-local temporary plugins with `after_acceptance` process hooks that append JSON evidence to a temp file and return `{ "verdict": "allow" }`.
- Assertions must read:
  - the plugin evidence file written by the hook itself
  - `.agentxchain/hook-audit.jsonl`
  - `agentxchain.json`

No direct calls to `runHooks()` count for this proof. The hooks must execute through the real `run` lifecycle.

---

## Behavior

### Install and execute

1. Create a governed project.
2. Install a temp plugin with an `after_acceptance` hook and a required config field `output_file`.
3. Run `agentxchain run --auto-approve --max-turns 5`.
4. The plugin hook must execute during the real run and append one JSON line per accepted turn.
5. `.agentxchain/hook-audit.jsonl` must record the same hook name and `after_acceptance` phase entries.

### Upgrade and execute upgraded code

1. Create a governed project.
2. Install plugin version `1.0.0` with config.
3. Upgrade the same plugin to version `2.0.0` from a second source directory without re-supplying config.
4. Run `agentxchain run --auto-approve --max-turns 5`.
5. The hook evidence must show the upgraded version executed, not the stale original implementation.
6. The installed plugin path must remain stable across upgrade.

### Remove and prove absence

1. Create a governed project.
2. Install the temp plugin.
3. Remove it with `agentxchain plugin remove`.
4. Run `agentxchain run --auto-approve --max-turns 5`.
5. No plugin evidence file may be created.
6. No plugin hook entries may exist in `.agentxchain/hook-audit.jsonl`.

---

## Error Cases

- If the proof calls `runHooks()` directly, it is invalid. That only proves the hook runner, not plugin lifecycle continuity through `run`.
- If the upgrade proof only checks `agentxchain.json` version metadata but not runtime output, it is invalid. That does not prove the new plugin code is what actually ran.
- If the remove proof only checks `plugins` metadata removal but not the run path, it is invalid. Hooks could still be left in config or on disk.
- If the proof rewrites `agentxchain.json` by hand to simulate install, upgrade, or remove, it is invalid.

---

## Acceptance Tests

1. `AT-PLUGIN-E2E-001`: `plugin install` followed by real `run` executes the plugin hook on each accepted turn and records hook-audit entries.
2. `AT-PLUGIN-E2E-002`: `plugin upgrade` preserves install path, keeps prior validated config when no new config is supplied, and real `run` executes the upgraded plugin version.
3. `AT-PLUGIN-E2E-003`: `plugin remove` strips the hook from the real `run` path; no plugin evidence file or hook-audit entries are produced afterward.

---

## Open Questions

1. Should a follow-on E2E prove built-in plugins through real external transports, for example a live local webhook receiver for `@agentxchain/plugin-slack-notify`?
2. Should a future slice prove plugin behavior in the multi-repo coordinator hook surface, or is governed-run proof sufficient for the current bar?
