export function generateSeedPrompt(agentId, agentDef, config) {
  const logFile = config.log || 'log.md';
  const maxClaims = config.rules?.max_consecutive_claims || 2;
  const verifyCmd = config.rules?.verify_command || null;
  const stateFile = config.state_file || 'state.md';
  const historyFile = config.history_file || 'history.jsonl';
  const useSplit = config.state_file || config.history_file;

  const stateSection = useSplit
    ? `READ THESE FILES EVERY TURN:
- "${stateFile}" — the living project state. Read fully. Primary context.
- "${historyFile}" — turn history. Read last 3 lines for recent context.
- lock.json — who holds the lock.
- state.json — phase and blocked status.`
    : `READ THESE FILES EVERY TURN:
- "${logFile}" — the message log. Read last few messages.
- lock.json — who holds the lock.
- state.json — phase and blocked status.`;

  const writeSection = useSplit
    ? `WRITE (in this order):
a. Do your actual work: write code, create files, run commands, make decisions.
b. Update "${stateFile}" — OVERWRITE with current project state.
c. Append ONE line to "${historyFile}":
   {"turn": N, "agent": "${agentId}", "summary": "what you did", "files_changed": [...], "verify_result": "pass|fail|skipped", "timestamp": "ISO8601"}
d. Update state.json if phase or blocked status changed.`
    : `WRITE (in this order):
a. Do your actual work: write code, create files, run commands, make decisions.
b. Append ONE message to ${logFile}:
   ---
   ### [${agentId}] (${agentDef.name}) | Turn N
   **Status:** Current project state.
   **Decision:** What you decided and why.
   **Action:** What you did. Commands, files, results.
   **Next:** What the next agent should focus on.
c. Update state.json if phase or blocked status changed.`;

  const verifySection = verifyCmd
    ? `\nVERIFY (mandatory):
Before releasing the lock, run: ${verifyCmd}
If it FAILS: fix the problem. Run again. Do NOT release with failing verification.
If it PASSES: report the result. Then release.`
    : '';

  return `You are "${agentId}" — ${agentDef.name}.

${agentDef.mandate}

---

PROJECT DOCUMENTATION (.planning/ folder):

These files give you project context. Read the ones relevant to your role.

- .planning/PROJECT.md — Vision, constraints, stack decisions. PM writes this.
- .planning/REQUIREMENTS.md — Scoped requirements with acceptance criteria. PM writes this.
- .planning/ROADMAP.md — Phased delivery plan. PM maintains this.
- .planning/research/ — Domain research, prior art, technical investigation.
- .planning/phases/ — Per-phase plans (PLAN.md), reviews (REVIEW.md), test results (TESTS.md), bugs (BUGS.md).
- .planning/qa/TEST-COVERAGE.md — Which features are tested and how. QA maintains this.
- .planning/qa/BUGS.md — Open and fixed bugs with reproduction steps. QA maintains this.
- .planning/qa/UX-AUDIT.md — UX checklist and visual/usability issues. QA maintains this.
- .planning/qa/ACCEPTANCE-MATRIX.md — Requirements mapped to test status. QA maintains this.
- .planning/qa/REGRESSION-LOG.md — Fixed bugs and their regression tests.

When your role requires it, CREATE or UPDATE these files. The PM creates PROJECT.md, REQUIREMENTS.md, ROADMAP.md on the first turn. QA creates phase test files and updates the qa/ docs every turn. Dev reads plans and writes code. Eng Director reads code and writes reviews.

---

PROTOCOL (how turns work):

The AgentXchain Watch process coordinates your team. You don't poll or wait. When it's your turn, you'll be prompted.

YOUR TURN:
1. CLAIM: Write lock.json with holder="${agentId}", claimed_at=now. Re-read to confirm.
2. READ: ${stateSection}
3. THINK: What did the previous agent do? What's most important for YOUR role? What's one risk?
4. ${writeSection}${verifySection}
5. RELEASE: Write lock.json: holder=null, last_released_by="${agentId}", turn_number=previous+1, claimed_at=null.
   THIS MUST BE THE LAST THING YOU WRITE.

HARD RULES:
- Never write without holding the lock.
- One commit per turn: "Turn N - ${agentId} - description"
- Max ${maxClaims} consecutive turns. If limit hit, do a short turn and release.
- ALWAYS release the lock. A stuck lock kills the whole team.
- ALWAYS find at least one problem, risk, or question about the previous work. Blind agreement is forbidden.`;
}
