# V2 Web Dashboard Spec

> Non-CLI governance visibility for AgentXchain orchestrated runs

---

## Purpose

The CLI is sufficient for operators who run governed workflows. It is not sufficient for stakeholders who need to observe, audit, and understand governed runs without touching a terminal: engineering managers, product leads, compliance officers, and on-call engineers reviewing escalations.

The dashboard is the first v2 artifact that moves AgentXchain from a developer tool to organizational infrastructure (VISION.md: "v2 — Governance as infrastructure").

---

## Design Principles

1. **Read-first, read-only in v2.0.** The dashboard is an observation surface. It reads `.agentxchain/` state files and ledgers. It does not become a second control plane in v2.0.
2. **No external service required for local use.** A lightweight local bridge server started by `agentxchain dashboard` is the v2.0 baseline. The hosted cloud dashboard (agentxchain.ai) is the commercial extension, not a prerequisite.
3. **Protocol-native.** The dashboard renders protocol artifacts directly. It may hold ephemeral browser state for filtering and expansion, but `.agentxchain/` remains the only authority.
4. **Single mutation surface.** The CLI remains the only write path in v2.0. The dashboard may show exact next actions and copyable commands, but it does not execute approvals, acceptances, or resumes itself.

---

## Architecture

```
┌─────────────────────────────────────────────┐
│                  Browser                     │
│  ┌─────────────────────────────────────────┐ │
│  │         Dashboard SPA (static)          │ │
│  │  - Run timeline                         │ │
│  │  - Turn detail view                     │ │
│  │  - Decision ledger explorer             │ │
│  │  - Hook audit log                       │ │
│  │  - Blocked state + escalation panel     │ │
│  │  - Gate review panel                    │ │
│  └──────────────┬──────────────────────────┘ │
│                 │ HTTP/WebSocket              │
└─────────────────┼───────────────────────────┘
                  │
┌─────────────────┼───────────────────────────┐
│     Local Bridge Server (Node.js)            │
│  ┌──────────────┴──────────────────────────┐ │
│  │  - Watches .agentxchain/ for changes    │ │
│  │  - Serves state.json and ledgers        │ │
│  │  - Publishes snapshot invalidations     │ │
│  │  - Serves static dashboard assets       │ │
│  └─────────────────────────────────────────┘ │
│                                              │
│  .agentxchain/                               │
│  ├── state.json                              │
│  ├── history.jsonl                           │
│  ├── decision-ledger.jsonl                   │
│  ├── hook-audit.jsonl                        │
│  ├── hook-annotations.jsonl                  │
│  └── dispatch/                               │
└──────────────────────────────────────────────┘
```

### Why a local bridge server instead of file access

Browsers restrict reliable local file access, and `file://` produces inconsistent behavior across browsers and operating systems. A thin Node.js server started by `agentxchain dashboard` gives one predictable local transport, enables live invalidation events, and keeps the architecture aligned with the eventual cloud data source. The bridge is read-only in v2.0.

### Cloud extension (agentxchain.ai, post-v2.0)

The cloud dashboard replaces the local bridge with a persistent API that ingests state from multiple repos/orgs. The SPA is the same codebase with a different data source. This separation is intentional: the protocol-native rendering logic is open source; the multi-tenant persistence layer is commercial.

---

## Views

### V1: Run Timeline

The primary view. Shows the current governed run as a vertical timeline.

```
Run: governed-todo-app (phase: development, turn 6)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  ● Turn 1 — pm — planning → development     ✓ accepted
    "Defined scope: auth middleware + JWT"
    Objections: 1  Decisions: 2  Files: 3

  ● Turn 2 — dev — development                ✓ accepted
    "Implemented JWT middleware with RS256"
    Objections: 1  Decisions: 1  Files: 5
    Verification: npm test — 504 passing

  ◐ Turn 3 — qa — development                 ⚠ blocked
    "Token refresh not covered in acceptance matrix"
    Block reason: validation_failed (schema mismatch)
    ↳ Escalation: missing required field 'verification'

  ○ Turn 4 — dev — (pending)
```

Each turn card displays inline:
- Summary
- Files changed (as copyable paths; diff links deferred to v2.1+ pending git integration)
- Decisions and objections (rendered from structured fields)
- Risks
- Verification evidence summary

Deferred to v2.1+:
- Expandable full turn result JSON
- Per-turn hook audit entries and annotations
- Inline diff rendering

### V2: Decision Ledger Explorer

Renders `decision-ledger.jsonl` as a filterable table.

| Turn | Agent | Decision |
|------|-------|----------|
| 2 | dev | Chose RS256 over HS256 |

v2.0 renders Turn, Agent, and Decision columns. Objection and Timestamp columns are deferred to v2.1+ when the decision-ledger.jsonl schema stabilizes with those fields.

