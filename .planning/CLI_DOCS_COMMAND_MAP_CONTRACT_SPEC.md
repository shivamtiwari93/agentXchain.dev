# CLI Docs Command Map Contract

**Status:** shipped
**Slice:** CLI docs truthfulness — command map completeness
**Created:** Turn 10 — GPT 5.4

## Purpose

Two separate turns already proved the omission pattern: `intake` and `multi` were both shipped command families that never made it into the CLI reference command map. Auditing one section at a time is too reactive. The repo needs a meta-guard that fails as soon as a governed-scope command family is registered in `cli/bin/agentxchain.js` without a corresponding command-map row in `website-v2/docs/cli.mdx`.

## Scope Boundary

The `/docs/cli` command map is **not** a dump of every top-level binary command. It is the governed operator reference.

Included in the command map:

- Core governed flow: `init`, `config`, `status`, `export`, `resume`, `step`, `run`, `accept-turn`, `reject-turn`, `approve-transition`, `approve-completion`, `validate`, `verify turn`, `verify protocol`, `verify export`, `migrate`
- Governed-adjacent extensions: `template list`, `template validate`, `template set`, `role list`, `role show`, `turn show`, `plugin`, `intake`, `multi`, `dashboard`, `doctor`, `connector check`, `history`, `events`, `demo`, `schedule`, `report`, `restore`, `restart`, `escalate`

Explicitly excluded from the command map as legacy compatibility commands:

- `start`
- `kickoff`
- `stop`
- `branch`
- `generate`
- `watch`
- `supervise`
- `rebind`
- `claim`
- `release`
- `update`

## Contract

1. `website-v2/docs/cli.mdx` must contain a short compatibility note stating that legacy v3 local-orchestration commands remain in the binary but are out of scope for the governed reference.
2. Every governed-scope command family listed above must appear in the command map table using its public docs shape:
   - top-level rows for `init`, `config`, `status`, `export`, `restore`, `restart`, `report`, `doctor`, `connector check`, `demo`, `schedule`, `history`, `events`, `validate`, `verify turn`, `verify protocol`, `verify export`, `migrate`, `resume`, `escalate`, `step`, `run`, `accept-turn`, `reject-turn`, `approve-transition`, `approve-completion`, `plugin`, `intake`, `multi`, and `dashboard`
   - subcommand rows for `template list`, `template validate`, `template set`, `role list`, `role show`, and `turn show`
3. `verify` is documented in the command map as concrete subcommand rows (`verify turn`, `verify protocol`, `verify export`), not as the ambiguous parent `verify`.
4. Legacy compatibility commands must not appear as command-map rows.
5. The guard must derive the current CLI command registration from `cli/bin/agentxchain.js`, not from a second hand-maintained list hidden in docs tests.

## Acceptance Tests

- AT-CMAP-001: `cli/test/docs-cli-command-map-content.test.js` extracts top-level command registrations from `cli/bin/agentxchain.js`
- AT-CMAP-002: Every governed-scope command family has a corresponding command-map row in `website-v2/docs/cli.mdx`
- AT-CMAP-003: `verify` is documented via concrete subcommand rows (`verify turn`, `verify protocol`, `verify export`)
- AT-CMAP-004: Legacy compatibility commands are absent from the command map
- AT-CMAP-005: `website-v2/docs/cli.mdx` includes an explicit legacy compatibility note
