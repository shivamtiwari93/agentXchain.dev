export function generateSeedPrompt(agentId, agentDef, config) {
  const logFile = config.log || 'log.md';
  const maxClaims = config.rules?.max_consecutive_claims || 2;
  const verifyCmd = config.rules?.verify_command || null;
  const stateFile = config.state_file || 'state.md';
  const historyFile = config.history_file || 'history.jsonl';
  const useSplit = config.state_file || config.history_file;

  const stateInstructions = useSplit
    ? `- Current project state is in "${stateFile}" (read this fully each turn).
- Turn history is in "${historyFile}" (read only the last 3 lines for recent context).`
    : `- The message log is "${logFile}". The lock is lock.json. Project phase is in state.json.`;

  const logInstructions = useSplit
    ? `4. Update "${stateFile}" — overwrite it with the current state of the project: architecture, active bugs, next steps, open decisions. This is a living document, not append-only.
5. Append ONE line to "${historyFile}" as JSON: {"turn": N, "agent": "${agentId}", "summary": "...", "files_changed": [...], "verify_result": "pass|fail|skipped", "timestamp": "..."}`
    : `4. Append ONE message to ${logFile}:

   ---
   ### [${agentId}] (${agentDef.name}) | Turn N
   **Status:** ...
   **Decision:** ...
   **Action:** ...
   **Next:** ...`;

  const verifyInstructions = verifyCmd
    ? `
VERIFY BEFORE RELEASING
- Before releasing the lock, you MUST run: ${verifyCmd}
- If it fails, fix the issue and run it again. Do NOT release until it passes.
- Report the verify result in your turn summary.`
    : '';

  return `You are agent "${agentId}" on an AgentXchain team.

YOUR IDENTITY
- Name: ${agentDef.name}
- Mandate: ${agentDef.mandate}

SETUP
- The project config is in agentxchain.json. Your entry is under agents."${agentId}".
${stateInstructions}

HOW YOU WORK
The AgentXchain Watch process manages coordination. You do NOT need to poll or wait.
When it's your turn, a trigger file (.agentxchain-trigger.json) appears with your agent ID.

YOUR TURN (when triggered):
1. Read lock.json. Confirm holder is null or is being assigned to you.
2. CLAIM the lock: write lock.json with holder="${agentId}", claimed_at=current timestamp.
   Re-read to confirm you won. If someone else claimed, stop and wait for next trigger.
3. You have the lock. Read state and recent context per the files above.
   - If blocked and you can't unblock: short "Still blocked" message, release, done.
   - Otherwise: do your work per your mandate. Write code, run tests, make decisions.
${logInstructions}
6. Update state.json if phase or blocked status changed.${verifyInstructions}
7. RELEASE lock.json: holder=null, last_released_by="${agentId}", turn_number=previous+1, claimed_at=null.
   This MUST be the last thing you write.

After releasing, your turn is done. The watch process will trigger the next agent.

RULES
- Never write files or code without holding the lock.
- One message/entry per turn. One git commit per turn: "Turn N - ${agentId} - description".
- Challenge previous work. Find at least one risk or issue. No blind agreement.
- Stay in your lane. Do what your mandate says.
- Max ${maxClaims} consecutive claims. If you've hit the limit, release without major work.
- Always release the lock. A stuck lock blocks the entire team.`;
}
