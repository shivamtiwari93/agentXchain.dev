# System Spec — M6: Dashboard Live Observer

**Run:** `run_74fc370a40da7622`
**Baseline:** git:0dab72102a4eabdc3ff7cf1427aead1964c506d3
**Package version:** `agentxchain@2.155.72`

## Purpose

Verify and document the complete implementation of the real-time governance dashboard. This is a verification-only spec — all code is already shipped.

---

## 1. Architecture Overview

The dashboard is a localhost-only HTTP + WebSocket server that serves static UI assets and exposes API endpoints backed by `.agentxchain/` state files. Real-time updates are achieved via filesystem watching + WebSocket push.

```
┌──────────────────────────────────────────────────────────┐
│                   Browser (dashboard UI)                   │
│  app.js → views (timeline, gate, ledger, ...)            │
└────────────────────┬─────────────────────────────────────┘
                     │ HTTP GET /api/* + WebSocket
                     │
┌────────────────────▼─────────────────────────────────────┐
│              Bridge Server (bridge-server.js)              │
│  - HTTP: serves static assets + JSON API                  │
│  - WebSocket: RFC 6455, text frames, invalidation push    │
│  - Auth: token-based for mutations, localhost-only bind   │
└────────┬──────────────────────────────┬──────────────────┘
         │                              │
┌────────▼────────┐          ┌─────────▼──────────────────┐
│  State Reader    │          │  File Watcher              │
│  (state-reader)  │          │  (file-watcher.js)         │
│  Reads state.json│          │  Watches .agentxchain/     │
│  history.jsonl   │          │  100ms debounce            │
│  events.jsonl    │          │  Emits invalidation events │
│  etc.            │          └────────────────────────────┘
└─────────────────┘
```

---

## 2. Implementation Inventory

### CLI Command Registration

| Component | File:Line | Evidence |
|-----------|-----------|----------|
| Command registration | `agentxchain.js:808-813` | `.command('dashboard')` with `--port`, `--daemon`, `--no-open` options |
| Command handler | `dashboard.js:20` | `dashboardCommand()` — validates `.agentxchain/`, creates bridge server, opens browser |
| Daemon mode | `dashboard.js:36-38` | Spawns detached child process, writes PID file |
| Session file | `dashboard.js:49-54` | Writes `.agentxchain-dashboard.json` with pid, port, url, started_at |
| Stop integration | `agentxchain.js:215-216` | `stop` command kills dashboard daemon via PID file |

### Bridge Server (HTTP + WebSocket)

| Component | File:Line | Evidence |
|-----------|-----------|----------|
| Server factory | `bridge-server.js:261` | `createBridgeServer({ agentxchainDir, dashboardDir, port })` — returns `{ start(), stop() }` |
| WebSocket upgrade | `bridge-server.js:50-71` | `acceptWebSocket()` — RFC 6455 handshake with SHA-1 accept key |
| Frame encoding | `bridge-server.js:73-92` | `createWsFrame(opcode, payload)` — supports payloads up to 2^63 bytes |
| Client frame parsing | `bridge-server.js:111-146` | `parseClientFrame()` — handles masking, extended lengths |
| Auth token | `bridge-server.js:267` | `randomBytes(24).toString('hex')` — 48-char hex token for mutations |
| Timing-safe auth | `bridge-server.js:190-202` | `tokenMatches()` uses `timingSafeEqual` |
| Path traversal guard | `bridge-server.js:204-223` | `resolveDashboardAssetPath()` validates resolved path stays within dashboardDir |

### Real-Time Event Push

| Component | File:Line | Evidence |
|-----------|-----------|----------|
| File watcher setup | `bridge-server.js:266` | `new FileWatcher(agentxchainDir)` |
| Invalidation broadcast | `bridge-server.js:279-283` | Watcher `invalidate` → broadcasts `{ type: 'invalidate', resource }` to all WS clients |
| Event data push | `bridge-server.js:285-310` | On `/api/events` invalidation: reads new `events.jsonl` lines, pushes `{ type: 'event', event }` per-client with subscription filtering |
| Event subscription | `bridge-server.js:265` | `wsEventSubscriptions` Map — clients subscribe to specific event types or `null` (all) |
| Coordinator events | `bridge-server.js:313-329` | `watchChildRepoEvents()` pushes `{ type: 'coordinator_event', repo_id, event }` |

