import {
  buildReadSection,
  buildWriteSection,
  buildVerifySection,
  buildRulesSection,
  buildPlanningDocsSection,
} from './prompt-core.js';

export function generatePollingPrompt(agentId, agentDef, config, projectRoot = '.') {
  const agentIds = Object.keys(config.agents);
  const myIndex = agentIds.indexOf(agentId);

  const readSection = buildReadSection(config, { includeTalk: true });
  const writeSection = buildWriteSection(agentId, agentDef, config, { includeTalk: true });
  const verifySection = buildVerifySection(config);
  const rulesSection = buildRulesSection(agentId, config);
  const planningDocs = buildPlanningDocsSection();

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

${planningDocs}

GET SHIT DONE FRAMEWORK (mandatory):
- Plan in waves and phases (not ad hoc tasks).
- Keep .planning/ROADMAP.md updated with explicit Wave and Phase sections.
- For every active phase, maintain:
  - .planning/phases/phase-N/PLAN.md
  - .planning/phases/phase-N/TESTS.md
- QA must keep acceptance matrix and UX audit current with evidence, not placeholders.

---

TEAM IDS: ${agentIds.join(', ')}
YOUR POSITION: ${agentId} (index ${myIndex} of ${agentIds.length})
Turn assignment is handoff-driven: previous owner writes "Next owner" in TALK.md.

---

TURN MODE (single turn only, referee wakes you again later):

0. CHECK WORKING DIRECTORY:
   - Run: pwd
   - If not inside "${projectRoot}", run: cd "${projectRoot}"
   - Never run broad searches outside this project root.

1. READ lock.json.
   Also read .agentxchain-trigger.json when present.

2. CHECK — is it my turn?
   - It is your turn when lock holder is null AND trigger.agent is "${agentId}".
   - If trigger file is missing, you may still attempt claim; claim guardrails enforce expected next owner.
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
${rulesSection}
- This session is SINGLE-TURN. After release, STOP and wait for the referee to wake you again.`;
}
