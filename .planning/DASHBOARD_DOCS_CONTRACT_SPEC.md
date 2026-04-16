# Dashboard Docs Contract Spec

> Status: **shipped**
> Scope: truthful CLI docs coverage for the shipped local dashboard surface

---

## Purpose

The dashboard is a public product surface, not an internal convenience. The CLI docs must describe the dashboard that actually ships: the real command flags, the real local/live bridge behavior, the real replay boundary, and the real SPA views. Docs that advertise nonexistent views or flags are product drift, not harmless copy debt.

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

### 2. Live-vs-replay and local-only behavior must be explicit

The docs must state that:

- `agentxchain dashboard` reads the current local repo/workspace state
- `agentxchain replay export` is the artifact-backed read-only dashboard
- the bridge binds locally (`127.0.0.1`)
- the dashboard may perform authenticated local `approve-gate` only
- the mutation token comes from same-origin `GET /api/session` and must be sent in `X-AgentXchain-Token`
- broader recovery and arbitrary write actions remain CLI-only
- partial coordinator artifacts do not fabricate missing nested child exports

### 3. View list must match the shipped SPA

The docs must cover the shipped top-level dashboard views:

- Initiative
- Cross-Repo
- Timeline
- Delegations
- Decisions
- Hooks
- Blocked
- Gates
- Blockers
- Artifacts
- Run History
- Timeouts
- Coordinator Timeouts

The docs may describe turn detail as part of the Timeline view, but not as a separate top-level view.

### 4. Operator commands must be truthful

The docs must mention the exact commands surfaced by the dashboard and its CLI fallback:

- `agentxchain approve-transition`
- `agentxchain approve-completion`
- `agentxchain multi approve-gate`

The docs must also describe the dashboard approve button plus the local token boundary for `POST /api/actions/approve-gate`.

The docs may mention recovery commands generically, but must not imply dashboard-triggered recovery or arbitrary command execution.

### 5. Drift protection must compare docs against code

The content test must fail if:

- docs flags diverge from the CLI command definition
- docs list removed dashboard views
- docs omit a shipped top-level view present in the dashboard navigation
- docs weaken the live-vs-replay or local-only contract

---

## Error Cases

| Condition | Required behavior |
|---|---|
| Docs mention `--host` | Fail the guard. That flag does not exist. |
| Docs use an outdated default port | Fail the guard. Operators need the real default. |
| Docs describe deprecated views like objection tracker, phase graph, or file diff | Fail the guard. Those are not shipped dashboard views. |
| Docs describe the dashboard as entirely read-only or claim all approvals stay CLI-only | Fail the guard. The shipped dashboard has one authenticated `approve-gate` mutation surface. |
| Dashboard navigation changes without docs updates | Fail the guard until `/docs/cli` is realigned. |

---

## Acceptance Tests

1. `/docs/cli` documents `agentxchain dashboard` with `--port` default `3847` and `--no-open`.
2. `/docs/cli` does not document `--host`.
3. `/docs/cli` states the live-vs-replay dashboard boundary and keeps `dashboard`, `audit`, `report --input`, and `replay export` distinct.
4. `/docs/cli` states the local-only bridge contract, including same-origin `GET /api/session` and `X-AgentXchain-Token`.
5. `/docs/cli` covers every shipped dashboard nav view from `cli/dashboard/index.html`.
6. `/docs/cli` mentions the exact approval commands surfaced by the dashboard, plus the dashboard approve button and authenticated `approve-gate` scope.
7. `/docs/cli` states the partial coordinator artifact boundary for report vs replay without fabricating failed-child nested exports.
8. `cli/test/docs-dashboard-content.test.js` reads the dashboard command/docs/runtime files and passes.