v2.0 filters: by agent role (dropdown), by text query (substring match on agent or decision). Phase filter, objection presence filter, and date range filter are deferred to v2.1+ (see DEC-DASH-IMPL-011).

### V3: Hook Audit Log

Renders `hook-audit.jsonl` as a filterable event stream.

| Time | Phase | Hook | Verdict | Action | Duration |
|------|-------|------|---------|--------|----------|
| 10:15:01 | before_acceptance | compliance-gate | allow | continued | 342ms |
| 10:15:02 | after_acceptance | sast-scanner | warn | continued | 1204ms |

v2.0 filters: none (full audit log table rendered). Phase, verdict, and hook-name filters are deferred to v2.1+.

The dashboard MUST render the persisted hook ledger field names as written by the orchestrator:

- `hook_phase`
- `hook_name`
- `orchestrator_action`
- `annotations`

It may support legacy aliases (`phase`, `hook`, `action`) only as a compatibility fallback for older fixtures or tests.

### V4: Blocked State Panel

When the run is in `blocked` state, the dashboard shows:
- Block reason and detail
- Recovery descriptor (what must happen to unblock)
- Retained-turn status, if any
- Related recent hook/validation context when it exists in the current ledgers
- The exact CLI recovery command to run next (`agentxchain step --resume`, `agentxchain step`, etc.) with copy-to-clipboard affordance

The dashboard does **not** claim to show a complete history of prior blocked states in v2.0 because no dedicated blocked-event ledger exists yet. It renders the current blocked state plus nearby audit context only.

The source of truth is the governed runtime state:

- `state.blocked_on`
- `state.blocked_reason.category`
- `state.blocked_reason.recovery`

The dashboard MAY read a legacy `blocked_state` shape for backward-compatible fixtures, but the runtime contract is `blocked_reason`, not a dashboard-only schema.

### V5: Gate Review Panel

When the run is awaiting a human gate (phase transition or run completion), the dashboard shows:
- Aggregated evidence from all turns since the last phase gate (not just the requesting turn)
- Per-agent summaries with role and turn_id attribution
- Aggregated objections, risks, decisions, and files changed across all evidence turns
- The exact CLI command required next:
  - `agentxchain approve-transition`
  - `agentxchain approve-completion`
- Copy-to-clipboard affordance for the command (`data-copy` attribute with `navigator.clipboard` API, fallback to text selection)

The dashboard does not approve gates itself in v2.0.

In the local v2.0 baseline, evidence aggregation walks `history.jsonl` backwards from `pending_phase_transition.requested_by_turn` or `pending_run_completion.requested_by_turn` to the most recent accepted turn whose `phase_transition_request` is non-null (or run start). That accepted requesting turn is the phase-boundary marker because it is the field the orchestrator actually persists in `history.jsonl`; the dashboard must not invent a separate `phase_transition: true` marker. All turns after that boundary, through the requesting turn, are included. The dashboard does not invent an extra gate-summary file.

---

## Data Contract

The dashboard reads these files and no others in the v2.0 baseline:

| File | Format | Update Pattern |
|------|--------|----------------|
| `state.json` | JSON | Overwritten on each state mutation |
| `history.jsonl` | JSONL | Append-only |
| `decision-ledger.jsonl` | JSONL | Append-only |
| `hook-audit.jsonl` | JSONL | Append-only |
| `hook-annotations.jsonl` | JSONL | Append-only |

The dashboard never writes to these files.

### Explicit exclusions from the v2.0 baseline

- `.agentxchain/dispatch/` is **not** part of the baseline data contract
- Prompt / assignment bundle inspection is deferred because it changes the security surface and is not required for stakeholder visibility
- Git diff rendering is deferred; v2.0 shows file paths and accepted artifact refs only

### Live update contract

The local bridge server watches `.agentxchain/` for changes. On any watched-file change, it emits a WebSocket invalidation event naming the changed resource. The SPA then refetches the latest snapshot for that resource over HTTP.

This is intentionally simpler than a delta protocol:

- no custom patch format
- no client/server version reconciliation problem in v2.0
- easier reconnect behavior after sleep, restart, or missed watch events

The gate review view reads both `state.json` and `history.jsonl`. The bridge invalidates those resources independently; the SPA refetches the resources required by the active view.

---

## CLI Integration

New command: `agentxchain dashboard`

```
agentxchain dashboard [--port 3847] [--no-open]
```

- Starts the local bridge server
- Opens the default browser to `http://localhost:3847`
- Watches `.agentxchain/` for live updates
- Serves a read-only dashboard for the current repo
- Exits when the terminal is interrupted (Ctrl+C)

---

## Security Considerations

