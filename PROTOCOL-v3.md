# AgentXchain Protocol v3 (HISTORICAL)

> **⚠️ This document is historical.** The current protocol is [v7](./PROTOCOL-v7.md). This file is preserved for reference only. Do not implement against v3.

**Generalized agents. Claim-based turns. User-defined teams.**

v3 replaces hardcoded roles and fixed turn order with user-defined agents and a claim-based lock. Any number of agents, any roles, any project — configured in one file.

---

## How it works

1. A human creates `agentxchain.json` defining the project, the agents, and the rules.
2. Agents read this file to discover their role and mandate.
3. When no agent holds the lock (`lock.json` → `holder: null`), the next agent is resolved from the latest `Next owner:` handoff in `TALK.md` (or `talk_file`), with cyclic fallback by config order if no handoff is present.
4. The agent that claims the lock does its work, appends a message to the log, and **releases** the lock.
5. Another agent claims. The cycle continues until the project ships.

`agentxchain watch` and generated editor hooks use the same handoff-first routing model. Humans can still intervene with `claim` / `release` or custom coordinator behavior.

---

## `agentxchain.json` — the config file

This is the single source of truth for the project configuration. Create it at the root of your project folder.

```json
{
  "version": 3,
  "project": "Short project description",
  "agents": {
    "agent-id": {
      "name": "Human-readable name",
      "mandate": "What this agent is responsible for. One paragraph max."
    }
  },
  "log": "log.md",
  "rules": {
    "max_consecutive_claims": 2,
    "require_message": true,
    "compress_after_words": 5000
  }
}
```

### Fields

| Field | Required | Description |
|-------|----------|-------------|
| `version` | yes | Must be `3`. |
| `project` | yes | One-line project description. |
| `agents` | yes | Object. Keys are agent IDs (lowercase, no spaces). Values define name and mandate. |
| `agents.<id>.name` | yes | Display name for this agent. |
| `agents.<id>.mandate` | yes | What this agent does. Agents read this to understand their job. |
| `log` | no | Path to the message log file. Default: `log.md`. |
| `rules.max_consecutive_claims` | no | Max times one agent can hold the lock in a row before another agent must go. Default: `2`. |
| `rules.require_message` | no | If `true`, every turn must append a message to the log. Default: `true`. |
| `rules.compress_after_words` | no | Word count threshold for triggering context compression. Default: `5000`. Set to `0` to disable. |
| `rules.ttl_minutes` | no | Max minutes an agent can hold the lock before it's force-released. Default: `10`. |
| `rules.verify_command` | no | Shell command agents must run before releasing the lock (e.g. `"npm test"`). If it fails, the agent must fix the issue before releasing. |
| `rules.watch_interval_ms` | no | How often the watch process polls lock.json (milliseconds). Default: `5000`. |
| `talk_file` | no | Human-readable handoff log used to route the next owner. Default: `TALK.md`. |
| `state_file` | no | Path to the living state document. Default: `state.md`. |
| `history_file` | no | Path to the append-only turn history. Default: `history.jsonl`. |

### Agent IDs

- Lowercase alphanumeric and hyphens: `pm`, `backend`, `qa-api`, `tech-writer`.
- Must be unique within the config.
- `human` and `system` are reserved IDs and cannot be used for AI agents.
- Used in `lock.json`, the message log, scripts, and seed prompts.

---

## `lock.json` — who holds the lock

```json
{
  "holder": null,
  "last_released_by": null,
  "turn_number": 0,
  "claimed_at": null
}
```

### Fields

| Field | Type | Description |
|-------|------|-------------|
| `holder` | `string` or `null` | Agent ID of the current lock holder. `null` = lock is free. |
| `last_released_by` | `string` or `null` | Agent ID that last released the lock. `null` at start. |
| `turn_number` | `number` | Monotonic counter. Incremented by 1 when an agent releases the lock. |
| `claimed_at` | `string` or `null` | ISO 8601 timestamp of when the lock was claimed. Used to detect stale/hung claims. |

### Lock states

| State | `holder` | Meaning |
|-------|----------|---------|
| **Free** | `null` | Any agent can claim. |
| **Claimed** | `"agent-id"` | Only this agent may write. All others wait. |

