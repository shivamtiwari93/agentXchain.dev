# Templates Docs Page Spec

> Public docs contract for governed scaffold templates.

---

## Purpose

Expose a first-class `/docs/templates` page so operators can understand the governed template system without piecing it together from README fragments and command help.

The repo already ships:

- `init --governed --template <id>`
- `template list`
- `template set <id>`
- `status` / `status --json` template visibility

That command surface is real product behavior, not side-detail copy. The docs need a single truthful page for it.

## Interface

### Route

```text
/docs/templates
```

### Files

```text
website-v2/docs/templates.mdx
website-v2/sidebars.ts
```

### Audience

- Operators choosing a governed scaffold for a new repo
- Teams retrofitting an existing governed repo with `template set`
- Evaluators checking whether AgentXchain's SDLC templates are real or marketing

## Behavior

### 1. Explain the contract clearly

The page must state early that template choice is:

- scaffold intent
- recorded in `agentxchain.json`
- additive guidance and planning structure
- not hidden runtime magic
- not a different protocol mode

### 2. Cover all shipped commands

The page must document:

- `agentxchain init --governed --template <id>`
- `agentxchain template list`
- `agentxchain template set <id>`
- `agentxchain status`
- `agentxchain status --json`

### 3. Show the built-in templates honestly

The page must list all built-in template IDs and the planning artifacts they add:

- `generic`
- `api-service`
- `cli-tool`
- `web-app`

### 4. Document mutation safety

The page must explain the actual `template set` semantics:

- updates the config `template` field
- creates missing planning artifacts
- never overwrites existing planning docs
- appends prompt guidance once
- appends acceptance hints once
- switching templates is additive, not destructive

### 5. Cross-link the operator flow

The page must link back to:

- `/docs/quickstart`
- `/docs/cli`

Quickstart and CLI docs should also link into `/docs/templates` so the surface is discoverable from the main docs flow.

## Error Cases

| Condition | Required docs behavior |
|---|---|
| Page implies templates change protocol semantics | Wrong. Templates are scaffold guidance, not a protocol fork. |
| Page claims `template set` rewrites or merges existing planning docs | Wrong. The command is intentionally additive and conservative. |
| Page omits `template list` | Incomplete. Operators need a discovery path, not just mutation commands. |
| Page lists template IDs without their artifact differences | Low-value. The operator still cannot choose honestly. |

## Acceptance Tests

1. `website-v2/docs/templates.mdx` exists and is wired into `website-v2/sidebars.ts`.
2. The built public page exists at `website/docs/templates.html`.
3. The page documents `init --governed --template <id>`, `template list`, and `template set <id>`.
4. The page lists `generic`, `api-service`, `cli-tool`, and `web-app`.
5. The page explains that `template set` is additive and non-destructive.
6. `website-v2/docs/quickstart.mdx` links to `/docs/templates`.
7. `website-v2/docs/cli.mdx` links to `/docs/templates`.

## Open Questions

1. Should the docs later grow a `/templates/<id>` deep-dive surface for each built-in template, or is one comparison table enough until user demand proves otherwise?
