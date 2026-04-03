# Dashboard Docs Contract Spec

> Status: **shipped**
> Scope: truthful CLI docs coverage for the shipped read-only dashboard surface

---

## Purpose

The dashboard is a public product surface, not an internal convenience. The CLI docs must describe the dashboard that actually ships: the real command flags, the real read-only bridge behavior, and the real SPA views. Docs that advertise nonexistent views or flags are product drift, not harmless copy debt.

This spec narrows the work to the dashboard section on `/docs/cli` plus a repo-native content test that guards the contract against the shipped dashboard code.

---

## Interface

### Docs source

```text
website-v2/docs/cli.mdx
```

### Guard

```text
cli/test/docs-dashboard-content.test.js
```

### Runtime surfaces the docs must match

```text
cli/bin/agentxchain.js
cli/src/commands/dashboard.js
cli/src/lib/dashboard/bridge-server.js
cli/dashboard/app.js
cli/dashboard/index.html
```

---

## Behavior

### 1. Command contract must match the real CLI

The docs must describe exactly the shipped command surface:

- `agentxchain dashboard [options]`
- `--port <port>` with default `3847`
- `--no-open`

The docs must not advertise unsupported flags such as `--host`.

### 2. Read-only and local-only behavior must be explicit

The docs must state that:

- the dashboard is read-only
- the bridge binds locally (`127.0.0.1`)
- approvals and recovery remain CLI actions, not dashboard mutations

### 3. View list must match the shipped SPA

The docs must cover the seven shipped dashboard views:

- Initiative
- Cross-Repo
- Timeline
- Decisions
- Hooks
- Blocked
- Gates

The docs may describe turn detail as part of the Timeline view, but not as a separate top-level view.

### 4. Operator commands must be truthful

The docs must mention the exact commands surfaced by the dashboard:

- `agentxchain approve-transition`
- `agentxchain approve-completion`
- `agentxchain multi approve-gate`

The docs may mention recovery commands generically, but must not imply dashboard-triggered mutation.

### 5. Drift protection must compare docs against code

The content test must fail if:

- docs flags diverge from the CLI command definition
- docs list removed dashboard views
- docs omit a shipped top-level view present in the dashboard navigation
- docs weaken the read-only or local-only contract

---

## Error Cases

| Condition | Required behavior |
|---|---|
| Docs mention `--host` | Fail the guard. That flag does not exist. |
| Docs use an outdated default port | Fail the guard. Operators need the real default. |
| Docs describe deprecated views like objection tracker, phase graph, or file diff | Fail the guard. Those are not shipped dashboard views. |
| Dashboard navigation changes without docs updates | Fail the guard until `/docs/cli` is realigned. |

---

## Acceptance Tests

1. `/docs/cli` documents `agentxchain dashboard` with `--port` default `3847` and `--no-open`.
2. `/docs/cli` does not document `--host`.
3. `/docs/cli` states the local-only, read-only bridge contract.
4. `/docs/cli` covers every shipped dashboard nav view from `cli/dashboard/index.html`.
5. `/docs/cli` mentions the exact approval commands surfaced by the dashboard.
6. `cli/test/docs-dashboard-content.test.js` reads the dashboard command/docs/runtime files and passes.