---

## `state.json` — project phase and status

```json
{
  "phase": "build",
  "blocked": false,
  "blocked_on": null,
  "project": "Short project description"
}
```

### Fields

| Field | Type | Description |
|-------|------|-------------|
| `phase` | `string` | Current project phase. Suggested: `"discovery"`, `"build"`, `"qa"`, `"deploy"`, `"blocked"`. User can define custom phases. |
| `blocked` | `boolean` | `true` if the project is waiting on something (usually a human action). |
| `blocked_on` | `string` or `null` | What the project is blocked on. e.g. `"human: set API key"`. |
| `project` | `string` | One-line project description (mirrors `agentxchain.json`). |

### When blocked

Any agent that claims the lock while `blocked` is `true` should check if they can resolve the blocker. If not, they do a **no-op turn**: short message ("Still blocked on X. Releasing lock."), then release. When the blocker is resolved (by a human or an agent), set `blocked: false` and `blocked_on: null`.

---

## Claim flow — what an agent does each turn

```
1. READ    lock.json
2. CHECK   Is holder null?
           → No:  Stop. Wait. Try again later.
           → Yes: Continue to step 3.
3. CLAIM   Write lock.json: holder = my_id, claimed_at = now()
4. VERIFY  Re-read lock.json. Does holder still equal my_id?
           → No:  Another agent won. Go back to step 1.
           → Yes: I have the lock. Continue.
5. READ    agentxchain.json (my role), state.json (phase), state/history docs, TALK.md (latest handoff)
6. WORK    Do my job: write code, run tests, make decisions — whatever my mandate says.
7. LOG     Append my message to the log file (see Message Format below).
8. STATE   Update state.json if the phase or blocked status changed.
9. RELEASE Write lock.json: holder = null, last_released_by = my_id,
           turn_number = previous + 1, claimed_at = null
10. DONE   Optionally: git commit with message "Turn N - agent-id - description"
```

### Rules enforced by agents

- **Never write code, files, or log messages without holding the lock.** Read is always allowed.
- **Always release the lock.** A claimed lock that's never released blocks everyone.
- **One message per turn.** Each claim-work-release cycle produces exactly one log message.
- **`max_consecutive_claims`**: Before claiming, check `last_released_by` in lock.json. If it's your own ID, check how many consecutive times you've held the lock (count from the log). If you've hit the limit, skip this round and let another agent go.
- **Release lock.json last.** All work and writes must be complete before you set `holder: null`.

### Lock TTL (Time-To-Live)

If `claimed_at` is older than `rules.ttl_minutes` (default: 10), the **watch process** (`agentxchain watch`) will force-release the lock, write a warning to the log, and trigger the next agent. This prevents deadlocks from crashed or hung agents.

### Verify before release

If `rules.verify_command` is set (e.g. `"npm test"`), agents **must** run this command before releasing the lock. If the command exits non-zero, the agent must fix the issue and run it again. The main CLI release path, the helper `release.sh` script, and generated VS Code Stop hooks all enforce this for trusted local commands. Avoid shell pipelines or chained commands in this field.

### Human as a first-class participant

- `human` is a reserved holder ID. Any agent can pass the lock to `human` by writing `holder: "human"` in lock.json.
- The watch process detects this and sends a notification (terminal bell + OS notification).
- The human works directly, then runs `agentxchain release` to hand the lock back.
- The human can also proactively claim the lock with `agentxchain claim`.

---

## State and history files

For projects that run many turns, use separate files to prevent context window blowup:

### `state.md` — living state document

Overwritten (not appended) each turn. Contains:
- Current architecture and decisions
- Active work in progress
- Open issues, bugs, blockers
- Next steps

Agents read this fully each turn to understand the current state without reading the entire history.

### `history.jsonl` — append-only turn log

One JSON line per turn:

```json
{"turn": 18, "agent": "dev", "summary": "Added mood API endpoint", "files_changed": ["server/routes/mood.js"], "verify_result": "pass", "timestamp": "2026-03-17T10:00:00Z"}
```

Agents read only the last 3 lines for recent context. Full history stays in the file for tooling and replay.

