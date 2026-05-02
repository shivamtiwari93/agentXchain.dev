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

function readHistory(cwd) {
  const raw = readFileSync(join(cwd, '.agentxchain', 'history.jsonl'), 'utf8').trim();
  if (!raw) return [];
  return raw.split('\n').filter(Boolean).map((line) => JSON.parse(line));
}

function writeManualTutorialConfig(cwd) {
  const configPath = join(cwd, 'agentxchain.json');
  const config = JSON.parse(readFileSync(configPath, 'utf8'));
  config.roles.dev.runtime = 'manual-dev';
  config.roles.qa.runtime = 'manual-qa';
  config.runtimes['manual-dev'] = { type: 'manual' };
  config.gates.planning_signoff = {
    ...config.gates.planning_signoff,
    credentialed: true,
  };
  config.gates.qa_ship_verdict = {
    ...config.gates.qa_ship_verdict,
    credentialed: true,
  };
  writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n');
}

function writePlanningArtifacts(cwd) {
  writeFileSync(
    join(cwd, '.planning', 'PM_SIGNOFF.md'),
    '# PM Planning Sign-Off\n\nApproved: YES\n\n## Scope\nBuild a URL shortener CLI tool with create, resolve, and list commands.\n\n## Acceptance Criteria\n1. `shorten <url>` creates a short code and prints it\n2. `resolve <code>` prints the original URL or an error\n3. `list` prints all stored mappings\n4. All operations persist to a local JSON file\n',
  );
  writeFileSync(
    join(cwd, '.planning', 'ROADMAP.md'),
    '# Roadmap\n\n| Phase | Goal | Status |\n|-------|------|--------|\n| Planning | Define scope, acceptance criteria, and technical constraints | In progress |\n| Implementation | Build the three CLI commands with JSON persistence | Pending |\n| QA | Verify all acceptance criteria against the implementation | Pending |\n\n## Deliverables\n- `shorten.js` — main CLI entry point\n- `store.js` — JSON persistence layer\n- `shorten.test.js` — acceptance tests\n',
  );
  writeFileSync(
    join(cwd, '.planning', 'SYSTEM_SPEC.md'),
    '# System Spec\n\n## Purpose\nBuild a URL shortener CLI tool that lets operators create, resolve, and list short links from the terminal.\n\n## Interface\n- `shorten <url>` -> stdout: `<code>`\n- `resolve <code>` -> stdout: `<original_url>` | stderr: `Unknown code`\n- `list` -> stdout: `<code> -> <url>` (one per line)\n\n## Behavior\n- Single-module Node.js CLI\n- JSON file storage at `./.data/store.json`\n- Short codes are deterministic per URL so repeated shorten requests reuse the same code\n\n## Error Cases\n- Invalid command prints usage and exits non-zero\n- Unknown code prints `Unknown code` and exits non-zero\n\n## Acceptance Tests\n- [ ] `node shorten.js shorten https://example.com` prints a short code\n- [ ] `node shorten.js resolve <code>` prints `https://example.com`\n- [ ] `node shorten.js list` prints `<code> -> https://example.com`\n- [ ] `./.data/store.json` exists after the first shorten operation\n\n## Constraints\n- No external dependencies beyond Node.js stdlib\n- Idempotent: shortening the same URL twice returns the same code\n',
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
    '# Implementation Notes\n\n## Changes\n- Created `shorten.js` with `shorten`, `resolve`, and `list` commands\n- Created `store.js` for JSON persistence at `./.data/store.json`\n- Short codes are deterministic per URL\n\n## Verification\n- `node shorten.js shorten https://example.com` prints a 6-character code\n- `node shorten.js resolve <code>` prints `https://example.com`\n- `node shorten.js list` prints `<code> -> https://example.com`\n\n## Technical Decisions\n- Used a deterministic stdlib-only hash for repeatable short codes\n- Stored mappings in a repo-local JSON file for a self-contained tutorial fixture\n',
  );
}