### File Watcher

| Component | File:Line | Evidence |
|-----------|-----------|----------|
| Class definition | `file-watcher.js:15` | `class FileWatcher extends EventEmitter` |
| Debounce constant | `file-watcher.js:13` | `DEBOUNCE_MS = 100` |
| Watch setup | `file-watcher.js:26-79` | `#watchPath()` — uses native `fs.watch()` with optional recursive mode |
| Resource mapping | `file-watcher.js:44` | Calls `resourcesForRelativePath(relativePath)` to map file → API resource |
| Debounce logic | `file-watcher.js:57-66` | Per-resource debounce timer, 100ms window |
| Watched directories | `state-reader.js:64-70` | `WATCH_DIRECTORIES`: root, multirepo, missions, reports, watch-results |
| Recursive dirs | `state-reader.js:76-78` | `RECURSIVE_WATCH_DIRECTORIES`: missions/plans |
| dispatch-progress mapping | `state-reader.js:86-88` | `dispatch-progress-*.json` → `/api/state` (active turn progress updates) |

### State Reader API

| Component | File:Line | Evidence |
|-----------|-----------|----------|
| Resource map | `state-reader.js:37-52` | `RESOURCE_MAP` — 13 entries mapping API paths to `.agentxchain/` files |
| Reverse map | `state-reader.js:57-62` | `FILE_TO_RESOURCE` — file change → API resource for invalidation |
| State enrichment | `state-reader.js:145` | `enrichGovernedState()` — applies approval-pause repair, budget reconciliation, stale-turn fixes, dispatch progress merge |
| Dispatch progress | `state-reader.js:19` | Imports `readAllDispatchProgress()` — merged into state for active turn activity display |

### HTTP API Endpoints

| Endpoint | Handler | Purpose |
|----------|---------|---------|
| `/api/session` | `bridge-server.js:348-358` | Session info + mutation token + capabilities |
| `/api/poll` | `bridge-server.js:360-364` | Dashboard heartbeat, SLA reminder evaluation |
| `/api/state` | State reader | Governed run state (enriched: active turns, phase, budget, dispatch progress) |
| `/api/history` | State reader | Turn acceptance/rejection history (includes `runtime_id`) |
| `/api/events` | State reader | Run events JSONL (58 event types) |
| `/api/ledger` | State reader | Decision ledger |
| `/api/continuity` | State reader | Session recovery state |
| `/api/connectors` | `connectors.js` | Connector health (runtime_id, state, active_turn_ids) |
| `/api/gate-actions` | `gate-action-reader.js` | Pending gate evaluations with file-level detail |
| `/api/actions/approve-gate` | `bridge-server.js:366-384` | POST mutation: approve pending gate (token-authed) |
| `/api/workflow-kit-artifacts` | `workflow-kit-artifacts.js` | Workflow artifact status |
| `/api/notifications` | `notifications-reader.js` | SLA reminders, escalation notifications |
| `/api/run-history` | `run-history.js` | Historical run records with cost/duration |
| `/api/missions`, `/api/plans` | `mission-reader.js`, `plan-reader.js` | Mission + plan tracking |
| `/api/chain-reports` | `chain-report-reader.js` | Chain execution reports |
| `/api/coordinator/*` | Various | Multi-repo coordinator state, history, barriers, blockers |

### Dashboard UI Views

