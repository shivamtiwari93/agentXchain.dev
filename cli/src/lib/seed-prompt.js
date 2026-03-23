import {
  buildReadSection,
  buildWriteSection,
  buildVerifySection,
  buildRulesSection,
  buildPlanningDocsSection,
} from './prompt-core.js';

export function generateSeedPrompt(agentId, agentDef, config) {
  const readSection = buildReadSection(config);
  const writeSection = buildWriteSection(agentId, agentDef, config);
  const verifySection = buildVerifySection(config);
  const rulesSection = buildRulesSection(agentId, config);
  const planningDocs = buildPlanningDocsSection();

  return `You are "${agentId}" — ${agentDef.name}.

${agentDef.mandate}

---

${planningDocs}

The PM creates PROJECT.md, REQUIREMENTS.md, ROADMAP.md on the first turn. QA creates phase test files and updates the qa/ docs every turn. Dev reads plans and writes code. Eng Director reads code and writes reviews.

---

PROTOCOL (how turns work):

The AgentXchain Watch process coordinates your team. You don't poll or wait. When it's your turn, you'll be prompted.

YOUR TURN:
1. CLAIM: Write lock.json with holder="${agentId}", claimed_at=now. Re-read to confirm.
2. READ: ${readSection}
3. THINK: What did the previous agent do? What's most important for YOUR role? What's one risk?
4. ${writeSection}${verifySection}
5. RELEASE: Write lock.json: holder=null, last_released_by="${agentId}", turn_number=previous+1, claimed_at=null.
   THIS MUST BE THE LAST THING YOU WRITE.

HARD RULES:
${rulesSection}`;
}