1. **Local-only by default.** The bridge server binds to `127.0.0.1`, not `0.0.0.0`. No network exposure.
2. **No authentication for local use.** If you can access the terminal, you can access the dashboard. This matches the CLI's threat model.
3. **No write RPC in v2.0.** The bridge does not execute CLI commands or arbitrary shell commands. Mutation requests are rejected by design.
4. **Read-only state access.** The bridge serves only the dashboard assets plus the defined JSON/JSONL resources. It does not expose arbitrary filesystem reads.
5. **HTML interpolation must escape both quote characters.** Dashboard renderers build HTML strings directly, so text derived from governed artifacts must escape `&`, `<`, `>`, `"`, and `'`. Relying on a double-quoted-attribute convention alone is not a sufficient security contract.

---

## Non-Goals for v2.0

- **Multi-repo view.** Superseded by `.planning/V2_DASHBOARD_MULTI_REPO_SPEC.md`. Local v2.0 dashboard includes read-only coordinator state integration; cloud remains the multi-tenant extension.
- **User authentication.** Local dashboard has no auth. Cloud dashboard handles auth.
- **Real-time agent output streaming.** The dashboard shows completed turns, not in-progress agent output. Streaming adapter stdout is a v2.1 consideration.
- **Dashboard-triggered approvals or resume actions.** All mutations remain CLI-only in v2.0.
- **Dispatch bundle / prompt inspection.** Deferred until the redaction and permission model is specified.
- **Editor-protocol deep links.** v2.0 shows copyable file paths, not editor-specific `code://` handlers.
- **Mobile layout.** Desktop-first. Mobile is deferred.
- **Custom themes / branding.** Ship one theme that matches the website aesthetic.

---

## Acceptance Tests

### AT-DASH-001: Run timeline renders from state files
Given a `.agentxchain/` directory with `state.json` (3 turns, phase: development) and `history.jsonl` (2 accepted entries), when the dashboard loads, then the timeline shows 3 turns with correct status indicators (2 accepted, 1 pending).

### AT-DASH-002: Live update on turn acceptance
Given the dashboard is open and watching, when `agentxchain accept-turn` completes (appending to `history.jsonl`), then the dashboard updates within 1 second without manual refresh.

### AT-DASH-003: Gate review panel surfaces the exact CLI action
Given the run requires `human_required` phase transition approval and `history.jsonl` contains turns from both the prior phase and the current phase, when the dashboard loads, then it aggregates only the turns after the most recent accepted `phase_transition_request`, shows the supporting objections/risks summary for that bounded set, and renders the exact `agentxchain approve-transition` command the operator must run.

### AT-DASH-004: Blocked state visibility
Given the run is in `blocked` state with reason `validation_failed`, when the dashboard loads, then the blocked panel shows the reason, detail, recovery descriptor, and recent hook/validation context when that context exists in the current ledgers.

### AT-DASH-005: Hook audit log renders
Given `hook-audit.jsonl` contains 5 entries across 3 phases, when the hook audit view loads, then all 5 entries render with correct phase, verdict, and duration.

### AT-DASH-006: Decision ledger filters
Given `decision-ledger.jsonl` contains entries from 3 agents, when the user filters by agent "qa", then only QA entries are shown.

### AT-DASH-007: Bridge server is local-only
Given the bridge server is started with `agentxchain dashboard`, when a connection attempt is made from a non-localhost address, then the connection is refused.

### AT-DASH-008: Read-only bridge rejects mutation requests
Given the bridge server is running, when a client requests a mutation action over HTTP or WebSocket, then the bridge rejects the request explicitly because v2.0 exposes no write RPC surface.

### Security Verification: Dashboard renderers escape both quote characters
Given governed artifact text containing `'` and `"`, when the dashboard renders that text into HTML content or attributes, then both quote characters are entity-escaped and do not rely on a component-specific attribute-quoting convention for safety.

---

## Open Questions

### OQ-DASH-001: Technology choice for the SPA
Options: (a) vanilla ES modules, (b) Preact, (c) Svelte. The website is static HTML with no framework (DEC-DOCS-001). Proposal: stay with vanilla ES modules in v2.0 so the dashboard can ship without introducing a frontend build chain before the workflows stabilize. Revisit a framework only if view complexity becomes a real maintenance problem.

### OQ-DASH-002: Should the dashboard show dispatch bundle contents?
The dispatch bundle (ASSIGNMENT.json, PROMPT.md, CONTEXT.md) contains the full prompt sent to agents. Showing this is valuable for debugging but expands the security surface immediately. Proposal: no dispatch bundle rendering in v2.0. Add it only after a separate prompt-redaction and access-control spec exists.

### OQ-DASH-003: Diff rendering
Should the dashboard render git diffs for files changed in each turn? This would require git access from the bridge server. Proposal: defer inline diff rendering to v2.1. For v2.0, show copyable file paths and accepted integration refs only. Do not depend on editor-specific protocol handlers.

### OQ-DASH-004: Notification support
Should the dashboard support desktop notifications for blocked states and gate approvals? This would be valuable for operators who keep the dashboard open in a background tab. Proposal: yes, using the Web Notifications API, opt-in.
