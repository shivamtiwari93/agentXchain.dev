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
  writeFileSync(join(scriptsDir, 'agentxchain-hook-runtime.cjs'), buildHookRuntimeScript());
  writeFileSync(join(scriptsDir, 'agentxchain-session-start.sh'), SESSION_START_SCRIPT);
  writeFileSync(join(scriptsDir, 'agentxchain-stop.sh'), buildStopScript());
  writeFileSync(join(scriptsDir, 'agentxchain-pre-tool.sh'), PRE_TOOL_SCRIPT);

  try {
    chmodSync(join(scriptsDir, 'agentxchain-hook-runtime.cjs'), 0o755);
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

function buildHookRuntimeScript() {
  return `#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(path.join(process.cwd(), file), 'utf8'));
  } catch {
    return null;
  }
}

function splitCommand(input) {
  const out = [];
  let current = '';
  let quote = null;
  let escape = false;
  for (const char of String(input || '')) {
    if (escape) {
      current += char;
      escape = false;
      continue;
    }
    if (char === '\\\\') {
      escape = true;
      continue;
    }
    if (quote) {
      if (char === quote) {
        quote = null;
      } else {
        current += char;
      }
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (/\\s/.test(char)) {
      if (current) {
        out.push(current);
        current = '';
      }
      continue;
    }
    current += char;
  }
  if (current) out.push(current);
  return out;
}

function normalizeVerifyCommand(config) {
  const raw = config?.rules?.verify_command;
  if (Array.isArray(raw) && raw.every(part => typeof part === 'string' && part.length > 0)) {
    return raw;
  }
  if (typeof raw !== 'string' || !raw.trim()) return null;
  return splitCommand(raw.trim());
}

function normalizeAgentId(raw) {
  if (!raw) return null;
  let value = String(raw).trim();
  value = value.replace(/[\`*_]/g, '').trim();
  value = value.replace(/\\(.*?\\)/g, '').trim();
  value = value.split(/[\\s,]+/)[0];
  value = value.toLowerCase();
  return /^[a-z0-9_-]+$/.test(value) ? value : null;
}

function parseNextOwnerFromTalk(talkPath, validAgentIds) {
  try {
    const text = fs.readFileSync(path.join(process.cwd(), talkPath), 'utf8');
    const lines = text.split(/\\r?\\n/);
    for (let i = lines.length - 1; i >= 0; i -= 1) {
      const line = lines[i].trim();
      const match = line.match(/^(?:-|\\*)?\\s*\\**next\\s*owner\\**\\s*:\\s*(.+)$/i);
      if (!match) continue;
      const candidate = normalizeAgentId(match[1]);
      if (candidate && validAgentIds.includes(candidate)) return candidate;
    }
  } catch {}
  return null;
}

function resolveNextAgent(config, lock) {
  const agentIds = Object.keys(config?.agents || {});
  if (agentIds.length === 0) return null;
  const talkFile = config?.talk_file || 'TALK.md';
  const fromTalk = parseNextOwnerFromTalk(talkFile, agentIds);
  if (fromTalk) return fromTalk;
  const last = lock?.last_released_by;
  if (last && agentIds.includes(last)) {
    const idx = agentIds.indexOf(last);
    return agentIds[(idx + 1) % agentIds.length];
  }
  return agentIds[0];
}

function outputJson(value) {
  process.stdout.write(JSON.stringify(value));
}

const command = process.argv[2];
const config = readJson('agentxchain.json');
const lock = readJson('lock.json');
const state = readJson('state.json');

if (command === 'verify') {
  const verifyArgs = normalizeVerifyCommand(config);
  if (!verifyArgs || verifyArgs.length === 0) process.exit(0);
  const result = spawnSync(verifyArgs[0], verifyArgs.slice(1), { stdio: 'ignore', cwd: process.cwd() });
  process.exit(result.status === 0 ? 0 : 2);
}

if (command === 'next') {
  process.stdout.write(resolveNextAgent(config, lock) || '');
  process.exit(0);
}

if (command === 'next-name') {
  const next = resolveNextAgent(config, lock);
  process.stdout.write(next ? (config?.agents?.[next]?.name || next) : '');
  process.exit(0);
}

if (command === 'session-start') {
  if (!lock || !state) {
    outputJson({ continue: true });
    process.exit(0);
  }
  const context = \`AgentXchain context: Project=\${state.project || 'unknown'} | Phase=\${state.phase || 'unknown'} | Turn=\${lock.turn_number ?? 0} | Lock=\${lock.holder ?? 'none'} | Last released by=\${lock.last_released_by ?? 'none'} | Blocked=\${state.blocked ?? false}\`;
  outputJson({ hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: context } });
  process.exit(0);
}

outputJson({ continue: true });
`;
}

function buildStopScript() {
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
if [ -z "$HOLDER" ] || [ "$HOLDER" = "null" ]; then
  node "./scripts/agentxchain-hook-runtime.cjs" verify >/dev/null 2>&1
  VERIFY_STATUS=$?
  if [ "$VERIFY_STATUS" -eq 2 ]; then
    echo '{"hookSpecificOutput":{"hookEventName":"Stop","decision":"block","reason":"Verification failed. Fix the issue and release the lock."}}'
    exit 0
  fi
fi

if [ -z "$HOLDER" ] || [ "$HOLDER" = "null" ]; then
  if [ ! -f "agentxchain.json" ]; then
    echo '{"continue":true}'
    exit 0
  fi

  NEXT=$(node "./scripts/agentxchain-hook-runtime.cjs" next 2>/dev/null)
  if [ -z "$NEXT" ]; then
    echo '{"continue":true}'
    exit 0
  fi

  NEXT_NAME=$(node "./scripts/agentxchain-hook-runtime.cjs" next-name 2>/dev/null)

  echo "{\\"hookSpecificOutput\\":{\\"hookEventName\\":\\"Stop\\",\\"decision\\":\\"block\\",\\"reason\\":\\"Turn $TURN complete. Next agent: $NEXT ($NEXT_NAME). Read lock.json, claim it, and do your work.\\"}}"
elif [ "$HOLDER" = "human" ]; then
  echo '{"continue":true}'
else
  echo '{"continue":true}'
fi
`;
}

const SESSION_START_SCRIPT = `#!/bin/bash
CONTEXT_JSON=$(node "./scripts/agentxchain-hook-runtime.cjs" session-start 2>/dev/null || echo '{"continue":true}')
printf '%s\n' "$CONTEXT_JSON"
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
