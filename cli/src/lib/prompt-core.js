/**
 * Shared prompt building blocks used by seed-prompt.js, seed-prompt-polling.js,
 * and generate-vscode.js. Single source of truth for protocol rules expressed
 * in prompts.
 */

export function buildReadSection(config, opts = {}) {
  const stateFile = config.state_file || 'state.md';
  const historyFile = config.history_file || 'history.jsonl';
  const logFile = config.log || 'log.md';
  const talkFile = config.talk_file || 'TALK.md';
  const useSplit = config.state_file || config.history_file;

  if (useSplit) {
    const lines = [
      `"${stateFile}" — the living project state. Read fully. Primary context.`,
      `"${historyFile}" — turn history. Read last 3 lines for recent context.`,
    ];
    if (opts.includeTalk) lines.push(`"${talkFile}" — team handoff updates. Read the latest 5 entries.`);
    lines.push('lock.json — who holds the lock.');
    lines.push('state.json — phase and blocked status.');
    return `READ THESE FILES EVERY TURN:\n${lines.map(l => `- ${l}`).join('\n')}`;
  }

  const lines = [
    `"${logFile}" — the message log. Read last few messages.`,
  ];
  if (opts.includeTalk) lines.push(`"${talkFile}" — team handoff updates. Read the latest 5 entries.`);
  lines.push('lock.json — who holds the lock.');
  lines.push('state.json — phase and blocked status.');
  return `READ THESE FILES EVERY TURN:\n${lines.map(l => `- ${l}`).join('\n')}`;
}

export function buildWriteSection(agentId, agentDef, config, opts = {}) {
  const stateFile = config.state_file || 'state.md';
  const historyFile = config.history_file || 'history.jsonl';
  const logFile = config.log || 'log.md';
  const talkFile = config.talk_file || 'TALK.md';
  const useSplit = config.state_file || config.history_file;
  const agentIds = Object.keys(config.agents);

  const steps = ['a. Do your actual work: write code, create files, run commands, make decisions.'];

  if (useSplit) {
    steps.push(`b. Update "${stateFile}" — OVERWRITE with current project state.`);
    steps.push(`c. Append ONE line to "${historyFile}":\n   {"turn": N, "agent": "${agentId}", "summary": "what you did", "files_changed": [...], "verify_result": "pass|fail|skipped", "timestamp": "ISO8601"}`);
    if (opts.includeTalk) {
      steps.push(`d. Append ONE handoff entry to "${talkFile}" with:\n   Turn, Status, Decision, Action, Risks/Questions, Next owner.\n   IMPORTANT: "Next owner" must be a valid agent id from [${agentIds.join(', ')}].`);
      steps.push('e. Update state.json if phase or blocked status changed.');
    } else {
      steps.push('d. Update state.json if phase or blocked status changed.');
    }
  } else {
    steps.push(
      `b. Append ONE message to ${logFile}:\n` +
      `   ---\n` +
      `   ### [${agentId}] (${agentDef.name}) | Turn N\n` +
      `   **Status:** Current project state.\n` +
      `   **Decision:** What you decided and why.\n` +
      `   **Action:** What you did. Commands, files, results.\n` +
      `   **Next:** What the next agent should focus on.`
    );
    if (opts.includeTalk) {
      steps.push(`c. Append ONE handoff entry to "${talkFile}" with:\n   Turn, Status, Decision, Action, Risks/Questions, Next owner.\n   IMPORTANT: "Next owner" must be a valid agent id from [${agentIds.join(', ')}].`);
      steps.push('d. Update state.json if phase or blocked status changed.');
    } else {
      steps.push('c. Update state.json if phase or blocked status changed.');
    }
  }

  return `WRITE (in this order):\n${steps.join('\n')}`;
}

export function buildVerifySection(config) {
  const verifyCmd = config.rules?.verify_command || null;
  if (!verifyCmd) return '';
  return `\nVERIFY (mandatory before release):\nRun: ${verifyCmd}\nIf it FAILS: fix the problem. Run again. Do NOT release with failing verification.\nIf it PASSES: report the result. Then release.`;
}

export function buildRulesSection(agentId, config) {
  const maxClaims = config.rules?.max_consecutive_claims || 2;
  return [
    '- Never write files or code without holding the lock. Reading is always allowed.',
    `- One git commit per turn: "Turn N - ${agentId} - description"`,
    `- Max ${maxClaims} consecutive turns. If you have held the lock ${maxClaims} times in a row, do a short turn and release.`,
    '- ALWAYS release the lock. A stuck lock blocks the entire team.',
    '- ALWAYS find at least one problem, risk, or question about the previous work. Blind agreement is forbidden.',
  ].join('\n');
}

export function buildPlanningDocsSection() {
  return `PROJECT DOCUMENTATION (.planning/ folder):

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

When your role requires it, CREATE or UPDATE these files.`;
}
