# V2.0 Dashboard — Implementation Plan

> Historical implementation-plan note: this file preserves the original v2.0 dashboard delivery plan and is not the current authority for live dashboard mutability.
> Original source: `V2_DASHBOARD_SPEC.md` (post DEC-DASH-002/003/004 corrections).
> Current authority for the shipped live dashboard mutation boundary: `.planning/DASHBOARD_GATE_ACTIONS_SPEC.md` and `.planning/DASHBOARD_DOCS_CONTRACT_SPEC.md`.
> Later releases superseded the original read-only live-dashboard boundary with a narrow authenticated `approve-gate` HTTP mutation; the WebSocket channel and `replay export` remain read-only.
> Historical v2.0 baseline: read-only local bridge server, vanilla ES modules, no framework build chain.

---

## Guiding Constraints

1. **Historical v2.0 baseline: read-only in v2.0** (DEC-DASH-002). No write RPC, no CLI proxy, no mutation surface in this original v2.0 slice.
2. **Vanilla ES modules** (OQ-DASH-001 resolution). No Preact, no Svelte, no bundler. Ship as static assets served by the bridge.
3. **Invalidation + refetch** (DEC-DASH-003). WebSocket sends change events; SPA refetches via HTTP. No delta protocol.
4. **Single-repo, single-run** (non-goal: multi-repo). Dashboard shows the `.agentxchain/` directory of the current working directory.
5. **Spec-before-code**. This plan defines slices. Each slice ships with tests. No slice is "done" until its acceptance tests pass.

---

## Repo Layout

```
cli/
├── src/
│   ├── commands/
│   │   └── dashboard.js            ← CLI command (Slice 1)
│   └── lib/
│       └── dashboard/
│           ├── bridge-server.js     ← HTTP + WebSocket server (Slice 1)
│           ├── file-watcher.js      ← fs.watch wrapper (Slice 1)
│           └── state-reader.js      ← JSON/JSONL file readers (Slice 2)
├── dashboard/                       ← Static SPA assets (Slice 2+)
│   ├── index.html
│   ├── app.js                       ← Entry point, router, WebSocket client
│   ├── components/
│   │   ├── timeline.js              ← V1: Run Timeline (Slice 2)
│   │   ├── ledger.js                ← V2: Decision Ledger Explorer (Slice 3)
│   │   ├── hook-audit.js            ← V3: Hook Audit Log (Slice 3)
│   │   ├── blocked.js               ← V4: Blocked State Panel (Slice 3)
│   │   └── gate.js                  ← V5: Gate Review Panel (Slice 3)
│   └── style.css
└── test/
    ├── dashboard-bridge.test.js     ← Bridge server tests (Slice 1)
    ├── dashboard-watcher.test.js    ← File watcher tests (Slice 1)
    ├── dashboard-state-reader.test.js ← State reader tests (Slice 2)
    └── e2e-dashboard.test.js        ← Full acceptance tests (Slice 4)
```

---

## Slice 1 — Bridge Server + CLI Command

**Goal:** `agentxchain dashboard` starts a local server, serves static assets, exposes read-only REST endpoints, and pushes WebSocket invalidation events on file changes.

### Deliverables

1. **`cli/src/commands/dashboard.js`**
   - Registers `agentxchain dashboard [--port 3847] [--no-open]`
   - Finds `.agentxchain/` in CWD (fails fast if absent)
   - Starts bridge server
   - Opens browser via `open` / `xdg-open` (skippable with `--no-open`)
   - Ctrl+C shuts down cleanly

2. **`cli/src/lib/dashboard/bridge-server.js`**
   - `http.createServer` bound to `127.0.0.1` (AT-DASH-007)
   - Routes:
     - `GET /` → serves `cli/dashboard/index.html`
     - `GET /assets/*` → serves static SPA assets from `cli/dashboard/`
     - `GET /api/state` → returns `state.json` content
     - `GET /api/history` → returns `history.jsonl` parsed as JSON array
     - `GET /api/ledger` → returns `decision-ledger.jsonl` parsed as JSON array
     - `GET /api/hooks/audit` → returns `hook-audit.jsonl` parsed as JSON array
     - `GET /api/hooks/annotations` → returns `hook-annotations.jsonl` parsed as JSON array
     - `POST /*`, `PUT /*`, `DELETE /*` → 405 Method Not Allowed (AT-DASH-008)
   - WebSocket upgrade on `/ws`:
     - On file change → broadcast `{ "type": "invalidate", "resource": "<api-path>" }`
   - Graceful shutdown on SIGINT/SIGTERM

3. **`cli/src/lib/dashboard/file-watcher.js`**
   - Wraps `fs.watch` on `.agentxchain/`
   - Maps changed file paths to API resource names
   - Debounces rapid changes (100ms)
   - Emits events consumed by bridge-server WebSocket broadcast
   - Handles watch errors gracefully (ENOENT, EPERM)

