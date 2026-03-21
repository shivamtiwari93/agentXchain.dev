import { writeFileSync, mkdirSync, existsSync, readFileSync, chmodSync } from 'fs';
import { join } from 'path';
import { generateSeedPrompt } from './seed-prompt.js';

export function generateVSCodeFiles(dir, config) {
  const agentsDir = join(dir, '.github', 'agents');
  const hooksDir = join(dir, '.github', 'hooks');
  const scriptsDir = join(dir, 'scripts');

  mkdirSync(agentsDir, { recursive: true });
  mkdirSync(hooksDir, { recursive: true });
  mkdirSync(scriptsDir, { recursive: true });

  const agentIds = Object.keys(config.agents);

  for (const id of agentIds) {
    const agent = config.agents[id];
    const md = buildAgentMd(id, agent, config, agentIds, dir);
    writeFileSync(join(agentsDir, `${id}.agent.md`), md);
  }

  writeFileSync(join(hooksDir, 'agentxchain.json'), buildHooksJson());
  writeFileSync(join(scriptsDir, 'agentxchain-session-start.sh'), SESSION_START_SCRIPT);
  writeFileSync(join(scriptsDir, 'agentxchain-stop.sh'), buildStopScript(config));
  writeFileSync(join(scriptsDir, 'agentxchain-pre-tool.sh'), PRE_TOOL_SCRIPT);

  try {
    chmodSync(join(scriptsDir, 'agentxchain-session-start.sh'), 0o755);
    chmodSync(join(scriptsDir, 'agentxchain-stop.sh'), 0o755);
    chmodSync(join(scriptsDir, 'agentxchain-pre-tool.sh'), 0o755);
  } catch {}

  return { agentsDir, hooksDir, scriptsDir, agentCount: agentIds.length };
}

