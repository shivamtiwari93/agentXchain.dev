# CLI Docs Plugin Contract Spec

**Status:** Shipped
**Slice:** CLI docs audit — plugin command family
**Author:** Claude Opus 4.6 (Turn 11), GPT 5.4 (Turn 2)

## Purpose

Ensure the `/docs/cli` plugin section and `/docs/plugins` deep-dive page accurately reflect the shipped plugin command surface in `cli/bin/agentxchain.js` and `cli/src/commands/plugin.js`.

## Audit Findings

### 1. Ghost flag: `--from` in `plugins.mdx`

**Docs (plugins.mdx line 183):**
```bash
agentxchain plugin upgrade plugin-slack-notify --from ./downloads/plugin-slack-notify-1.3.0.tar.gz
```

**Code (agentxchain.js line 315):**
```js
.command('upgrade <name> [source]')
```

The `--from` flag does not exist. The source is a positional argument `[source]`. An operator following the docs would get a flag error.

### 2. Missing flags in `cli.mdx`

The plugin section in `cli.mdx` (lines 325-340) has NO flag tables. Only a subcommand table exists.

### 3. Missing flags in `plugins.mdx`

| Subcommand | Missing Flags |
|------------|---------------|
| `install` | `--config`, `--config-file`, `--json` |
| `list` | `--json` (mentioned casually in an example, not documented as a flag) |
| `remove` | `--json` |
| `upgrade` | `--config`, `--config-file`, `--json` |

### 4. Existing guard coverage gap

`cli/test/plugin-docs-content.test.js` checks string presence only. It does not validate flags, flag-to-code alignment, or positional parameter signatures.

### 5. Ghost prose feature: `--force` in `plugins.mdx`

`cli/src/commands/plugin.js` and `cli/src/lib/plugins.js` do not accept or honor a `force` option for `plugin install`. The prose sentence "rejects unless `--force` is passed" was therefore a ghost feature, not just an undocumented flag.

### 6. `plugins.mdx` documented the wrong manifest and hook schema

The live page had drifted away from the shipped plugin contract:

- manifest example used `hooks: []` instead of the shipped phase-keyed `hooks: {}`
- hook definitions used `event`, `script`, and `run` fields instead of shipped `name`, `type`, `command`, `mode`, and optional `env`
- the page centered legacy lifecycle event names such as `turn:accepted` and `gate:transition` instead of the shipped hook phases

This was not cosmetic drift. A plugin author following the page would build an invalid manifest.

### 7. Install/list/authoring behavior was materially misdocumented

The old page also claimed behavior the CLI does not ship:

- archive install accepted `zip` files, but the implementation only extracts `.tgz` / `.tar.gz`
- same-event collisions were "allowed but logged as warnings", but duplicate hook names in the same phase are rejected
- process hooks consumed temp payload/config files, but the runner actually sends JSON on stdin and injects `AGENTXCHAIN_PLUGIN_CONFIG` as a JSON string env var
- HTTP hooks documented `ok` / `fail` verdicts, context-based header interpolation, and retry behavior that the hook runner does not implement
- built-in package examples used obsolete names and config shapes instead of the shipped scoped package names and schemas

## Fixes Applied

1. **`cli.mdx`**: Added flag tables to the plugin section for all 4 subcommands
2. **`plugins.mdx`**: Fixed `--from` ghost flag to positional `[source]` syntax; removed the ghost `--force` prose claim; documented `--config`, `--config-file`, `--json` flags where applicable
3. **`plugins.mdx`**: Rewrote the deep-dive page to match the shipped manifest schema, hook phases, process/http definitions, CLI output shape, runtime contract, and built-in package examples
4. **Guard tests**:
   - `cli/test/docs-cli-plugin-content.test.js` keeps the bidirectional flag-alignment checks
   - `cli/test/plugin-docs-content.test.js` now rejects obsolete manifest/event/runtime claims and asserts the shipped plugin contract directly from docs content
5. **Runtime proof**: `cli/test/plugin-cli.test.js` now proves duplicate install rejection and confirms the CLI does not accept a hidden `--force` override

## Acceptance Tests

- AT-PL-001: `cli.mdx` plugin section documents all 4 subcommands with flag tables
- AT-PL-002: `plugins.mdx` does not contain `--from` flag
- AT-PL-003: `plugins.mdx` documents `--config`, `--config-file`, `--json` for `install` and `upgrade`
- AT-PL-004: `plugins.mdx` documents `--json` for `list` and `remove`
- AT-PL-005: Guard reads `agentxchain.js` directly for flag extraction and bidirectional alignment
- AT-PL-006: `upgrade` source parameter is documented as positional `[source]`, not `--from`
- AT-PL-007: `plugins.mdx` does not claim `--force` exists unless the CLI actually registers it
- AT-PL-008: `plugins.mdx` documents `agentxchain-plugin.json` with a phase-keyed `hooks` object, not an event array
- AT-PL-009: `plugins.mdx` documents shipped hook phases and does not center obsolete lifecycle event names like `turn:accepted`
- AT-PL-010: `plugins.mdx` documents process hooks as JSON-stdin subprocesses and `AGENTXCHAIN_PLUGIN_CONFIG` as JSON env, not temp-file paths
- AT-PL-011: `plugins.mdx` documents actual CLI JSON output shapes for `plugin list` and installed plugin metadata
- AT-PL-012: `plugin install` rejects duplicate installs and the CLI rejects an unsupported `--force` flag at runtime
