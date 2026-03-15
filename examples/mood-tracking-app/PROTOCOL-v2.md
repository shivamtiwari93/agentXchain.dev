# AgentXchain Protocol v2 — Mood Tracking App

**Project:** Build a Mood Tracking App (discover and try as a team using this protocol).

**Improvements over v1:** Phase 0 pre-flight, structured state files, explicit blocked state, human task list, tool-use rules, optional targeted handoff, git-one-commit-per-turn, atomic lock flow.

---

## PHASE 0 — PRE-FLIGHT (Before Turn 1)

**Complete this once before any agent takes Turn 1.** If any item fails, resolve it (or add to `HUMAN_TASKS.md`) before starting.

- [ ] **Git identity:** `git config user.email` and `git config user.name` are set in this repo.
- [ ] **Environment:** Project folder exists; if codebase exists, `npm install` and `npm run build` (or equivalent) succeed.
- [ ] **Secrets (if needed):** Any required API keys or env vars are documented in `.env.example`; agents assume human will set them when needed for deploy.
- [ ] **Lock/state:** `lock.json` and `state.json` exist and match the templates below; `current_holder` in `lock.json` is `1`.

When Phase 0 is done, the human (or Agent 1 in Turn 1) should set `state.json` → `phase` to `"Build"` and leave the lock with Agent 1.

---

## ROLES

| Agent | Role | Mandate |
|-------|------|---------|
| **1** | Product Manager & Customer Evangelist | Quality uplift, purchase blockers, voice of customer, production quality. |
| **2** | Staff Fullstack Developer | Implement features, run build/lint, use tools (git, npm, etc.) during turn. |
| **3** | QA SDET Engineer | Test coverage, regression, acceptance criteria, automation. |
| **4** | QA SDET (UI/UX + Compression) | Visual/UX checks, context compression when doc >5000 words. |

---

## COMMUNICATION RULES

- **Cycle:** 1 → 2 → 3 → 4 → 1 → … (default). See **Targeted handoff** below for exceptions.
- **Lock:** Only the agent whose number equals `lock.json` → `current_holder` may write. Everyone reads `lock.json` and the main POC doc before acting.
- **Messages:** Append to the **MESSAGE LOG** section of the main POC doc (`moodTracking-poc.md`). Each message: header `[Agent N] (role) | Turn T`, then **Introduction/Status**, **Decision**, **Action**, **Handoff**.
- **Source of truth:** Treat the latest message from the previous agent as what you respond to.
- **Routing:** If you need input from a non-adjacent agent, route the request through the next agent in the cycle (or use a targeted handoff if the protocol allows it).

---

## STRUCTURED STATE (v2)

Use these files so tools and agents can read/write state without parsing markdown.

### 1. `lock.json` (single source of truth for turn and holder)

```json
{
  "current_holder": 1,
  "last_updated_by": 0,
  "turn_number": 0
}
```

- **current_holder:** The only agent (1–4) allowed to write this turn.
- **last_updated_by:** Agent number who last updated the lock.
- **turn_number:** Monotonic; increment by 1 when you finish your turn. Your message MUST use this incremented value as Turn T.

**Atomic flow when it’s your turn:**
1. Read `lock.json`. If `current_holder` ≠ your number, **stop**; do not write.
2. Write ALL your content: message in MESSAGE LOG, any code/docs, updates to `state.json` if needed.
3. **Last:** Update `lock.json`: set `current_holder` to the next agent (or target of targeted handoff), `last_updated_by` to your number, `turn_number` to previous + 1.
4. If you use git: one commit per turn, message e.g. `Turn N - Agent M - short description`.

### 2. `state.json` (phase, block reason, one-line context)

```json
{
  "phase": "Build",
  "blocked": false,
  "blocked_on": null,
  "blocked_since_turn": null,
  "project_one_liner": "Mood tracking app — log mood, view history, simple insights."
}
```

- **phase:** One of `"Discovery"` | `"Build"` | `"QA"` | `"Deploy"` | `"Blocked"`.
- **blocked:** If true, the process is waiting on something (usually human).
- **blocked_on:** Short string, e.g. `"human: set OPENAI_API_KEY"` or `"human: git config"`.
- **blocked_since_turn:** Turn number when blocked (optional).
- **project_one_liner:** One sentence describing the product; update when the scope is set or changes.

When **blocked:** The agent with the lock may do a **no-op turn**: short message (“Still blocked on X. Passing lock.”), then advance the lock. No need to repeat long “waiting” paragraphs. When the human resolves the blocker, they (or the next agent) set `blocked: false`, `blocked_on: null`, and set `phase` as appropriate.

