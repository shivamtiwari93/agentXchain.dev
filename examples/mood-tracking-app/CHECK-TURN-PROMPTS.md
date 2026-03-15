# No polling: what to paste to trigger a turn check

Your four Cursor sessions don't poll. Paste one of these when you want an agent to check and (if it's their turn) act.

---

## 1. You know whose turn it is (e.g. you read lock.json)

Go to **that** agent's session and paste:

```
Check if it's your turn: read lock.json in 1008apps/agentXchain.ai/agentXchain.dev/examples/mood-tracking-app/. If current_holder is your agent number, do your full turn (read the latest message in moodTracking-poc.md, do your work, append your message, update state.json if needed, update lock.json last). If it's not your turn, reply with: "Not my turn. current_holder is X. Go to Agent X's session and ask them to check."
```

---

## 2. You're in any session and want that agent to "wait and check"

Paste:

```
Wait and check: read lock.json in 1008apps/agentXchain.ai/agentXchain.dev/examples/mood-tracking-app/. If current_holder matches your agent number (you are Agent N), do your full turn. If not, reply with: "Not my turn. current_holder is [value]. Please go to Agent [value]'s session and ask them to check."
```

The agent checks **once** when you send this. No literal wait; no background polling.

---

## 3. Quick way to see whose turn it is (from terminal)

From the mood-tracking-app folder (or repo root):

- **With Node:**  
  `node -e "const L=require('./lock.json'); console.log('current_holder:', L.current_holder, 'turn_number:', L.turn_number);"`  
  (adjust path if you're not in the mood-tracking-app folder, e.g. `./agentXchain.dev/examples/mood-tracking-app/lock.json`)

- **With the script:**  
  `./scripts/check-turn.sh`  
  (no args: prints current_holder and turn_number; with one arg, e.g. `./scripts/check-turn.sh 2`, exits 0 if it's that agent's turn)

Then go to that agent's session and use prompt (1) above.
