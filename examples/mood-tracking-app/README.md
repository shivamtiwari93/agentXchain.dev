# Mood Tracking App — example

This folder is **one example** of the AgentXchain framework. Four agents (PM, Fullstack Dev, QA, QA/UX) build a **Mood Tracking App** (log mood, view history, simple insights) by taking turns in this shared workspace.

**For the full framework docs** — how to run agents, comparison with MCP and A2A, protocol v2 summary — see the **AgentXchain framework README** at the dev root:

**[agentXchain.dev/README.md](../../README.md)** (framework root). Examples live under **`agentXchain.dev/examples/`**.

---

## What’s in this folder

| File | Purpose |
|------|--------|
| **PROTOCOL-v2.md** | Full protocol for this example: Phase 0, roles, lock, state, tool use, handoff, compression. **Read this first** when working in this example. |
| **moodTracking-poc.md** | Main log: LOCK summary, COMPRESSED CONTEXT, MESSAGE LOG. Agents append their turns here. |
| **lock.json** | Authoritative turn state: `current_holder` (1–4), `turn_number`, `last_updated_by`. |
| **state.json** | Phase, blocked flag, `blocked_on`, `project_one_liner`. |
| **HUMAN_TASKS.md** | Human task list. Append when the process needs a human; mark done when complete. |
| **AUTO-MODE-INSTRUCTIONS.md** | For Cursor Auto: copy-paste instructions so each agent recursively waits 60s, checks lock, does work or repeats. |
| **CHECK-TURN-PROMPTS.md** | One-off prompts when you manually trigger a “check if it’s your turn” in a session. |
| **scripts/check-turn.sh** | Prints `current_holder` and `turn_number`; with one arg (e.g. `2`), exits 0 if it’s that agent’s turn. |
| **scripts/wait-for-my-turn.sh** | Blocking: waits 60s, checks lock, repeats until it’s your turn, then exits 0. |

---

## Quick start for this example

1. Read **PROTOCOL-v2.md** in this folder.  
2. Use **AUTO-MODE-INSTRUCTIONS.md** for copy-paste blocks for Agent 1–4 (workspace folder = this folder).  
3. Check whose turn it is: open `lock.json` or run `./scripts/check-turn.sh`.  
4. Run agents (manual trigger or Auto with wait loop) as described in the **AgentXchain framework README** at [agentXchain.dev/README.md](../../README.md).

**Project goal:** Mood Tracking App — users log mood, view history, get simple insights. The four agents discover scope, build, run QA, and prepare for deploy using the shared protocol and files above.

---

## Run and deploy

- **Install:** `npm install` (Node 18+).
- **Run:** `npm start` (server on `PORT` or 3000). Static files from `public/`; API under `/api/*`.
- **Dev:** `npm run dev` (watch mode).
- **Test:** `npm test` (starts server on port 3099, runs API checks, exits).
- **Deploy:** Set `PORT` in the environment; ensure writable `data/` for SQLite. No secrets required for MVP; session cookies are httpOnly and same-origin.
