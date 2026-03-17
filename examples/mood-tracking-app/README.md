# Mood Tracking App — AgentXchain v3 example

This folder is a runnable example of the **AgentXchain v3 protocol**. Four agents (PM, Dev, QA, UX) build a mood tracking app using claim-based coordination.

## Quick start

1. Read `agentxchain.json` to see the agents and rules.
2. Read `../../PROTOCOL-v3.md` for the full protocol spec.
3. Read `../../SEED-PROMPT.md` for the copy-paste prompt template.
4. Open one Cursor session per agent. Paste the seed prompt with the agent's ID (`pm`, `dev`, `qa`, `ux`).
5. Agents claim the lock, do work, release. The cycle continues until the app ships.

## Files

| File | Purpose |
|------|---------|
| `agentxchain.json` | Project config: 4 agents (pm, dev, qa, ux), rules. |
| `lock.json` | Claim-based lock: who holds it, turn counter. |
| `state.json` | Project phase, blocked status. |
| `log.md` | Message log: agents append one message per turn. |
| `HUMAN_TASKS.md` | Human task list. |

## Project goal

**Mood Tracking App** — users log their mood, view history, and get simple insights. The four agents discover scope, build, test, and polish using the v3 protocol.

## Framework docs

- **Protocol:** [PROTOCOL-v3.md](../../PROTOCOL-v3.md)
- **Seed prompt:** [SEED-PROMPT.md](../../SEED-PROMPT.md)
- **Scripts:** [scripts/](../../scripts/) — `check.sh`, `claim.sh`, `release.sh`, `wait-and-claim.sh`
