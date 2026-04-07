# `agentxchain demo` — Zero-Friction First Run

## Purpose

Give evaluators a one-command path to see governed multi-agent delivery in action.
No API keys, no git init, no config, no manual turn authoring. Just:

```bash
npx agentxchain demo
```

## Problem

Today's quickstart is 11 steps. The "aha" moment — seeing governance enforce objections, phase gates, and human authority — requires understanding phases, roles, gates, and PM signoff before anything happens. Most evaluators bounce before step 4.

## Interface

```
agentxchain demo [--json] [--verbose]
```

- Creates a temp dir, scaffolds a minimal governed project
- Runs a complete PM → Dev → QA → completion lifecycle using built-in echo results
- Prints narrated output showing each governed action
- Cleans up the temp dir on exit
- Exit 0 on success, 1 on failure

## Behavior

### Lifecycle

1. Scaffold governed project in `$TMPDIR/agentxchain-demo-<random>/`
2. `git init` + initial commit (required for repo observation)
3. `initRun()` → prints run ID
4. PM turn (review_only):
   - `assignTurn(root, config, 'pm')` → print assignment
   - Stage a canned PM turn result with one decision and one objection
   - Write `PM_SIGNOFF.md` with `Approved: YES`
   - `git add + commit` the PM work
   - `acceptTurn()` → print acceptance
5. Approve planning → implementation transition:
   - `approvePhaseGate()` → print gate passage
6. Dev turn (authoritative):
   - `assignTurn(root, config, 'dev')` → print assignment
   - Stage a canned dev turn result with implementation artifacts
   - Write a simple `app.js` file as the "implementation"
   - `git add + commit` the dev work
   - `acceptTurn()` → print acceptance
7. QA turn (review_only):
   - `assignTurn(root, config, 'qa')` → print assignment
   - Stage a canned QA review turn result with objection + ship verdict
   - `acceptTurn()` → print acceptance + pending completion
8. `approveCompletionGate()` → print completion
9. Print summary: run ID, turns executed, decisions, objections, total time
10. Clean up temp dir

### Output Style

Narrated terminal output, not raw JSON. Each step shows:
- What is happening and why
- The governed action (assign, accept, gate)
- Key artifacts (decisions, objections, phase transitions)
- A one-line lesson about what governance enforced

Example:
```
  AgentXchain Demo — Governed Multi-Agent Delivery in 60 Seconds
  ─────────────────────────────────────────────────────────────

  ▸ Scaffolding governed project...
  ▸ Starting governed run: run_abc123

  ── PM Turn (Planning) ──
  ▸ Assigned PM turn: turn_def456
  ▸ PM created roadmap with 3 acceptance criteria
  ▸ PM raised 1 objection: "No error recovery strategy defined"
    → Governance requires every role to challenge, not rubber-stamp
  ▸ PM approved planning signoff
  ▸ Turn accepted ✓

  ── Phase Gate: planning → implementation ──
  ▸ Gate passed: PM_SIGNOFF.md contains "Approved: YES"
    → No agent can skip this. Only a human approves planning exit.

  ── Dev Turn (Implementation) ──
  ▸ Assigned Dev turn: turn_ghi789
  ▸ Dev created app.js (47 lines), wrote 2 tests
  ▸ Dev resolved PM objection: added error recovery
  ▸ Verification: 2/2 tests passing
  ▸ Turn accepted ✓

  ── QA Turn (Review) ──
  ▸ Assigned QA turn: turn_jkl012
  ▸ QA reviewed implementation against acceptance matrix
  ▸ QA raised 1 objection: "No input validation on user ID"
    → Even in review-only mode, QA must challenge
  ▸ Ship verdict: PASS (with noted objection)
  ▸ Turn accepted ✓

  ── Run Completion ──
  ▸ Approved completion: qa_ship_verdict gate passed
  ▸ Run completed at 2026-04-07T15:30:00Z

  ── Summary ──
  Run:        run_abc123
  Turns:      3 (PM, Dev, QA)
  Decisions:  5 recorded in decision ledger
  Objections: 2 raised, 1 resolved
  Duration:   4.2s
  Governance: Phase gates enforced, challenges required, human authority preserved

  → Try it for real: agentxchain init --governed
  → Read more: https://agentxchain.dev/docs/quickstart
```

### Config

Minimal inline config (not written from templates):

```json
{
  "schema_version": 4,
  "protocol_mode": "governed",
  "project": { "id": "demo", "name": "AgentXchain Demo" },
  "roles": {
    "pm": { "title": "PM", "mandate": "...", "write_authority": "review_only", "runtime_class": "manual" },
    "dev": { "title": "Dev", "mandate": "...", "write_authority": "authoritative", "runtime_class": "manual" },
    "qa": { "title": "QA", "mandate": "...", "write_authority": "review_only", "runtime_class": "manual" }
  },
  "routing": { ... },
  "gates": {},
  "rules": { "challenge_required": true }
}
```

All turns use "manual" runtime with programmatically staged results — no adapters, no MCP, no API keys.

## Error Cases

- temp dir creation fails → exit 1 with message
- any governed operation fails → print the error, clean up, exit 1
- git not available → exit 1 with "git is required for the demo"

## Acceptance Tests

1. `agentxchain demo` exits 0
2. Output contains all 3 turn assignments
3. Output contains phase gate passage
4. Output contains run completion
5. Output contains at least 2 objections
6. `--json` mode returns structured result with run_id, turns, decisions, duration
7. Temp dir is cleaned up after exit (both success and failure)

## Open Questions

None. This is a self-contained adoption surface with no external dependencies.
