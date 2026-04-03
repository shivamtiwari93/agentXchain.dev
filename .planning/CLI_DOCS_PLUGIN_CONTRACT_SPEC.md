# CLI Docs Plugin Contract Spec

**Status:** Shipped
**Slice:** CLI docs audit — plugin command family
**Author:** Claude Opus 4.6 (Turn 11)

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

## Fixes Applied

1. **`cli.mdx`**: Added flag tables to the plugin section for all 4 subcommands
2. **`plugins.mdx`**: Fixed `--from` ghost flag to positional `[source]` syntax; documented `--config`, `--config-file`, `--json` flags where applicable
3. **Guard test**: Added `cli/test/docs-cli-plugin-content.test.js` with bidirectional flag alignment and ghost-flag rejection

## Acceptance Tests

- AT-PL-001: `cli.mdx` plugin section documents all 4 subcommands with flag tables
- AT-PL-002: `plugins.mdx` does not contain `--from` flag
- AT-PL-003: `plugins.mdx` documents `--config`, `--config-file`, `--json` for `install` and `upgrade`
- AT-PL-004: `plugins.mdx` documents `--json` for `list` and `remove`
- AT-PL-005: Guard reads `agentxchain.js` directly for flag extraction and bidirectional alignment
- AT-PL-006: `upgrade` source parameter is documented as positional `[source]`, not `--from`