Set `state_file` and `history_file` in `agentxchain.json` to enable this mode. If not set, the classic `log.md` approach is used.

---

## Message format

Each turn appends one message to the log file. Format:

```markdown
---

### [agent-id] (Agent Name) | Turn N

**Status:** What's the current state of the project from your perspective.

**Decision:** What you decided to do this turn and why.

**Action:** What you actually did. Commands run, files changed, test results.

**Next:** What should happen next. What's unblocked, what's still needed.
```

- `agent-id` and `Agent Name` come from `agentxchain.json`.
- `Turn N` matches the new `turn_number` after you release the lock.
- All four sections are required when `rules.require_message` is true.

---

## Context compression

When the log file exceeds `rules.compress_after_words` words:

1. Any agent (not just a specific one) may compress during their turn.
2. Move older messages from the log into a `COMPRESSED CONTEXT` section at the top.
3. The compressed summary must keep: project scope, key decisions, open risks, in-flight work, unresolved bugs, current phase.
4. Keep at least the last N messages uncompressed (where N = number of agents, so every agent's most recent message is visible).

---

## `HUMAN_TASKS.md`

- When the process needs a human action, append a checkbox item.
- When the human completes it, mark it `[x]`.
- Agents check this file before doing work. If the only path forward is "wait for human," do a no-op turn.

---

## Tool use

- When you hold the lock, you may run any tools: shell, editor, linter, git, npm, etc.
- Your **Action** section must state what you ran and the outcome.
- If you couldn't run a tool (permissions, missing dependency), say so.
- Prefer one git commit per turn: `Turn N - agent-id - description`.

---

## Common rules for all agents

- **Challenge each other.** Every turn should identify at least one risk, issue, or question about the previous work. Blind agreement ("looks good") is not enough.
- **Be specific.** Don't say "there might be issues." Say what the issue is, where it is, and what to do about it.
- **Stay in your lane.** Respect your mandate. A QA agent shouldn't redesign the architecture. A PM shouldn't write production code.
- **Unblock > perfect.** If the project is stuck, prioritize unblocking over polishing.

---

## Files in a v3 project

| File | Purpose |
|------|---------|
| `agentxchain.json` | Project config: agents, rules, settings. |
| `lock.json` | Who holds the lock, turn counter, claim timestamp. |
| `state.json` | Project phase, blocked status. |
| `TALK.md` (or custom `talk_file`) | Canonical handoff log. The latest `Next owner:` line routes the next turn. |
| `state.md` / custom `state_file` | Living project state snapshot. |
| `history.jsonl` / custom `history_file` | Append-only machine-readable turn history. |
| `log.md` (or custom) | Message log: agents append one message per turn. |
| `.agentxchain-trigger.json` | Referee handoff marker written by `watch` / `supervise`. Ignore in git. |
| `HUMAN_TASKS.md` | Human task list. |
| `PROTOCOL-v3.md` | This protocol (optional — agents can read from the framework docs). |

---

## Quick start

1. Create `agentxchain.json` with your agents and project description.
2. Create `lock.json`: `{"holder": "human", "last_released_by": null, "turn_number": 0, "claimed_at": "ISO8601"}`
3. Create `state.json`: `{"phase": "discovery", "blocked": false, "blocked_on": null, "project": "..."}`
4. Create `TALK.md`, `state.md`, `history.jsonl`, `log.md`, and `HUMAN_TASKS.md`.
5. Give each agent its seed prompt (see seed prompt template in the framework).
6. Release the initial human lock when kickoff planning is ready, then let agents claim and go.

---

## Migration from v2

| v2 | v3 |
|----|----|
| `current_holder: 1` | `holder: "pm"` (or whatever ID you choose) |
| `last_updated_by: 1` | `last_released_by: "pm"` |
| Fixed cycle 1→2→3→4→1 | Claim-based: any agent claims when free |
| Agent numbers | Agent string IDs defined in `agentxchain.json` |
| Roles hardcoded in protocol doc | Roles defined in `agentxchain.json` |
| `project_one_liner` in state.json | `project` in state.json (and `agentxchain.json`) |

Existing message logs are compatible. Just update lock.json and state.json to the new format and add `agentxchain.json`.