4. **`cli/bin/agentxchain.js`**
   - Register the `dashboard` command

### Tests (Slice 1)

**`cli/test/dashboard-bridge.test.js`:**
- Bridge starts on specified port and responds to GET /api/state
- Bridge binds to 127.0.0.1 only (AT-DASH-007)
- POST/PUT/DELETE requests return 405 (AT-DASH-008)
- WebSocket connection receives invalidation events
- Bridge serves static assets from dashboard directory
- Bridge returns 404 for missing API resources when `.agentxchain/` files don't exist
- Graceful shutdown closes all connections

**`cli/test/dashboard-watcher.test.js`:**
- Watcher emits events when state.json changes
- Watcher debounces rapid successive changes
- Watcher maps filenames to correct API resource paths
- Watcher handles watched directory not existing

### Acceptance Criteria
- AT-DASH-007 ✓ (localhost-only binding)
- AT-DASH-008 ✓ (mutation rejection)

### Dependencies
- Node.js built-in `http`, `fs`, `ws` (need to evaluate: use built-in WebSocket or add `ws` as dependency)
- **Decision needed: WebSocket library.** Node.js 21+ has experimental WebSocket client but no built-in WebSocket server. Options:
  - (a) Add `ws` as a dependency (~50KB, battle-tested, zero transitive deps)
  - (b) Roll a minimal WebSocket server from the raw upgrade handshake (~150 lines, no dependency)
  - **Recommendation: (a) `ws`.** The dashboard is not a core governance path. Adding one well-known dependency for reliable WebSocket is reasonable. The alternative is a fragile hand-rolled implementation for no real gain.

---

## Slice 2 — State Readers + Timeline View

**Goal:** The SPA loads, connects to the bridge, fetches state, and renders the run timeline (V1 view). This is the primary view and the one that proves the architecture end-to-end.

### Deliverables

1. **`cli/src/lib/dashboard/state-reader.js`**
   - `readStateFile(agentxchainDir)` → parsed state.json
   - `readJsonlFile(agentxchainDir, filename)` → parsed array of JSONL entries
   - Error handling: returns `null` for missing files, throws for malformed content
   - Used by the bridge server API handlers

2. **`cli/dashboard/index.html`**
   - Minimal shell: nav header, view container, status bar
   - Loads `app.js` as ES module
   - Inline CSS or link to `style.css`

3. **`cli/dashboard/app.js`**
   - WebSocket client connecting to `ws://localhost:<port>/ws`
   - Reconnect logic (exponential backoff, max 30s)
   - Router: hash-based (`#timeline`, `#ledger`, `#hooks`, `#blocked`, `#gate`)
   - On invalidation event → refetch affected resource → re-render active view

4. **`cli/dashboard/components/timeline.js`**
   - Renders run metadata: run_id, phase, schema_version
   - Renders turn list from state + history correlation
   - Turn status: accepted (✓), pending (◐), blocked (⚠), rejected (✗)
   - Expandable turn detail: summary, files_changed, objections, decisions, verification
   - Auto-updates on invalidation

### Tests (Slice 2)

**`cli/test/dashboard-state-reader.test.js`:**
- Reads valid state.json
- Reads valid JSONL file
- Returns null for missing files
- Throws on malformed JSON
- Handles empty JSONL files

### Acceptance Criteria
- AT-DASH-001 ✓ (timeline renders from state files)
- AT-DASH-002 ✓ (live update on turn acceptance)

---

## Slice 3 — Remaining Views

**Goal:** Ship the four remaining views: decision ledger explorer, hook audit log, blocked state panel, gate review panel.

### Deliverables

1. **`cli/dashboard/components/ledger.js`** (V2: Decision Ledger Explorer)
   - Table rendering of decision-ledger.jsonl entries
   - Filters: by agent role, by phase, by presence of objections, by date range
   - Column sorting

2. **`cli/dashboard/components/hook-audit.js`** (V3: Hook Audit Log)
   - Event stream rendering of hook-audit.jsonl
   - Filters: by phase, by verdict (allow/warn/block), by hook name
   - Duration display

3. **`cli/dashboard/components/blocked.js`** (V4: Blocked State Panel)
   - Conditional rendering: only when state.status === 'blocked'
   - Shows: reason, detail, recovery descriptor, retained turn status
   - Shows related recent hook/validation context from audit log
   - Shows exact CLI recovery command (copyable)

4. **`cli/dashboard/components/gate.js`** (V5: Gate Review Panel)
   - Conditional rendering: only when a human gate is pending
   - Shows what agents have produced since last gate
   - Summary of unresolved objections/risks
   - Exact CLI command with copy-to-clipboard

### Tests (Slice 3)
- Component-level tests for each view would require a DOM environment. Given the vanilla ES modules constraint, tests at this level will be deferred to the E2E acceptance harness (Slice 4).
- **Alternative:** Each component exports a pure `render(data)` function that returns an HTML string. These can be tested in Node.js without a DOM. The actual mounting is a thin wrapper. This is the recommended pattern.

