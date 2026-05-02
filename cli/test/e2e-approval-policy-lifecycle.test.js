import { describe, it } from 'vitest';
import assert from 'node:assert/strict';
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { execSync, spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { normalizeGovernedStateShape, getActiveTurn } from '../src/lib/governed-state.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI_BIN = join(__dirname, '..', 'bin', 'agentxchain.js');

function runCli(cwd, args) {
  const result = spawnSync(process.execPath, [CLI_BIN, ...args], {
    cwd,
    encoding: 'utf8',
    timeout: 20000,
    env: { ...process.env, NO_COLOR: '1', NODE_NO_WARNINGS: '1' },
  });
  return {
    status: result.status,
    stdout: result.stdout || '',
    stderr: result.stderr || '',
    combined: `${result.stdout || ''}${result.stderr || ''}`,
  };
}

function git(cwd, command) {
  execSync(command, { cwd, stdio: 'ignore' });
}

function initGitRepo(cwd, message) {
  git(cwd, 'git init');
  git(cwd, 'git config user.email "test@example.com"');
  git(cwd, 'git config user.name "Test User"');
  git(cwd, 'git add -A');
  git(cwd, `git commit -m "${message}"`);
}

function commitAll(cwd, message) {
  git(cwd, 'git add -A');
  git(cwd, `git commit -m "${message}" --allow-empty`);
}

function readState(cwd) {
  const raw = JSON.parse(readFileSync(join(cwd, '.agentxchain', 'state.json'), 'utf8'));
  const normalized = normalizeGovernedStateShape(raw).state;
  Object.defineProperty(normalized, 'current_turn', {
    configurable: true,
    enumerable: false,
    get() {
      return getActiveTurn(normalized);
    },
  });
  return normalized;
}

function readJsonl(cwd, relPath) {
  const raw = readFileSync(join(cwd, relPath), 'utf8').trim();
  if (!raw) return [];
  return raw.split('\n').filter(Boolean).map((line) => JSON.parse(line));
}

function writeApprovalPolicyConfig(cwd) {
  const configPath = join(cwd, 'agentxchain.json');
  const config = JSON.parse(readFileSync(configPath, 'utf8'));
  config.roles.dev.runtime = 'manual-dev';
  config.roles.qa.runtime = 'manual-qa';
  config.runtimes['manual-dev'] = { type: 'manual' };
  config.runtimes['manual-qa'] = { type: 'manual' };
  config.approval_policy = {
    phase_transitions: {
      default: 'require_human',
      rules: [
        {
          from_phase: 'planning',
          to_phase: 'implementation',
          action: 'auto_approve',
          when: { gate_passed: true },
        },
      ],
    },
    run_completion: {
      action: 'auto_approve',
      when: {
        gate_passed: true,
        all_phases_visited: true,
      },
    },
  };
  writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n');
}

function writePlanningArtifacts(cwd) {
  writeFileSync(
    join(cwd, '.planning', 'PM_SIGNOFF.md'),
    '# PM Planning Sign-Off\n\nApproved: YES\n',
  );
  writeFileSync(
    join(cwd, '.planning', 'ROADMAP.md'),
    '# Roadmap\n\n- Planning: complete\n- Implementation: pending\n- QA: pending\n',
  );
  writeFileSync(
    join(cwd, '.planning', 'SYSTEM_SPEC.md'),
    '# System Spec\n\n## Purpose\n\nBuild a governed CLI slice.\n\n## Interface\n\n- `shorten <url>`\n- `resolve <code>`\n- `list`\n\n## Behavior\n\nDeterministic short codes persisted in a repo-local JSON file.\n\n## Error Cases\n\nUnknown codes fail closed.\n\n## Acceptance Tests\n\n- [ ] shorten prints a code\n- [ ] resolve prints the original URL\n- [ ] list prints the mapping\n',
  );
}

function writeImplementationArtifacts(cwd) {
  mkdirSync(join(cwd, '.data'), { recursive: true });
  writeFileSync(
    join(cwd, 'store.js'),
    "import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';\nimport { dirname } from 'node:path';\n\nconst STORE_PATH = './.data/store.json';\n\nfunction readStore() {\n  if (!existsSync(STORE_PATH)) return { urls: {}, codes: {} };\n  return JSON.parse(readFileSync(STORE_PATH, 'utf8'));\n}\n\nfunction writeStore(store) {\n  mkdirSync(dirname(STORE_PATH), { recursive: true });\n  writeFileSync(STORE_PATH, JSON.stringify(store, null, 2) + '\\n');\n}\n\nfunction hashUrl(url) {\n  let hash = 0;\n  for (const ch of url) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;\n  return hash.toString(36).slice(0, 6).padEnd(6, '0');\n}\n\nexport function shorten(url) {\n  const store = readStore();\n  if (store.urls[url]) return store.urls[url];\n  const code = hashUrl(url);\n  store.urls[url] = code;\n  store.codes[code] = url;\n  writeStore(store);\n  return code;\n}\n\nexport function resolve(code) {\n  const store = readStore();\n  return store.codes[code] || null;\n}\n\nexport function listMappings() {\n  const store = readStore();\n  return Object.entries(store.codes);\n}\n",
  );
  writeFileSync(
    join(cwd, 'shorten.js'),
    "#!/usr/bin/env node\nimport { listMappings, resolve, shorten } from './store.js';\n\nconst [command, value] = process.argv.slice(2);\n\nif (command === 'shorten' && value) {\n  console.log(shorten(value));\n  process.exit(0);\n}\n\nif (command === 'resolve' && value) {\n  const url = resolve(value);\n  if (!url) {\n    console.error('Unknown code');\n    process.exit(1);\n  }\n  console.log(url);\n  process.exit(0);\n}\n\nif (command === 'list') {\n  for (const [code, url] of listMappings()) {\n    console.log(`${code} -> ${url}`);\n  }\n  process.exit(0);\n}\n\nconsole.error('Usage: node shorten.js <shorten|resolve|list> [value]');\nprocess.exit(1);\n",
  );
  writeFileSync(
    join(cwd, '.planning', 'IMPLEMENTATION_NOTES.md'),
    '# Implementation Notes\n\n## Changes\n- Added a deterministic shortener CLI\n- Added repo-local JSON persistence\n\n## Verification\n- `node shorten.js shorten https://example.com`\n- `node shorten.js resolve <code>`\n- `node shorten.js list`\n',
  );
}

function writeQaArtifacts(cwd, shortCode) {
  writeFileSync(
    join(cwd, '.planning', 'acceptance-matrix.md'),
    `# Acceptance Matrix\n\n| Req # | Criterion | Evidence | Status |\n|-------|-----------|----------|--------|\n| 1 | \`shorten <url>\` creates a short code | \`node shorten.js shorten https://example.com\` -> \`${shortCode}\` | PASS |\n| 2 | \`resolve <code>\` prints the original URL | \`node shorten.js resolve ${shortCode}\` -> \`https://example.com\` | PASS |\n| 3 | \`list\` prints all mappings | \`node shorten.js list\` -> \`${shortCode} -> https://example.com\` | PASS |\n| 4 | Store persists locally | \`./.data/store.json\` exists | PASS |\n`,
  );
  writeFileSync(
    join(cwd, '.planning', 'ship-verdict.md'),
    '# Ship Verdict\n\n## Verdict: YES\n\nAll acceptance criteria pass.\n',
  );
  writeFileSync(
    join(cwd, '.planning', 'RELEASE_NOTES.md'),
    '# Release Notes\n\n## User Impact\n\nGoverned CLI slice ships with shorten, resolve, and list.\n\n## Verification Summary\n\nQA verified shorten, resolve, list, persistence, and the acceptance matrix before requesting governed completion.\n',
  );
}

function stageTurnResult(cwd, turn, state, overrides = {}) {
  const result = {
    schema_version: '1.0',
    run_id: state.run_id,
    turn_id: turn.turn_id,
    role: turn.assigned_role,
    runtime_id: turn.runtime_id,
    status: 'completed',
    summary: `Completed ${turn.assigned_role} work.`,
    decisions: [
      {
        id: 'DEC-001',
        category: turn.assigned_role === 'qa' ? 'quality' : 'implementation',
        statement: `Advance the governed run through the ${turn.assigned_role} turn.`,
        rationale: 'Subprocess approval-policy proof.',
      },
    ],
    objections: turn.assigned_role === 'dev'
      ? []
      : [
          {
            id: `OBJ-${turn.assigned_role === 'pm' ? '001' : '002'}`,
            severity: 'low',
            statement: turn.assigned_role === 'pm'
              ? 'Keep the initial governed slice small and explicit.'
              : 'Manual QA passed, but automated regression coverage should follow.',
            status: 'raised',
          },
        ],
    files_changed: [],
    artifacts_created: [],
    verification: {
      status: 'pass',
      commands: [],
      evidence_summary: 'Fixture verification passed.',
      machine_evidence: [],
    },
    artifact: { type: turn.assigned_role === 'dev' ? 'workspace' : 'review', ref: null },
    proposed_next_role: 'human',
    phase_transition_request: null,
    run_completion_request: false,
    needs_human_reason: null,
    cost: { input_tokens: 0, output_tokens: 0, usd: 0 },
    ...overrides,
  };

  const stagingDir = join(cwd, '.agentxchain', 'staging', turn.turn_id);
  mkdirSync(stagingDir, { recursive: true });
  writeFileSync(join(stagingDir, 'turn-result.json'), JSON.stringify(result, null, 2) + '\n');
}

async function waitFor(check, timeoutMs = 10000, intervalMs = 100) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const value = check();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  throw new Error('Timed out waiting for condition');
}