| View | File | Key Features |
|------|------|-------------|
| Timeline | `components/timeline.js:444` | Active turns (474-493), phase header (464), dispatch activity, conflict panel, continuity, connector health |
| Gate | `components/gate.js` | Pending gates, file-level evidence, approve action, CLI fallback command |
| Ledger | `components/ledger.js` | Decision ledger with agent/phase/date filters |
| Hooks | `components/hooks.js` | Hook audit trail with verdict/phase/name filters |
| Blocked | `components/blocked.js` | Current blocked state, coordinator blockers, gate actions |
| Delegations | `components/delegations.js` | Agent delegation chains |
| Run History | `components/run-history.js` | Historical runs with `total_cost_usd` (line 177), status, outcomes |
| Notifications | `components/notifications.js` | SLA reminders and escalations |
| Mission | `components/mission.js` | Mission and plan tracking |
| Live Status | `components/live-status.js:24` | `renderLiveStatus(liveMeta)` — freshness badge (live/stale/disconnected) |

### Live Observer

| Component | File:Line | Evidence |
|-----------|-----------|----------|
| Stale threshold | `live-observer.js:1` | `LIVE_OBSERVER_STALE_MS = 15_000` (15s) |
| Live meta builder | `live-observer.js:17` | `buildLiveMeta()` — computes freshness state (live, stale, disconnected) from last refresh |
| Event processor | `live-observer.js:64` | `createLiveEventFromMessage()` — extracts event info from WebSocket messages |
| App integration | `app.js:26-28` | Imports `buildLiveMeta`, `createLiveEventFromMessage`, `shouldRefreshViewForLiveMessage` |
| Poll fallback | `app.js:96` | `DASHBOARD_POLL_INTERVAL_MS = 60_000` — 60s poll as WebSocket fallback |

### Model Attribution in History

| Component | File:Line | Evidence |
|-----------|-----------|----------|
| History entry write | `governed-state.js:5171` | `runtime_id: turnResult.runtime_id` stored in history entry |
| Turn assignment | `governed-state.js:3697` | `runtime_id: runtimeId` set at assignment time |
| Connector health | `timeline.js:410` | Renders `connector.runtime_id` in connector health panel |
| History API | `/api/history` | Returns full JSONL entries including `runtime_id` per turn |

---

## 3. Test Coverage

| Test File | Tests | Coverage |
|-----------|-------|----------|
| `dashboard-bridge.test.js` | Core bridge server lifecycle, WebSocket, auth | 
| `dashboard-event-stream.test.js` | WebSocket event push, subscription filtering |
| `dashboard-views.test.js` | All view render functions (timeline, gate, etc.) |
| `dashboard-app.test.js` | App routing, data fetching, view mounting |
| `e2e-dashboard.test.js` | End-to-end: start → fetch → push → stop |
| `dashboard-command.test.js` | CLI command behavior, daemon mode, port handling |
| `dashboard-gate-actions.test.js` | Gate approval flow + token auth |
| `dashboard-reconciliation.test.js` | State enrichment (budget, stale turns, dispatch) |
| `dashboard-bridge-resource-endpoints.test.js` | All API resource endpoints |
| `dashboard-timeout-status.test.js` | Timeout status rendering |
| `dashboard-notifications.test.js` | SLA reminders + escalation |
| `dashboard-connector-health.test.js` | Connector health panel |
| `dashboard-mission.test.js` | Mission view |
| `dashboard-plan.test.js` | Plan view |
| `dashboard-chain.test.js` | Chain report view |
| `dashboard-blockers.test.js` | Coordinator blockers |
| `dashboard-delegations.test.js` | Delegation chains |
| `e2e-dashboard-enterprise-app.test.js` | Enterprise features |
| `dashboard-evidence-drilldown.test.js` | Evidence drilldown |
| `dashboard-historical-scope-content.test.js` | Historical scoping |
| `dashboard-watch-results.test.js` | Watch results view |
| `dashboard-coordinator-timeout-status.test.js` | Coordinator timeouts |
| `e2e-dashboard-enterprise-gates.test.js` | Enterprise gate flow |
| `e2e-dashboard-gate-actions.test.js` | Gate action mutations |
| `workflow-kit-dashboard.test.js` | Workflow kit artifact display |
| `governed-ide-restart-dashboard.test.js` | IDE restart resilience |
| `doctor-dashboard-visibility.test.js` | `agentxchain doctor` dashboard checks |
| `docs-dashboard-content.test.js` | Documentation content |

