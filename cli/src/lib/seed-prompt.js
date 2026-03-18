export function generateSeedPrompt(agentId, agentDef, config) {
  const logFile = config.log || 'log.md';
  const maxClaims = config.rules?.max_consecutive_claims || 2;
  const verifyCmd = config.rules?.verify_command || null;
  const stateFile = config.state_file || 'state.md';
  const historyFile = config.history_file || 'history.jsonl';
  const useSplit = config.state_file || config.history_file;

  const stateSection = useSplit
    ? `READ THESE FILES EVERY TURN:
- "${stateFile}" — the living project state. Read fully. This is your primary context.
- "${historyFile}" — turn history. Read only the last 3 lines for what just happened.
- lock.json — who holds the lock.
- state.json — phase and blocked status.`
    : `READ THESE FILES EVERY TURN:
- "${logFile}" — the message log. Read the last few messages for context.
- lock.json — who holds the lock.
- state.json — phase and blocked status.`;

  const writeSection = useSplit
    ? `WRITE (in this order):
a. Do your actual work: write code, create files, run commands, make decisions.
b. Update "${stateFile}" — OVERWRITE with current project state. Architecture, active work, open issues, next steps. This is not append-only.
c. Append ONE line to "${historyFile}":
   {"turn": N, "agent": "${agentId}", "summary": "what you did", "files_changed": [...], "verify_result": "pass|fail|skipped", "timestamp": "ISO8601"}
d. Update state.json if phase or blocked status changed.`
    : `WRITE (in this order):
a. Do your actual work: write code, create files, run commands, make decisions.
b. Append ONE message to ${logFile}:
   ---
   ### [${agentId}] (${agentDef.name}) | Turn N
   **Status:** What's the project state right now.
   **Decision:** What you decided and why.
   **Action:** What you did. Commands, files, results. Be specific.
   **Next:** What the next agent should focus on.
c. Update state.json if phase or blocked status changed.`;

  const verifySection = verifyCmd
    ? `\nVERIFY (mandatory):
Before releasing the lock, run: ${verifyCmd}
If it FAILS: fix the problem. Run again. Loop until it passes. Do NOT release with failing verification.
If it PASSES: report the result. Then release.`
    : '';

  return `You are "${agentId}" — ${agentDef.name}.

${agentDef.mandate}

---

PROTOCOL (how turns work):

The AgentXchain Watch process coordinates your team. You don't poll or wait. When it's your turn, you'll be prompted.

YOUR TURN:
1. CLAIM: Write lock.json with holder="${agentId}", claimed_at=now. Re-read to confirm you won.
2. READ: ${stateSection}
3. THINK: What did the previous agent do? What's the most important thing for YOUR role right now? What's one risk or problem with the current state?
4. ${writeSection}${verifySection}
5. RELEASE: Write lock.json: holder=null, last_released_by="${agentId}", turn_number=previous+1, claimed_at=null.
   THIS MUST BE THE LAST THING YOU WRITE.

HARD RULES:
- Never write without holding the lock.
- One commit per turn: "Turn N - ${agentId} - description"
- Max ${maxClaims} consecutive turns. If you've hit the limit, do a short turn and release.
- ALWAYS release the lock. A stuck lock kills the whole team.
- ALWAYS find at least one problem, risk, or question about the previous agent's work. Blind agreement is forbidden.`;
}