function spawnStep(cwd) {
  const child = spawn(process.execPath, [CLI_BIN, 'step', '--poll', '1'], {
    cwd,
    env: { ...process.env, NO_COLOR: '1', NODE_NO_WARNINGS: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (chunk) => {
    stdout += chunk.toString();
  });
  child.stderr.on('data', (chunk) => {
    stderr += chunk.toString();
  });

  return {
    child,
    async waitForExit() {
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          child.kill('SIGKILL');
          reject(new Error(`step timed out\nstdout:\n${stdout}\nstderr:\n${stderr}`));
        }, 15000);
        child.on('error', reject);
        child.on('exit', (code) => {
          clearTimeout(timer);
          resolve({ code, stdout, stderr, combined: `${stdout}${stderr}` });
        });
      });
    },
  };
}

describe('CLI subprocess E2E — approval policy lifecycle', () => {
  it('AT-AP-013: auto-approves governed gates without manual approval commands and records matched rules', async () => {
    const root = mkdtempSync(join(tmpdir(), 'agentxchain-approval-policy-'));
    const projectDir = join(root, 'approval-policy-governed');

    try {
      mkdirSync(projectDir, { recursive: true });

      const init = runCli(projectDir, ['init', '--governed', '--template', 'cli-tool', '--dir', '.', '-y']);
      assert.equal(init.status, 0, init.combined);

      initGitRepo(projectDir, 'initial governed scaffold');
      writeApprovalPolicyConfig(projectDir);
      commitAll(projectDir, 'configure approval policy e2e fixture');

      const planningStep = spawnStep(projectDir);
      const planningState = await waitFor(() => {
        const state = readState(projectDir);
        return state.current_turn?.assigned_role === 'pm' ? state : null;
      });
      const planningTurn = planningState.current_turn;
      writePlanningArtifacts(projectDir);
      stageTurnResult(projectDir, planningTurn, planningState, {
        role: 'pm',
        runtime_id: 'manual-pm',
        summary: 'Planning artifacts complete; request implementation.',
        phase_transition_request: 'implementation',
        proposed_next_role: 'human',
      });
      const planningExit = await planningStep.waitForExit();
      assert.equal(planningExit.code, 0, planningExit.combined);
      assert.match(planningExit.combined, /Turn Accepted/);

      let state = readState(projectDir);
      assert.equal(state.phase, 'implementation', 'approval policy should auto-advance planning -> implementation');
      assert.equal(state.status, 'active', 'run must stay active after policy-approved transition');
      assert.ok(!state.pending_phase_transition, 'policy-approved transition must not leave pending approval');
      let ledger = readJsonl(projectDir, '.agentxchain/decision-ledger.jsonl').filter((entry) => entry.type === 'approval_policy');
      assert.equal(ledger.length, 1, 'phase transition should write one approval_policy ledger entry');
      assert.equal(ledger[0].gate_type, 'phase_transition');
      assert.equal(ledger[0].matched_rule?.from_phase, 'planning');
      assert.equal(ledger[0].matched_rule?.to_phase, 'implementation');
      assert.equal(ledger[0].matched_rule?.action, 'auto_approve');
      commitAll(projectDir, 'complete planning turn');

      const implementationStep = spawnStep(projectDir);
      const implementationState = await waitFor(() => {
        const current = readState(projectDir);
        return current.current_turn?.assigned_role === 'dev' ? current : null;
      });
      const implementationTurn = implementationState.current_turn;
      writeImplementationArtifacts(projectDir);
      const shortenRun = spawnSync(process.execPath, ['shorten.js', 'shorten', 'https://example.com'], {
        cwd: projectDir,
        encoding: 'utf8',
      });
      assert.equal(shortenRun.status, 0, `${shortenRun.stdout}${shortenRun.stderr}`);
      const shortCode = shortenRun.stdout.trim();
      stageTurnResult(projectDir, implementationTurn, implementationState, {
        role: 'dev',
        runtime_id: 'manual-dev',
        summary: 'Implemented shorten, resolve, and list commands.',
        files_changed: ['shorten.js', 'store.js', '.planning/IMPLEMENTATION_NOTES.md', '.data/store.json'],
        artifacts_created: ['.data/store.json'],
        verification: {
          status: 'pass',
          commands: [
            'node shorten.js shorten https://example.com',
            `node shorten.js resolve ${shortCode}`,
            'node shorten.js list',
          ],
          evidence_summary: 'shorten, resolve, and list all passed.',
          machine_evidence: [
            { command: 'node shorten.js shorten https://example.com', exit_code: 0, stdout_excerpt: shortCode },
            { command: `node shorten.js resolve ${shortCode}`, exit_code: 0, stdout_excerpt: 'https://example.com' },
            { command: 'node shorten.js list', exit_code: 0, stdout_excerpt: `${shortCode} -> https://example.com` },
          ],
        },
        proposed_next_role: 'qa',
        phase_transition_request: 'qa',
      });
      const implementationExit = await implementationStep.waitForExit();
      assert.equal(implementationExit.code, 0, implementationExit.combined);
      assert.match(implementationExit.combined, /Turn Accepted/);

      state = readState(projectDir);
      assert.equal(state.phase, 'qa');
      assert.equal(state.status, 'active');
      commitAll(projectDir, 'complete implementation turn');

      const qaStep = spawnStep(projectDir);
      const qaState = await waitFor(() => {
        const current = readState(projectDir);
        return current.current_turn?.assigned_role === 'qa' ? current : null;
      });
      const qaTurn = qaState.current_turn;
      writeQaArtifacts(projectDir, shortCode);
      stageTurnResult(projectDir, qaTurn, qaState, {
        role: 'qa',
        runtime_id: 'manual-qa',
        summary: 'QA passed and requests governed run completion.',
        run_completion_request: true,
        proposed_next_role: 'human',
      });
      const qaExit = await qaStep.waitForExit();
      assert.equal(qaExit.code, 0, qaExit.combined);
      assert.match(qaExit.combined, /Turn Accepted/);

      state = readState(projectDir);
      assert.equal(state.status, 'completed', 'approval policy should auto-complete the run');
      assert.ok(!state.pending_run_completion, 'policy-approved completion must not leave pending approval');
      ledger = readJsonl(projectDir, '.agentxchain/decision-ledger.jsonl').filter((entry) => entry.type === 'approval_policy');
      assert.equal(ledger.length, 2, 'run completion should append a second approval_policy ledger entry');
      assert.equal(ledger[1].gate_type, 'run_completion');
      assert.equal(ledger[1].matched_rule?.action, 'auto_approve');
      assert.equal(ledger[1].matched_rule?.when?.gate_passed, true);
      assert.equal(ledger[1].matched_rule?.when?.all_phases_visited, true);

      const history = readJsonl(projectDir, '.agentxchain/history.jsonl');
      assert.deepEqual(history.map((entry) => entry.role), ['pm', 'dev', 'qa']);

      const status = runCli(projectDir, ['status']);
      assert.equal(status.status, 0, status.combined);
      assert.match(status.combined, /completed/i);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