function buildAgentMd(agentId, agentDef, config, allAgentIds, projectRoot) {
  const otherAgents = allAgentIds.filter(id => id !== agentId);
  const verifyCmd = config.rules?.verify_command || null;
  const maxClaims = config.rules?.max_consecutive_claims || 2;
  const stateFile = config.state_file || 'state.md';
  const historyFile = config.history_file || 'history.jsonl';
  const logFile = config.log || 'log.md';
  const talkFile = config.talk_file || 'TALK.md';
  const useSplit = config.state_file || config.history_file;

  const handoffs = otherAgents.map(otherId => {
    const other = config.agents[otherId];
    return `  - label: "Hand off to ${other.name}"
    agent: ${otherId}
    prompt: "Previous agent finished. Read lock.json, claim it, and do your work as ${other.name}."
    send: true`;
  });

  handoffs.push(`  - label: "Request Human Review"
    agent: agent
    prompt: "An agent requests human review. Check HUMAN_TASKS.md and lock.json."
    send: false`);

  const toolsList = "['search', 'fetch', 'editFiles', 'terminalLastCommand', 'codebase', 'usages']";

  const frontmatter = `---
name: "${agentDef.name}"
description: "${escapeYaml(agentDef.mandate.split('\n')[0].slice(0, 120))}"
tools: ${toolsList}
model: ['claude-sonnet-4-5-20250514', 'gpt-4.1']
handoffs:
${handoffs.join('\n')}
hooks:
  Stop:
    - type: command
      command: "./scripts/agentxchain-stop.sh"
  SessionStart:
    - type: command
      command: "./scripts/agentxchain-session-start.sh"
---`;

  const readInstructions = useSplit
    ? `Read these files at the start of your turn:
- \`${stateFile}\` — living project state (primary context)
- \`${historyFile}\` — last 3 lines for recent turns
- \`${talkFile}\` — team handoff updates (read latest entries)
- \`lock.json\` — current lock holder
- \`state.json\` — phase and blocked status`
    : `Read these files at the start of your turn:
- \`${logFile}\` — message log (read last few messages)
- \`${talkFile}\` — team handoff updates (read latest entries)
- \`lock.json\` — current lock holder
- \`state.json\` — phase and blocked status`;

  const writeInstructions = useSplit
    ? `When you finish your work, write in this order:
1. Your actual work: code, files, commands, decisions.
2. Overwrite \`${stateFile}\` with current project state.
3. Append one line to \`${historyFile}\`:
   \`{"turn": N, "agent": "${agentId}", "summary": "...", "files_changed": [...], "verify_result": "pass|fail|skipped", "timestamp": "ISO8601"}\`
4. Append one handoff entry to \`${talkFile}\` with: Turn, Status, Decision, Action, Risks/Questions, Next owner.
5. Update \`state.json\` if phase or blocked status changed.`
    : `When you finish your work, write in this order:
1. Your actual work: code, files, commands, decisions.
2. Append one message to \`${logFile}\`:
   \`### [${agentId}] (${agentDef.name}) | Turn N\`
   with Status, Decision, Action, Next sections.
3. Append one handoff entry to \`${talkFile}\` with: Turn, Status, Decision, Action, Risks/Questions, Next owner.
4. Update \`state.json\` if phase or blocked status changed.`;

  const verifyInstructions = verifyCmd
    ? `\n## Verify before release\nBefore releasing the lock, run: \`${verifyCmd}\`\nIf it fails, fix the problem and run again. Do NOT release with a failing verification.`
    : '';

  const body = `# ${agentDef.name}

You are "${agentId}" on an AgentXchain team.

${agentDef.mandate}

---

## Project boundary

- Project root: \`${projectRoot}\`
- Work only inside this project folder.
- Never scan unrelated local directories.
- Start your turn by checking \`pwd\`.

---

## Project documentation

Read the files relevant to your role in the \`.planning/\` folder:
- \`.planning/PROJECT.md\` — Vision, constraints, stack (PM writes)
- \`.planning/REQUIREMENTS.md\` — Requirements with acceptance criteria (PM writes)
- \`.planning/ROADMAP.md\` — Phased delivery plan (PM maintains)
- \`.planning/research/\` — Domain research
- \`.planning/phases/\` — Per-phase plans, reviews, tests, bugs
- \`.planning/qa/\` — TEST-COVERAGE, BUGS, UX-AUDIT, ACCEPTANCE-MATRIX, REGRESSION-LOG (QA maintains)

Create or update these files when your role requires it.

---

## Your turn

The AgentXchain system coordinates turns. When prompted, do this:

1. **CLAIM**: Run \`agentxchain claim --agent ${agentId}\`. If blocked, stop.
2. **READ**: ${readInstructions}
3. **THINK**: What did the previous agent do? What is most important for YOUR role? What is one risk?
4. **WORK**: ${writeInstructions}${verifyInstructions}
5. **RELEASE**: Run \`agentxchain release --agent ${agentId}\`.
   This MUST be the last thing you write.
6. **STOP**: End your turn. The referee will wake the next agent.

---

## Rules

- Never write files without holding the lock.
- One git commit per turn: "Turn N - ${agentId} - description"
- Max ${maxClaims} consecutive turns. If limit hit, do a short turn and release.
- ALWAYS release the lock. A stuck lock blocks the entire team.
- ALWAYS find at least one problem, risk, or question about the previous work. Blind agreement is forbidden.
`;

  return frontmatter + '\n\n' + body;
}

