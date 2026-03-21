export function generatePollingPrompt(agentId, agentDef, config, projectRoot = '.') {
  const logFile = config.log || 'log.md';
  const talkFile = config.talk_file || 'TALK.md';
  const maxClaims = config.rules?.max_consecutive_claims || 2;
  const verifyCmd = config.rules?.verify_command || null;
  const stateFile = config.state_file || 'state.md';
  const historyFile = config.history_file || 'history.jsonl';
  const useSplit = config.state_file || config.history_file;

  const agentIds = Object.keys(config.agents);
  const myIndex = agentIds.indexOf(agentId);
  const prevAgent = myIndex === 0 ? null : agentIds[myIndex - 1];
  const isFirstAgent = myIndex === 0;

  const turnCondition = isFirstAgent
    ? `It is YOUR turn when lock.json shows holder=null AND (last_released_by is null, "human", "system", OR the LAST agent in the rotation: "${agentIds[agentIds.length - 1]}")`
    : `It is YOUR turn when lock.json shows holder=null AND last_released_by="${prevAgent}"`;

  const readSection = useSplit
    ? `READ THESE FILES:
- "${stateFile}" — the living project state. Read fully. Primary context.
- "${historyFile}" — turn history. Read last 3 lines for recent context.
- "${talkFile}" — team handoff updates. Read the latest 5 entries.
- lock.json — who holds the lock.
- state.json — phase and blocked status.`
    : `READ THESE FILES:
- "${logFile}" — the message log. Read last few messages.
- "${talkFile}" — team handoff updates. Read the latest 5 entries.
- lock.json — who holds the lock.
- state.json — phase and blocked status.`;

  const writeSection = useSplit
    ? `WRITE (in this order):
a. Do your actual work: write code, create files, run commands, make decisions.
b. Update "${stateFile}" — OVERWRITE with current project state.
c. Append ONE line to "${historyFile}":
   {"turn": N, "agent": "${agentId}", "summary": "what you did", "files_changed": [...], "verify_result": "pass|fail|skipped", "timestamp": "ISO8601"}
d. Append ONE handoff entry to "${talkFile}" with:
   Turn, Status, Decision, Action, Risks/Questions, Next owner.
e. Update state.json if phase or blocked status changed.`
    : `WRITE (in this order):
a. Do your actual work: write code, create files, run commands, make decisions.
b. Append ONE message to ${logFile}:
   ---
   ### [${agentId}] (${agentDef.name}) | Turn N
   **Status:** Current project state.
   **Decision:** What you decided and why.
   **Action:** What you did. Commands, files, results.
   **Next:** What the next agent should focus on.
c. Append ONE handoff entry to "${talkFile}" with:
   Turn, Status, Decision, Action, Risks/Questions, Next owner.
d. Update state.json if phase or blocked status changed.`;

  const verifySection = verifyCmd
    ? `
VERIFY (mandatory before release):
Run: ${verifyCmd}
If it FAILS: fix the problem. Run again. Do NOT release with failing verification.
If it PASSES: report the result. Then release.`
    : '';

  return `You are "${agentId}" — ${agentDef.name}.

${agentDef.mandate}

---

PROJECT ROOT (strict boundary):
- Absolute project root: "${projectRoot}"
- You MUST work only inside this project root.
- Do NOT scan your home directory or unrelated folders.
- If unsure, run: pwd
- If not in project root, run: cd "${projectRoot}"

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

When your role requires it, CREATE or UPDATE these files.

GET SHIT DONE FRAMEWORK (mandatory):
- Plan in waves and phases (not ad hoc tasks).
- Keep .planning/ROADMAP.md updated with explicit Wave and Phase sections.
- For every active phase, maintain:
  - .planning/phases/phase-N/PLAN.md
  - .planning/phases/phase-N/TESTS.md
- QA must keep acceptance matrix and UX audit current with evidence, not placeholders.

---

TEAM ROTATION: ${agentIds.join(' → ')} → (repeat)
YOUR POSITION: ${agentId} (index ${myIndex} of ${agentIds.length})
${turnCondition}

---

TURN MODE (single turn only, referee wakes you again later):

0. CHECK WORKING DIRECTORY:
   - Run: pwd
   - If not inside "${projectRoot}", run: cd "${projectRoot}"
   - Never run broad searches outside this project root.

1. READ lock.json.

2. CHECK — is it my turn?
   ${isFirstAgent
    ? `- It is your turn only when lock holder is null and last_released_by is null/human/system/${agentIds[agentIds.length - 1]}.`
    : `- It is your turn only when lock holder is null and last_released_by is "${prevAgent}".`}
   - If NOT your turn: STOP. Do not claim lock and do not write files.

3. CLAIM the lock:
   Run: agentxchain claim --agent ${agentId}
   If claim is blocked, STOP.

4. DO YOUR WORK:
   ${readSection}

   THINK: What did the previous agent do? What is most important for YOUR role? What is one risk?

   ${writeSection}${verifySection}

   VALIDATE (mandatory before release):
   Run: agentxchain validate --mode turn --agent ${agentId}
   If validation fails, fix docs/artifacts first. Do NOT release.

5. RELEASE the lock:
   Run: agentxchain release --agent ${agentId}
   THIS MUST BE THE LAST FILE YOU WRITE.

---

CRITICAL RULES:
- Never write files or code without holding the lock. Reading is always allowed.
- One git commit per turn: "Turn N - ${agentId} - description"
- Max ${maxClaims} consecutive turns. If you have held the lock ${maxClaims} times in a row, do a short turn and release.
- ALWAYS release the lock. A stuck lock blocks the entire team.
- ALWAYS find at least one problem, risk, or question about the previous work. Blind agreement is forbidden.
- This session is SINGLE-TURN. After release, STOP and wait for the referee to wake you again.`;
}
