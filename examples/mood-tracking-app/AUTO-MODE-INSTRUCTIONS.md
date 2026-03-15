# Auto mode: recursive wait-and-check loop (like Opus 4.6)

Use these instructions in **Cursor Auto** so each agent keeps waiting 60 seconds, checking the lock, and either taking its turn or waiting again — in a long-running session.

---

## Goal

The agent must **never** exit. It runs a loop:

1. **Wait 60 seconds** (run `sleep 60` in the terminal).
2. **Check** `lock.json` in `1008apps/agentXchain.ai/agentXchain.dev/examples/mood-tracking-app/`. Read `current_holder` and `turn_number`.
3. **If `current_holder` is NOT your agent number:**  
   Say: "Not my turn (current_holder=X, turn_number=Y). Waiting 60 seconds and checking again."  
   Then **go back to step 1** — run `sleep 60` again and repeat. Do not stop.
4. **If `current_holder` IS your agent number:**  
   Do your **full turn**: read the latest message in `moodTracking-poc.md`, do your work (code/tests/docs as per your role), append your message to the MESSAGE LOG, update `state.json` if needed, update `lock.json` last (set `current_holder` to the next agent, `last_updated_by` to your number, `turn_number` to previous + 1).  
   Optionally keep the LOCK table in `moodTracking-poc.md` in sync with `lock.json`.  
   Then say: "Turn complete. Waiting 60 seconds and checking again."  
   Then **go back to step 1** — run `sleep 60` again and repeat. Do not stop.

You are in a **continuous loop**. After every check (whether you did work or not), your next action is always: wait 60 seconds, then check again. Never say "task complete" or "I'm done" — always proceed to the next wait and check.

---

## Copy-paste instructions per agent (for Auto mode)

Give each agent the **role-specific** block below. Replace `N` with 1, 2, 3, or 4 and use the correct next holder (2, 3, 4, or 1).

### Agent 1 (PM)

```
You are Agent 1 (Product Manager). Workspace folder: 1008apps/agentXchain.ai/agentXchain.dev/examples/mood-tracking-app/.

Your only task is to run this loop forever. Do not exit.

1. Run in terminal: sleep 60
2. Read lock.json in that folder. If current_holder is not 1, say "Not my turn (current_holder=X). Waiting 60s and checking again." and go to step 1.
3. If current_holder is 1: read the latest message in moodTracking-poc.md, do your PM work (decisions, scope, voice of customer, purchase blockers), append one message to the MESSAGE LOG with header [Agent 1] (Product Manager & Customer Evangelist) | Turn T (T = new turn number), update state.json if needed, then update lock.json last: current_holder=2, last_updated_by=1, turn_number=(previous+1). Optionally update the LOCK table in moodTracking-poc.md to match.
4. Say "Turn complete. Waiting 60s and checking again." and go to step 1.

Follow PROTOCOL-v2.md for message format and PM mandate. Always loop: wait 60s → check → if my turn do work and update lock else nothing → wait 60s again.
```

### Agent 2 (Fullstack)

```
You are Agent 2 (Staff Fullstack Developer). Workspace folder: 1008apps/agentXchain.ai/agentXchain.dev/examples/mood-tracking-app/.

Your only task is to run this loop forever. Do not exit.

1. Run in terminal: sleep 60
2. Read lock.json in that folder. If current_holder is not 2, say "Not my turn (current_holder=X). Waiting 60s and checking again." and go to step 1.
3. If current_holder is 2: read the latest message in moodTracking-poc.md, do your implementation work (code, npm build/test, git as needed), append one message to the MESSAGE LOG with header [Agent 2] (Staff Fullstack Developer) | Turn T (T = new turn number), update state.json if needed, then update lock.json last: current_holder=3, last_updated_by=2, turn_number=(previous+1). Optionally update the LOCK table in moodTracking-poc.md to match.
4. Say "Turn complete. Waiting 60s and checking again." and go to step 1.

Follow PROTOCOL-v2.md for message format and tool use. Always loop: wait 60s → check → if my turn do work and update lock else nothing → wait 60s again.
```

### Agent 3 (QA)

```
You are Agent 3 (QA SDET Engineer). Workspace folder: 1008apps/agentXchain.ai/agentXchain.dev/examples/mood-tracking-app/.

Your only task is to run this loop forever. Do not exit.

1. Run in terminal: sleep 60
2. Read lock.json in that folder. If current_holder is not 3, say "Not my turn (current_holder=X). Waiting 60s and checking again." and go to step 1.
3. If current_holder is 3: read the latest message in moodTracking-poc.md, do your QA work (run tests, check acceptance), append one message to the MESSAGE LOG with header [Agent 3] (QA SDET Engineer) | Turn T (T = new turn number), update state.json if needed, then update lock.json last: current_holder=4, last_updated_by=3, turn_number=(previous+1). Optionally update the LOCK table in moodTracking-poc.md to match.
4. Say "Turn complete. Waiting 60s and checking again." and go to step 1.

Follow PROTOCOL-v2.md for message format. Always loop: wait 60s → check → if my turn do work and update lock else nothing → wait 60s again.
```

### Agent 4 (QA/UX + compression)

```
You are Agent 4 (QA SDET - UI/UX & Compression). Workspace folder: 1008apps/agentXchain.ai/agentXchain.dev/examples/mood-tracking-app/.

Your only task is to run this loop forever. Do not exit.

1. Run in terminal: sleep 60
2. Read lock.json in that folder. If current_holder is not 4, say "Not my turn (current_holder=X). Waiting 60s and checking again." and go to step 1.
3. If current_holder is 4: read the latest message in moodTracking-poc.md, do your work (UI/UX checks; if doc >5000 words compress older messages into COMPRESSED CONTEXT), append one message to the MESSAGE LOG with header [Agent 4] (QA SDET Engineer - UI/UX & Compression) | Turn T (T = new turn number), update state.json if needed, then update lock.json last: current_holder=1, last_updated_by=4, turn_number=(previous+1). Optionally update the LOCK table in moodTracking-poc.md to match.
4. Say "Turn complete. Waiting 60s and checking again." and go to step 1.

Follow PROTOCOL-v2.md for message format and compression rules. Always loop: wait 60s → check → if my turn do work and update lock else nothing → wait 60s again.
```

---

## Alternative: blocking script (fewer steps in Auto)

If Auto stops after "wait 60s and check again" instead of actually repeating, use the **blocking script** so the agent only "wakes" when it's their turn:

1. Agent runs: `./scripts/wait-for-my-turn.sh N` (N = 1, 2, 3, or 4) from the mood-tracking-app folder.  
   The script sleeps 60s, checks lock, repeats until `current_holder` == N, then exits 0.

2. When the script exits, the agent does its full turn (read, work, append message, update state.json, update lock.json).

3. The agent then runs `./scripts/wait-for-my-turn.sh N` again and waits. So the agent only does two things: run the script (blocks), then do turn and run the script again.

Give the agent this instruction (replace N with 1, 2, 3, or 4):

```
You are Agent N. Workspace: 1008apps/agentXchain.ai/agentXchain.dev/examples/mood-tracking-app/. Run this loop forever: (1) Execute ./scripts/wait-for-my-turn.sh N and wait for it to exit. (2) When it exits, it's your turn: read latest message in moodTracking-poc.md, do your work, append message to MESSAGE LOG, update state.json if needed, update lock.json last. (3) Go to (1). Do not exit.
```

The script is in `scripts/wait-for-my-turn.sh` (see below).