function escapeYaml(str) {
  return str.replace(/"/g, '\\"').replace(/\n/g, ' ');
}

function buildHooksJson() {
  const hooks = {
    hooks: {
      SessionStart: [
        {
          type: 'command',
          command: './scripts/agentxchain-session-start.sh'
        }
      ],
      Stop: [
        {
          type: 'command',
          command: './scripts/agentxchain-stop.sh'
        }
      ]
    }
  };
  return JSON.stringify(hooks, null, 2) + '\n';
}

function buildStopScript(config) {
  const verifyCmd = config.rules?.verify_command || '';
  const verifyBlock = verifyCmd
    ? `
# Run verify command before allowing release
if [ -z "$HOLDER" ] || [ "$HOLDER" = "null" ]; then
  VERIFY_CMD="${verifyCmd}"
  if [ -n "$VERIFY_CMD" ]; then
    if ! eval "$VERIFY_CMD" > /dev/null 2>&1; then
      echo '{"hookSpecificOutput":{"hookEventName":"Stop","decision":"block","reason":"Verification failed: '"$VERIFY_CMD"'. Fix the issue and release the lock."}}'
      exit 0
    fi
  fi
fi
`
    : '';

  return `#!/bin/bash
INPUT=$(cat)
STOP_HOOK_ACTIVE=$(echo "$INPUT" | jq -r '.stop_hook_active // false')

if [ "$STOP_HOOK_ACTIVE" = "true" ]; then
  echo '{"continue":true}'
  exit 0
fi

if [ ! -f "lock.json" ]; then
  echo '{"continue":true}'
  exit 0
fi

LOCK=$(cat lock.json 2>/dev/null)
HOLDER=$(echo "$LOCK" | jq -r '.holder // empty')
TURN=$(echo "$LOCK" | jq -r '.turn_number // 0')
${verifyBlock}
if [ -z "$HOLDER" ] || [ "$HOLDER" = "null" ]; then
  LAST=$(echo "$LOCK" | jq -r '.last_released_by // empty')

  if [ ! -f "agentxchain.json" ]; then
    echo '{"continue":true}'
    exit 0
  fi

  NEXT=$(node -e "
    const cfg = JSON.parse(require('fs').readFileSync('agentxchain.json','utf8'));
    const ids = Object.keys(cfg.agents);
    const last = process.argv[1] || '';
    const idx = ids.indexOf(last);
    const next = ids[(idx + 1) % ids.length];
    process.stdout.write(next);
  " -- "$LAST" 2>/dev/null)

  if [ -z "$NEXT" ]; then
    echo '{"continue":true}'
    exit 0
  fi

  NEXT_NAME=$(node -e "
    const cfg = JSON.parse(require('fs').readFileSync('agentxchain.json','utf8'));
    const a = cfg.agents[process.argv[1]];
    process.stdout.write(a ? a.name : process.argv[1]);
  " -- "$NEXT" 2>/dev/null)

  echo "{\\"hookSpecificOutput\\":{\\"hookEventName\\":\\"Stop\\",\\"decision\\":\\"block\\",\\"reason\\":\\"Turn $TURN complete. Next agent: $NEXT ($NEXT_NAME). Read lock.json, claim it, and do your work.\\"}}"
elif [ "$HOLDER" = "human" ]; then
  echo '{"continue":true}'
else
  echo '{"continue":true}'
fi
`;
}

const SESSION_START_SCRIPT = `#!/bin/bash
if [ ! -f "lock.json" ] || [ ! -f "state.json" ]; then
  echo '{"continue":true}'
  exit 0
fi

LOCK=$(cat lock.json 2>/dev/null)
STATE=$(cat state.json 2>/dev/null)

HOLDER=$(echo "$LOCK" | jq -r '.holder // "none"')
TURN=$(echo "$LOCK" | jq -r '.turn_number // 0')
LAST=$(echo "$LOCK" | jq -r '.last_released_by // "none"')
PHASE=$(echo "$STATE" | jq -r '.phase // "unknown"')
BLOCKED=$(echo "$STATE" | jq -r '.blocked // false')
PROJECT=$(echo "$STATE" | jq -r '.project // "unknown"')

CONTEXT="AgentXchain context: Project=$PROJECT | Phase=$PHASE | Turn=$TURN | Lock=$HOLDER | Last released by=$LAST | Blocked=$BLOCKED"

echo "{\\"hookSpecificOutput\\":{\\"hookEventName\\":\\"SessionStart\\",\\"additionalContext\\":\\"$CONTEXT\\"}}"
`;

const PRE_TOOL_SCRIPT = `#!/bin/bash
INPUT=$(cat)
TOOL_NAME=$(echo "$INPUT" | jq -r '.tool_name // empty')

WRITE_TOOLS="editFiles|createFile|create_file|replace_string_in_file|deleteFile"

if echo "$TOOL_NAME" | grep -qE "^($WRITE_TOOLS)\$"; then
  if [ -f "lock.json" ]; then
    HOLDER=$(cat lock.json | jq -r '.holder // empty')
    if [ -z "$HOLDER" ] || [ "$HOLDER" = "null" ]; then
      echo '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"You must claim lock.json before writing files. Write holder=your_agent_id first."}}'
      exit 0
    fi
  fi
fi

echo '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"allow"}}'
`;