### 3. `HUMAN_TASKS.md`

- When the process needs a human action, **append** a task (numbered list or checkbox).
- When the human completes it, **mark it done** (e.g. `[x]` or “DONE”).
- Agents may check this file; if the only work is “wait for human,” do a no-op turn and pass the lock.

---

## LOCK MECHANISM (DETAIL)

- Before writing, read `lock.json` and the POC doc. Confirm `current_holder` matches your agent number.
- **Order of operations:** (1) Append your full message to MESSAGE LOG. (2) Apply any code/config changes. (3) Update `state.json` if needed. (4) **Last:** Update `lock.json` (current_holder, last_updated_by, turn_number).
- Never update `lock.json` before your content is fully written.
- If the file or `lock.json` changed between your read and your write, re-read and try again (optimistic concurrency).
- One new message per turn; your Turn T must match the new `turn_number`.

---

## TOOL USE (EXPLICIT)

- When you have the lock, you **may** run tools: shell (e.g. `npm run build`, `npm test`, `git status`, `git add`, `git commit`), editor, linter, etc.
- Your **Action** section must state: what you ran, what the outcome was (pass/fail, key output), and any follow-up. If you could not run a tool (e.g. no permission), say so.
- Example: “Ran `npm test` — 12/12 passed. Ran `git add -A && git commit -m 'Turn 5 - Agent 2 - Add mood log API'` — success.”

---

## TARGETED HANDOFF (OPTIONAL)

- **Default:** Handoff to the next agent in the cycle (1→2→3→4→1).
- **Optional:** For narrow, single-agent tasks you may hand off directly, e.g. “Handoff: Agent 4 (compression only).” Then set `lock.json` → `current_holder` to 4. Agent 4 does only that task (e.g. compress context), then hands back to the next in cycle (e.g. 1).
- Use sparingly to avoid skipping necessary review (e.g. don’t skip QA for feature work).

---

## AGENT 1 — PRODUCT MANAGER MANDATE

Each turn must include:
1. **Quality uplift:** What we’re improving and why.
2. **Purchase blocker:** At least one reason users wouldn’t adopt the product and how we fix it.
3. **Voice of the customer:** Decisions framed from the user’s perspective.
4. **Real product:** Decisions reflect production quality, not demo-only.

---

## COMMON INSTRUCTIONS — ALL AGENTS

- **Challenge each other.** Find at least one issue or risk before agreeing. “Looks good, ship it” is not enough; say what you checked and why it holds.
- Healthy conflict improves the product.

---

## CONTEXT COMPRESSION (AGENT 4)

- After your turn, if the POC doc (MESSAGE LOG + COMPRESSED CONTEXT) is >5000 words, compress older messages into **COMPRESSED CONTEXT**.
- Keep: business idea, MVP scope, open risks, in-flight tasks, next handoff.
- Keep at least the latest full round uncompressed in MESSAGE LOG.

---

## GIT AND HISTORY

- Prefer **one commit per turn** (e.g. “Turn 7 - Agent 2 - Mood log API and DB schema”). Full history stays in git; compression in the doc is for “current context,” not the only record.
- If you must revert, do it in a new turn and describe what was reverted and why.

---

## FILES IN THIS FOLDER

| File | Purpose |
|------|--------|
| `PROTOCOL-v2.md` | This protocol. |
| `moodTracking-poc.md` | Main log: LOCK summary, COMPRESSED CONTEXT, MESSAGE LOG. |
| `lock.json` | Current holder, turn number (authoritative). |
| `state.json` | Phase, blocked flag, blocked_on, project one-liner. |
| `HUMAN_TASKS.md` | Human task list; append and mark done. |
| `README.md` | How to run the four agents and use this protocol. |

---

## QUICK START FOR AGENTS

1. Read `PROTOCOL-v2.md` (this file).
2. Read `lock.json`. If `current_holder` ≠ your number, stop (or run again later / when notified).
3. Read `state.json` and latest messages in `moodTracking-poc.md`. If `blocked` is true and you have nothing to unblock, do a short no-op and pass the lock.
4. Do your work: update code, run tools, then append your message to MESSAGE LOG in `moodTracking-poc.md`.
5. Update `state.json` if phase or block status changed.
6. Update `lock.json` last: next holder, yourself as last_updated_by, turn_number + 1.
7. If using git: commit with message `Turn N - Agent M - description`.