### Acceptance Criteria
- AT-DASH-004 ✓ (blocked state visibility)
- AT-DASH-005 ✓ (hook audit log renders)
- AT-DASH-006 ✓ (decision ledger filters)

---

## Slice 4 — Fixture Data + E2E Acceptance Harness

**Goal:** End-to-end tests that prove the full dashboard against realistic governed state.

### Deliverables

1. **Fixture generator**
   - A test helper that creates a realistic `.agentxchain/` directory with:
     - 3-turn state.json (planning → development, 2 accepted + 1 pending)
     - history.jsonl with 2 accepted entries
     - decision-ledger.jsonl with entries from 3 agents
     - hook-audit.jsonl with 5 entries across 3 phases
     - hook-annotations.jsonl with 2 entries
     - A blocked variant for AT-DASH-004
     - A gate-pending variant for AT-DASH-003

2. **`cli/test/e2e-dashboard.test.js`**
   - Starts bridge server programmatically
   - Exercises all 8 acceptance tests (AT-DASH-001 through AT-DASH-008)
   - For browser-rendered views: tests the API responses and HTML string output from component render functions
   - For live updates: writes to a state file while connected via WebSocket, asserts invalidation event arrives

### Test Strategy
- **API-level tests:** Fetch `/api/state`, `/api/history`, etc. and verify shape/content against fixture data.
- **Component render tests:** Call `timeline.render(data)`, `ledger.render(data)`, etc. and verify HTML output contains expected content.
- **WebSocket tests:** Connect, trigger a file write, assert invalidation event.
- **Security tests:** Non-localhost rejection (AT-DASH-007), mutation rejection (AT-DASH-008).
- **No headless browser.** The vanilla ES modules approach means components export pure render functions. Testing these in Node.js is sufficient. If a headless browser becomes necessary later, it's a v2.1 concern.

### Acceptance Criteria
- All AT-DASH-001 through AT-DASH-008

---

## Slice Order and Dependencies

```
Slice 1 (bridge + CLI command)
  │
  ├──→ Slice 2 (state readers + timeline)
  │      │
  │      └──→ Slice 3 (remaining views)
  │             │
  └─────────────┴──→ Slice 4 (E2E acceptance)
```

**Slice 1** is fully independent. It can ship and be tested before any SPA code exists (bridge serves a placeholder page).

**Slice 2** depends on Slice 1 for the bridge server. The state reader module is also used by the bridge API handlers, so it's co-developed here.

**Slice 3** depends on Slice 2 for the app shell and routing. Individual view components are independent of each other and can be developed in parallel.

**Slice 4** depends on all prior slices but can have its fixture generator developed alongside Slice 1.

---

## What Ships in Slice 1 vs Later

| Artifact | Slice 1 | Slice 2 | Slice 3 | Slice 4 |
|----------|---------|---------|---------|---------|
| `dashboard` CLI command | ✓ | | | |
| Bridge server (HTTP + WS) | ✓ | | | |
| File watcher | ✓ | | | |
| State reader module | | ✓ | | |
| SPA shell + router | | ✓ | | |
| Timeline view | | ✓ | | |
| Ledger explorer | | | ✓ | |
| Hook audit view | | | ✓ | |
| Blocked panel | | | ✓ | |
| Gate panel | | | ✓ | |
| Fixture generator | | | | ✓ |
| E2E acceptance tests | | | | ✓ |

---

## Open Decisions for GPT 5.4

### OD-IMPL-001: WebSocket library
Add `ws` as a dependency or hand-roll? Recommendation: `ws`. Awaiting concurrence.

### OD-IMPL-002: Notification API
AT-DASH spec says opt-in desktop notifications for blocked/gate states. Should this be in Slice 3 (gate/blocked panels) or deferred to a later slice? Recommendation: include in Slice 3 since it's a few lines of Web Notification API and directly relevant to blocked/gate panels.

### OD-IMPL-003: Dashboard assets in npm package
The `cli/dashboard/` directory needs to be included in the npm package's `files` array. Currently `package.json` likely doesn't include it. This is a Slice 1 concern.

---

## Risk Register

1. **`fs.watch` reliability.** `fs.watch` is known to be platform-inconsistent (double fires on macOS, missing events on some Linux filesystems). Mitigation: debounce + periodic poll fallback (every 5s) to catch missed events.
2. **Port conflicts.** Default 3847 may be taken. Mitigation: retry on EADDRINUSE with incrementing port, log the actual port.
3. **Large JSONL files.** `history.jsonl` could grow large over many turns. Mitigation: stream-parse JSONL instead of reading entire file into memory. For v2.0, the pragmatic approach is full-file read since governed runs rarely exceed 50 turns.
4. **No build step means no minification.** Acceptable for v2.0 local use. Cloud dashboard (agentxchain.ai) can add a build step later.
