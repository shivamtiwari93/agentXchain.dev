# CLI Docs Governance Command Contract Spec

**Status:** Shipped — Turn 5
**Author:** Claude Opus 4.6 — Turn 5
**Scope:** Fix all governance/turn-lifecycle/approval command documentation in `website-v2/docs/cli.mdx` to match the shipped CLI surface in `cli/bin/agentxchain.js`.

## Problem

The CLI docs page documents flags that do not exist, uses wrong flag names, and omits flags that are shipped. This is not cosmetic drift — operators following the docs will get `unknown option` errors on governance commands.

## Discrepancies Found

### 1. `resume` — 2 ghost flags, 1 missing flag
- **Docs:** `--adapter <name>`, `--turn-id <id>`
- **Actual:** `--role <role>`, `--turn <id>`
- `--adapter` does not exist. `--turn-id` should be `--turn`. `--role` is undocumented.

### 2. `step` — 3 ghost flags, 4 missing flags
- **Docs:** `--role` (correct), `--adapter <name>` (ghost), `--timeout <ms>` (ghost), `--dry-run` (ghost)
- **Actual:** `--role`, `--resume`, `--turn <id>`, `--poll <seconds>`, `--verbose`, `--auto-reject`
- `--adapter`, `--timeout`, `--dry-run` do not exist. `--resume`, `--turn`, `--poll`, `--verbose`, `--auto-reject` are undocumented.

### 3. `accept-turn` — 1 wrong name, 1 ghost flag, 1 missing flag
- **Docs:** `--turn-id <id>`, `--comment <text>`
- **Actual:** `--turn <id>`, `--resolution <mode>`
- `--comment` does not exist. `--turn-id` should be `--turn`. `--resolution` is undocumented.

### 4. `reject-turn` — 1 wrong name, 1 missing flag
- **Docs:** `--reason <text>` (marked required), `--turn-id <id>`
- **Actual:** `--turn <id>`, `--reason <reason>` (optional), `--reassign`
- `--turn-id` should be `--turn`. `--reassign` is undocumented. `--reason` is not required.

### 5. `approve-transition` — 2 ghost flags
- **Docs:** `--comment <text>`, `--json`
- **Actual:** NO flags
- Both documented flags are fabricated.

### 6. `approve-completion` — 2 ghost flags
- **Docs:** `--comment <text>`, `--json`
- **Actual:** NO flags
- Both documented flags are fabricated.

### 7. `migrate` — 2 ghost flags
- **Docs:** `--yes`, `--json`, `--dry-run`, `--backup`
- **Actual:** `--yes`, `--json`
- `--dry-run` and `--backup`/`--no-backup` do not exist.

### 8. `validate` — 1 ghost flag, 1 missing flag
- **Docs:** `--mode`, `--json`, `--fix`
- **Actual:** `--mode`, `--agent <id>`, `--json`
- `--fix` does not exist. `--agent` is undocumented.

### 9. Common sequences — ghost flag usage
- `agentxchain status --verbose` — `status` has no `--verbose` flag.

## Acceptance Tests

- AT-CLI-GOV-001: Every flag in the docs for `resume`, `step`, `accept-turn`, `reject-turn`, `approve-transition`, `approve-completion`, `migrate`, and `validate` must exist in `cli/bin/agentxchain.js`.
- AT-CLI-GOV-002: Every flag in `cli/bin/agentxchain.js` for those commands must appear in the docs.
- AT-CLI-GOV-003: Flag names must match exactly (no `--turn-id` for `--turn`).
- AT-CLI-GOV-004: No flag table may claim `(required)` for an optional flag.
- AT-CLI-GOV-005: Common sequences must not use flags that don't exist.
- AT-CLI-GOV-006: A guard test must enforce AT-001 through AT-005 by reading both the docs file and `agentxchain.js`.

## Implementation

1. Rewrite all governance command sections in `cli.mdx`
2. Fix common sequences
3. Add guard test `cli/test/docs-cli-governance-content.test.js`
4. Verify Docusaurus build
