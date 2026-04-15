# Decision Authority Spec

## Purpose

Define an explicit, config-declared authority model for decision overrides. Today any role can override any repo-durable decision as long as it is active. This is insufficient for governed long-horizon runs where decisions carry different weights depending on who made them.

The authority model answers one question: **is this role permitted to override a decision made by that role?**

## Interface

### Config Extension

Add optional `decision_authority` field (integer, 0–99) to each role definition:

```json
{
  "roles": {
    "pm": {
      "title": "Product Manager",
      "mandate": "...",
      "write_authority": "review_only",
      "decision_authority": 30
    },
    "dev": {
      "title": "Developer",
      "mandate": "...",
      "write_authority": "authoritative",
      "decision_authority": 20
    },
    "qa": {
      "title": "QA",
      "mandate": "...",
      "write_authority": "review_only",
      "decision_authority": 20
    },
    "eng_director": {
      "title": "Engineering Director",
      "mandate": "...",
      "write_authority": "review_only",
      "decision_authority": 50
    }
  }
}
```

**Semantics:**

- `decision_authority`: integer 0–99. Higher = more override authority.
- Omitted = `null` (opt-out). When both sides are `null`, override is unrestricted (backward-compatible).
- `human` role implicitly has `decision_authority: 100` unless explicitly configured otherwise.

### Comparison Rules

**Rule 1 — Opt-in enforcement.** Authority checks only activate when the target decision's role AND the overriding role both have `decision_authority` set (non-null). If either side is null, the override is allowed (backward-compatible).

**Rule 2 — Same-role override.** Always permitted. A role can always override its own prior decisions regardless of authority level.

**Rule 3 — Cross-role override.** The overriding role's `decision_authority` must be >= the target decision's originating role's `decision_authority`. If lower, the override is rejected.

**Rule 4 — Human-origin decisions.** Decisions with `role: "human"` are treated as `decision_authority: 100` unless the config explicitly sets a different level for a `human` role entry. This means non-human roles cannot override human decisions unless their own authority is >= 100 (or the human role is explicitly given a lower level).

**Rule 5 — Unknown roles.** If the target decision's role no longer exists in the current config, the decision is treated as authority `0` (overridable by anyone) with a warning logged. Stale role mappings should not block governance progress.

### Runtime Behavior

On `validateOverride()`:

1. Look up target decision's `role` field.
2. Resolve target authority: `config.roles[targetRole]?.decision_authority ?? null`. For `role === 'human'`, default to `100`.
3. Resolve overriding authority: `config.roles[overridingRole]?.decision_authority ?? null`.
4. If either is `null`, allow (opt-in enforcement).
5. If `overridingRole === targetRole`, allow (same-role always ok).
6. If `overridingAuthority < targetAuthority`, reject with error: `"decisions: role '${overridingRole}' (authority ${overridingAuthority}) cannot override DEC-${targetId} made by '${targetRole}' (authority ${targetAuthority}). Override requires authority >= ${targetAuthority}."`
7. Otherwise, allow.

### CLI Surface

`agentxchain decisions --show DEC-042` now includes:

```
Authority:    30 (pm)
```

`agentxchain role list` already shows `write_authority`; it now also shows `decision_authority` when configured.
`agentxchain role show <role>` must print `Decision: <N>` when configured.

### Dispatch / Report Surface

- `CONTEXT.md` active repo decisions include the originating role and authority metadata when available so agents can see override constraints before attempting a supersession.
- Export/report repo-decision summaries include `authority_level` and `authority_source` (`configured`, `human_default`, or `unknown_role`) so proof artifacts preserve the same authority context operators saw at runtime.

### Config Validation

- `decision_authority` must be integer, 0–99, or omitted.
- Non-integer, negative, or >99 values fail config validation.
- The field is optional — zero configs break.

## Behavior

1. `validateOverride()` gains an optional `config` parameter. When provided, authority checks are applied.
2. The governed-state `acceptTurnResult` path passes config to `validateOverride`.
3. If config has no `decision_authority` on any role, the system behaves identically to today.
4. Authority enforcement is purely additive — no existing behavior changes.

## Error Cases

- Override attempt where overriding authority < target authority → validation error (descriptive message with both levels and roles)
- `decision_authority` value not integer or out of range → config validation error
- Target decision's role not in current config → warning logged, treated as authority 0
- `decision_authority` set on some roles but not others → only enforced where both sides are set

## Acceptance Tests

1. Override allowed when no `decision_authority` configured on either role (backward-compat)
2. Override allowed when overriding role authority >= target role authority
3. Override rejected when overriding role authority < target role authority (with descriptive error)
4. Same-role override always allowed regardless of authority level
5. Human-origin decision defaults to authority 100
6. Human-origin decision with explicit lower authority is overridable
7. Unknown target role treated as authority 0 with warning
8. Config validation rejects non-integer `decision_authority`
9. Config validation rejects `decision_authority` outside 0–99
10. `agentxchain decisions --show` displays authority level
11. `agentxchain role list` displays `decision_authority` when configured
12. `agentxchain role show` displays `Decision: N` when configured
13. `CONTEXT.md` repo decisions annotate role + authority when configured
14. Export/report repo-decision summaries persist authority metadata and `verify export` rejects drift

## Open Questions

None. This is a minimal, opt-in, backward-compatible authority layer. Future iterations may add policy rules (e.g., "qa cannot override architecture decisions regardless of authority level") but that is scope creep for this slice.