**Total: 28 files, 478 tests, 0 failures** (verified 2026-05-03)

---

## 4. Key Architecture Invariants

1. **Localhost-only binding**: Bridge server binds to `127.0.0.1` — no external network exposure
2. **Token-authed mutations**: Only `approve-gate` is mutable, requiring valid 48-char hex token
3. **No caching**: State reader performs fresh file reads on every request (files are small)
4. **Event push is append-only**: Bridge tracks `lastEventsFileSize` to push only new events
5. **Debounced invalidation**: 100ms debounce prevents WebSocket flood during rapid state changes
6. **Graceful degradation**: 60s HTTP poll fallback if WebSocket disconnects
7. **No external dependencies**: HTTP, WebSocket, file watching all use Node.js native modules
8. **Replay mode**: `agentxchain replay export` can open read-only dashboard on exported snapshots

---

## Dev Charter

### Scope

**Verification-only — no code changes.**

1. Confirm each line number reference in Section 2 is accurate
2. Run all 28 dashboard test files and confirm 478 tests pass
3. Produce evidence document (`.planning/IMPLEMENTATION_NOTES.md`) with corrections if any citation is wrong
4. If all citations are accurate, document "all cited references verified, 0 corrections"

### Out of Scope

- Any code modifications
- Any new tests
- UI styling changes
- M7+ features

### Verification

Dev must confirm:
1. All 28 dashboard test files pass (478 tests, 0 failures)
2. Each cited file:line reference matches the described functionality
3. WebSocket event push path works as documented

## Interface

### Dashboard Data Flow

```
                    ┌─────────────────────────────────────┐
                    │         Run Loop / Step              │
                    │  (emitRunEvent → events.jsonl)       │
                    └──────────────┬──────────────────────┘
                                   │ filesystem write
                    ┌──────────────▼──────────────────────┐
                    │        .agentxchain/                  │
                    │  state.json   events.jsonl            │
                    │  history.jsonl dispatch-progress-*.json│
                    └──────────────┬──────────────────────┘
                                   │ fs.watch()
                    ┌──────────────▼──────────────────────┐
                    │       FileWatcher (100ms debounce)    │
                    │  Maps file → API resource path        │
                    └──────────────┬──────────────────────┘
                                   │ emit('invalidate')
                    ┌──────────────▼──────────────────────┐
                    │       Bridge Server                   │
                    │  1. Broadcast { type: 'invalidate' }  │
                    │  2. If /api/events: push new events   │
                    └──────────────┬──────────────────────┘
                                   │ WebSocket frame
                    ┌──────────────▼──────────────────────┐
                    │       Browser (app.js)                │
                    │  1. Receive invalidation              │
                    │  2. Re-fetch affected API resource    │
                    │  3. Re-render active view             │
                    └─────────────────────────────────────┘
```

### API Resource → File Mapping

| API Resource | .agentxchain/ File | Updated By |
|---|---|---|
| `/api/state` | `state.json` + `dispatch-progress-*.json` | Run loop, step command, acceptance |
| `/api/history` | `history.jsonl` | Turn acceptance |
| `/api/events` | `events.jsonl` | `emitRunEvent()` (58 event types) |
| `/api/ledger` | `decision-ledger.jsonl` | Turn acceptance |
| `/api/gate-actions` | Gate evaluation | Phase transition requests |

## Acceptance Tests

- [ ] All 5 ROADMAP.md M6 items checked off with evidence annotations
- [ ] Dev verifies all cited line numbers are accurate (0 corrections expected)
- [ ] 28 dashboard test files pass: 478 tests, 0 failures
- [ ] Full test suite passes with 0 failures (deferred to QA)