function writeQaArtifacts(cwd, code) {
  writeFileSync(
    join(cwd, '.planning', 'acceptance-matrix.md'),
    `# Acceptance Matrix\n\n| Req # | Criterion | Evidence | Status |\n|-------|-----------|----------|--------|\n| 1 | \`shorten <url>\` creates a short code | Manual test: \`node shorten.js shorten https://example.com\` -> \`${code}\` | PASS |\n| 2 | \`resolve <code>\` prints original URL | Manual test: \`node shorten.js resolve ${code}\` -> \`https://example.com\` | PASS |\n| 3 | \`list\` prints all mappings | Manual test: \`node shorten.js list\` -> \`${code} -> https://example.com\` | PASS |\n| 4 | Persists to local JSON | Verified \`./.data/store.json\` exists after shorten | PASS |\n`,
  );
  writeFileSync(
    join(cwd, '.planning', 'ship-verdict.md'),
    '# Ship Verdict\n\n## Verdict: YES\n\nAll 4 acceptance criteria pass. No blocking objections. Implementation matches spec.\n',
  );
  writeFileSync(
    join(cwd, '.planning', 'RELEASE_NOTES.md'),
    '# Release Notes — v0.1.0\n\n## User Impact\n\nOperators can now create, resolve, and list short links from a governed CLI workflow.\n\n## Verification Summary\n\nManual QA verified shorten, resolve, list, and persistence against the acceptance matrix.\n',
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
    summary: `Completed ${turn.assigned_role} tutorial work.`,
    decisions: [
      {
        id: 'DEC-001',
        category: turn.assigned_role === 'pm' ? 'scope' : turn.assigned_role === 'qa' ? 'quality' : 'implementation',
        statement: `Advance the manual tutorial walkthrough through the ${turn.assigned_role} turn.`,
        rationale: 'Keep the walkthrough aligned with a real governed lifecycle.',
      },
    ],
    objections: turn.assigned_role === 'dev'
      ? []
      : [
          {
            id: `OBJ-${turn.assigned_role === 'pm' ? '001' : '003'}`,
            severity: 'low',
            statement: turn.assigned_role === 'pm'
              ? 'Keep the first slice limited to the three core commands.'
              : 'Manual QA is acceptable for the walkthrough, but the next slice should add automated regression coverage.',
            status: 'raised',
          },
        ],
    files_changed: [],
    artifacts_created: [],
    verification: {
      status: turn.assigned_role === 'qa' ? 'pass' : 'pass',
      commands: [],
      evidence_summary: 'Tutorial walkthrough verification.',
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

describe('CLI subprocess E2E — tutorial walkthrough', () => {
  it('AT-TUTORIAL-010: proves the fully manual tutorial path end to end', async () => {
    const root = mkdtempSync(join(tmpdir(), 'agentxchain-tutorial-'));
    const projectDir = join(root, 'tutorial-governed');

    try {
      mkdirSync(projectDir, { recursive: true });

      const init = runCli(projectDir, ['init', '--governed', '--template', 'cli-tool', '--dir', '.', '-y']);
      assert.equal(init.status, 0, init.combined);

      initGitRepo(projectDir, 'initial governed scaffold');

      const validate = runCli(projectDir, ['template', 'validate']);
      assert.equal(validate.status, 0, validate.combined);

      writeManualTutorialConfig(projectDir);
      commitAll(projectDir, 'switch dev and qa to manual for tutorial');

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
        summary: 'Scoped URL shortener CLI tutorial slice.',
        phase_transition_request: 'implementation',
        proposed_next_role: 'human',
      });
      const planningExit = await planningStep.waitForExit();
      assert.equal(planningExit.code, 0, planningExit.combined);
      assert.match(planningExit.combined, /MANUAL TURN REQUIRED/);
      assert.match(planningExit.combined, /Staged result detected\./);
      assert.match(planningExit.combined, /Turn Accepted/);

      let state = readState(projectDir);
      assert.equal(state.status, 'paused');
      assert.equal(state.pending_phase_transition?.to, 'implementation');
      commitAll(projectDir, 'complete planning turn');

      const approvePlanning = runCli(projectDir, ['approve-transition']);
      assert.equal(approvePlanning.status, 0, approvePlanning.combined);
      state = readState(projectDir);
      assert.equal(state.phase, 'implementation');
      assert.equal(state.status, 'active');
      commitAll(projectDir, 'approve planning to implementation');

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
        summary: 'Implemented URL shortener commands with local JSON persistence.',
        files_changed: ['shorten.js', 'store.js', '.planning/IMPLEMENTATION_NOTES.md', '.data/store.json'],
        artifacts_created: ['.data/store.json'],
        verification: {
          status: 'pass',
          commands: [
            'node shorten.js shorten https://example.com',
            `node shorten.js resolve ${shortCode}`,
            'node shorten.js list',
          ],
          evidence_summary: 'shorten, resolve, and list commands all ran successfully.',
          machine_evidence: [
            { command: 'node shorten.js shorten https://example.com', exit_code: 0, stdout_excerpt: shortCode },
            { command: `node shorten.js resolve ${shortCode}`, exit_code: 0, stdout_excerpt: 'https://example.com' },
            { command: 'node shorten.js list', exit_code: 0, stdout_excerpt: `${shortCode} -> https://example.com` },
          ],
        },
        artifact: { type: 'workspace', ref: null },
        proposed_next_role: 'qa',
        phase_transition_request: 'qa',
      });
      const implementationExit = await implementationStep.waitForExit();
      assert.equal(implementationExit.code, 0, implementationExit.combined);
      assert.match(implementationExit.combined, /MANUAL TURN REQUIRED/);
      assert.match(implementationExit.combined, /Turn Accepted/);

      state = readState(projectDir);
      assert.equal(state.phase, 'qa', 'implementation must auto-advance to qa');
      assert.equal(state.status, 'active', 'implementation must not pause for human approval');
      assert.equal(state.pending_phase_transition, null, 'implementation -> qa should not leave a pending transition');
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
        summary: 'All four acceptance criteria pass. Ship verdict: YES.',
        run_completion_request: true,
        proposed_next_role: 'human',
      });
      const qaExit = await qaStep.waitForExit();
      assert.equal(qaExit.code, 0, qaExit.combined);
      assert.match(qaExit.combined, /MANUAL TURN REQUIRED/);
      assert.match(qaExit.combined, /Turn Accepted/);

      state = readState(projectDir);
      assert.notEqual(state.status, 'completed');
      assert.equal(state.pending_run_completion?.gate, 'qa_ship_verdict');
      commitAll(projectDir, 'complete qa turn');

      const approveCompletion = runCli(projectDir, ['approve-completion']);
      assert.equal(approveCompletion.status, 0, approveCompletion.combined);
      state = readState(projectDir);
      assert.equal(state.status, 'completed');
      assert.equal(state.pending_run_completion, null);
      commitAll(projectDir, 'approve governed completion');

      const status = runCli(projectDir, ['status']);
      assert.equal(status.status, 0, status.combined);
      assert.match(status.combined, /completed/i);

      const exported = runCli(projectDir, ['export', '--format', 'json']);
      assert.equal(exported.status, 0, exported.combined);
      const exportJson = JSON.parse(exported.stdout);
      assert.equal(exportJson.summary.run_id, state.run_id);
      writeFileSync(join(projectDir, 'governance-export.json'), JSON.stringify(exportJson, null, 2) + '\n');

      const report = runCli(projectDir, ['report', '--input', 'governance-export.json', '--format', 'markdown']);
      assert.equal(report.status, 0, report.combined);
      assert.match(report.combined, /completed/i);

      const history = readHistory(projectDir);
      assert.deepEqual(history.map((entry) => entry.role), ['pm', 'dev', 'qa']);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
