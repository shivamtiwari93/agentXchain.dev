# CLI Documentation Page Spec

> Public reference page for the governed command surface.

---

## Purpose

Expose a browsable command reference at `/docs/cli` so operators can understand the governed command surface without opening raw markdown in GitHub. The page must explain what each command does, when to use it, and what recovery path follows from common governed states.

## Interface

### Route

```text
/docs/cli
```

### Files

```text
website-v2/docs/cli.mdx
website-v2/sidebars.ts
```

### Audience

- Engineers evaluating whether the CLI matches the governance claims
- Operators who need a truthful reference after reading quickstart
- Contributors comparing docs copy against `.planning/CLI_SPEC.md`

## Behavior

### 1. Governed reference with explicit legacy boundary

The page must document the governed command surface and the governed-adjacent command families that extend it:

- `init --governed`
- `template list`
- `template set`
- `status`
- `resume`
- `step`
- `accept-turn`
- `reject-turn`
- `approve-transition`
- `approve-completion`
- `validate`
- `verify protocol`
- `migrate`
- `plugin`
- `intake`
- `multi`
- `dashboard`

Legacy v3 commands may remain in the binary, but they must be framed as out-of-scope compatibility paths rather than first-class governed workflow.

### 2. Command semantics before examples

The page must explain the two most confusing distinctions early:

- `resume` assigns or redispatches work without waiting
- `step` runs one full governed turn lifecycle

It must also explain that:

- `accept-turn` and `reject-turn` operate on staged turn results
- `approve-transition` and `approve-completion` are explicit human gates

### 3. Recovery-oriented reference

The page must include guidance for:

- approval-paused runs
- blocked runs with retained turns
- multiple active turns requiring `--turn`
- conflicted turns requiring `reject-turn --reassign` or `accept-turn --resolution human_merge`

### 4. Real artifact paths

The page must reference the actual governed artifact paths:

- `.agentxchain/dispatch/turns/<turn_id>/`
- `.agentxchain/staging/<turn_id>/turn-result.json`
- `.agentxchain/history.jsonl`
- `.agentxchain/decision-ledger.jsonl`

### 5. Cross-linking

The page must link to:

- `/docs/quickstart`
- `/docs/adapters`
- `/docs/protocol`

## Error Cases

| Condition | Required docs behavior |
|---|---|
| User expects `step` to loop forever | State clearly that one invocation handles one governed turn lifecycle only. |
| User confuses `resume` and `step` | Contrast assignment-only vs full-turn execution near the top of the page. |
| User is in a paused approval state | Point them to `approve-transition` or `approve-completion`, not `step`. |
| User has multiple active turns | Document the requirement to use `--turn <id>` for targeted operations. |

## Acceptance Tests

1. `/docs/cli` exists as a Docusaurus docs route sourced from `website-v2/docs/cli.mdx`.
2. The page documents every implemented governed command listed in `.planning/CLI_SPEC.md`.
3. The page explains the `resume` vs `step` distinction.
4. The page includes real dispatch and staging paths.
5. The page links from other docs pages through local `/docs/cli` links.
6. The page does not describe legacy lock-based workflow as the primary command path and explicitly marks it as compatibility scope.
7. The page documents `agentxchain verify protocol` with tier, surface, target, and JSON-report semantics.
8. The command map includes every governed and governed-adjacent command family registered in `cli/bin/agentxchain.js`.

## Open Questions

1. Should a future `/docs/protocol` page absorb the command signatures table, leaving `/docs/cli` more operator-focused?
2. Should we add JSON-mode examples for `status --json` and `validate --json`, or keep the page human-first?
