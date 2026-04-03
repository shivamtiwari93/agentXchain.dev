import { describe, it, before, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { createServer } from 'node:http';
import { spawn, spawnSync, execSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import * as z from 'zod/v4';

import {
  initializeGovernedRun,
  assignGovernedTurn,
  acceptGovernedTurn,
  approvePhaseTransition,
  normalizeGovernedStateShape,
  getActiveTurn,
  STATE_PATH,
  HISTORY_PATH,
  STAGING_PATH,
} from '../src/lib/governed-state.js';
import { loadNormalizedConfig } from '../src/lib/normalized-config.js';
import { writeDispatchBundle } from '../src/lib/dispatch-bundle.js';
import { dispatchMcp } from '../src/lib/adapters/mcp-adapter.js';
import { validateStagedTurnResult } from '../src/lib/turn-result-validator.js';
import { getTurnStagingResultPath } from '../src/lib/turn-paths.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..', '..');
const CLI_BIN = join(__dirname, '..', 'bin', 'agentxchain.js');
const EXAMPLE_DIR = join(REPO_ROOT, 'examples', 'governed-todo-app');
const MCP_SERVER_PATH = join(REPO_ROOT, 'examples', 'mcp-echo-agent', 'server.js');

let tmpDirs = [];
let httpServers = [];

function makeTmpDir() {
  const dir = join(tmpdir(), `axc-mcp-example-${randomBytes(6).toString('hex')}`);
  tmpDirs.push(dir);
  return dir;
}

function readJson(root, relPath) {
  const parsed = JSON.parse(readFileSync(join(root, relPath), 'utf8'));
  if (relPath === STATE_PATH || relPath.endsWith('state.json')) {
    const normalized = normalizeGovernedStateShape(parsed).state;
    Object.defineProperty(normalized, 'current_turn', {
      configurable: true,
      enumerable: false,
      get() {
        return getActiveTurn(normalized);
      },
    });
    return normalized;
  }
  return parsed;
}

function readJsonl(root, relPath) {
  const content = readFileSync(join(root, relPath), 'utf8').trim();
  if (!content) return [];
  return content.split('\n').map((line) => JSON.parse(line));
}

function runCli(cwd, args) {
  const result = spawnSync(process.execPath, [CLI_BIN, ...args], {
    cwd,
    encoding: 'utf8',
    timeout: 20000,
  });
  return {
    exit_code: result.status,
    stdout: result.stdout || '',
    stderr: result.stderr || '',
    combined: (result.stdout || '') + (result.stderr || ''),
  };
}

function runCliAsync(cwd, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [CLI_BIN, ...args], {
      cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    let settled = false;

    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill('SIGKILL');
      resolve({
        exit_code: null,
        stdout,
        stderr,
        combined: stdout + stderr,
      });
    }, 20000);

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    child.on('error', (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      reject(error);
    });
    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolve({
        exit_code: code,
        stdout,
        stderr,
        combined: stdout + stderr,
      });
    });
  });
}

function writePmArtifacts(root) {
  mkdirSync(join(root, '.planning'), { recursive: true });
  writeFileSync(join(root, '.planning', 'PM_SIGNOFF.md'), '# PM Signoff\nApproved: YES\n');
  writeFileSync(join(root, '.planning', 'ROADMAP.md'), '# Roadmap\n## MVP Scope\nTodo app.\n');
}

function stageTurnResult(root, state, overrides = {}) {
  const turn = state.current_turn;
  const base = {
    schema_version: '1.0',
    run_id: state.run_id,
    turn_id: turn.turn_id,
    role: turn.assigned_role,
    runtime_id: turn.runtime_id,
    status: 'completed',
    summary: `Turn completed by ${turn.assigned_role}.`,
    decisions: [
      {
        id: 'DEC-001',
        category: 'implementation',
        statement: 'Planning artifacts prepared for phase transition.',
        rationale: 'Required to advance the governed example into implementation.',
      },
    ],
    objections: [
      {
        id: 'OBJ-001',
        severity: 'low',
        statement: 'The example planning artifact is minimal and should not be mistaken for a production spec.',
        status: 'raised',
      },
    ],
    files_changed: [],
    artifacts_created: [],
    verification: {
      status: 'skipped',
      commands: [],
      evidence_summary: 'Manual planning turn did not run automated verification.',
      machine_evidence: [],
    },
    artifact: { type: 'review', ref: '.planning/PM_SIGNOFF.md' },
    proposed_next_role: 'human',
    phase_transition_request: 'implementation',
    run_completion_request: null,
    needs_human_reason: null,
    cost: { input_tokens: 0, output_tokens: 0, usd: 0 },
  };

  const stagingFile = join(root, STAGING_PATH);
  mkdirSync(dirname(stagingFile), { recursive: true });
  writeFileSync(stagingFile, JSON.stringify({ ...base, ...overrides }, null, 2));
}

function createMcpExampleConfig(root) {
  const rawConfig = JSON.parse(readFileSync(join(root, 'agentxchain.json'), 'utf8'));
  rawConfig.runtimes['local-dev'] = {
    type: 'mcp',
    command: 'node',
    args: [MCP_SERVER_PATH],
    tool_name: 'agentxchain_turn',
  };
  writeFileSync(join(root, 'agentxchain.json'), JSON.stringify(rawConfig, null, 2));

  const normalized = loadNormalizedConfig(rawConfig);
  assert.ok(normalized.ok, `loadNormalizedConfig failed: ${normalized.errors?.join(', ')}`);
  return normalized.normalized;
}

function createRemoteMcpExampleConfig(root, url) {
  const rawConfig = JSON.parse(readFileSync(join(root, 'agentxchain.json'), 'utf8'));
  rawConfig.runtimes['local-dev'] = {
    type: 'mcp',
    transport: 'streamable_http',
    url,
    tool_name: 'agentxchain_turn',
    headers: {
      'x-agentxchain-project': 'governed-example',
    },
  };
  writeFileSync(join(root, 'agentxchain.json'), JSON.stringify(rawConfig, null, 2));

  const normalized = loadNormalizedConfig(rawConfig);
  assert.ok(normalized.ok, `loadNormalizedConfig failed: ${normalized.errors?.join(', ')}`);
  return normalized.normalized;
}

function gitCommitAll(root, message) {
  execSync('git add -A', { cwd: root, stdio: 'ignore' });
  execSync(`git -c user.name="test" -c user.email="test@test" commit -m "${message}" --allow-empty`, {
    cwd: root,
    stdio: 'ignore',
  });
}

function prepareImplementationReadyRepo() {
  const root = makeTmpDir();
  cpSync(EXAMPLE_DIR, root, { recursive: true });
  const config = createMcpExampleConfig(root);

  execSync('git init', { cwd: root, stdio: 'ignore' });
  gitCommitAll(root, 'initial');

  const initResult = initializeGovernedRun(root, config);
  assert.ok(initResult.ok, `initializeGovernedRun failed: ${initResult.error}`);

  const assignPm = assignGovernedTurn(root, config, 'pm');
  assert.ok(assignPm.ok, `assignGovernedTurn(pm) failed: ${assignPm.error}`);

  writePmArtifacts(root);
  gitCommitAll(root, 'add pm artifacts');

  stageTurnResult(root, readJson(root, STATE_PATH));

  const acceptPm = acceptGovernedTurn(root, config);
  assert.ok(acceptPm.ok, `acceptGovernedTurn(pm) failed: ${acceptPm.error}`);

  const approve = approvePhaseTransition(root);
  assert.ok(approve.ok, `approvePhaseTransition failed: ${approve.error}`);

  gitCommitAll(root, 'orchestrator: accept pm turn');

  return { root, config };
}

function prepareImplementationReadyRepoWithConfig(factory) {
  const root = makeTmpDir();
  cpSync(EXAMPLE_DIR, root, { recursive: true });
  const config = factory(root);

  execSync('git init', { cwd: root, stdio: 'ignore' });
  gitCommitAll(root, 'initial');

  const initResult = initializeGovernedRun(root, config);
  assert.ok(initResult.ok, `initializeGovernedRun failed: ${initResult.error}`);

  const assignPm = assignGovernedTurn(root, config, 'pm');
  assert.ok(assignPm.ok, `assignGovernedTurn(pm) failed: ${assignPm.error}`);

  writePmArtifacts(root);
  gitCommitAll(root, 'add pm artifacts');

  stageTurnResult(root, readJson(root, STATE_PATH));

  const acceptPm = acceptGovernedTurn(root, config);
  assert.ok(acceptPm.ok, `acceptGovernedTurn(pm) failed: ${acceptPm.error}`);

  const approve = approvePhaseTransition(root);
  assert.ok(approve.ok, `approvePhaseTransition failed: ${approve.error}`);

  gitCommitAll(root, 'orchestrator: accept pm turn');

  return { root, config };
}

function makeRemoteTurnResult(args) {
  return {
    schema_version: '1.0',
    run_id: args.run_id,
    turn_id: args.turn_id,
    role: args.role,
    runtime_id: args.runtime_id,
    status: 'completed',
    summary: `Turn completed by ${args.role}.`,
    decisions: [
      {
        id: 'DEC-001',
        category: 'implementation',
        statement: 'Remote MCP server returned a governed turn result.',
        rationale: 'Proves streamable_http MCP dispatch through the real CLI path.',
      },
    ],
    objections: [
      {
        id: 'OBJ-001',
        severity: 'low',
        statement: 'Remote MCP example remains a no-op implementation proof, not a real coding agent.',
        status: 'raised',
      },
    ],
    files_changed: [],
    artifacts_created: [],
    verification: {
      status: 'skipped',
      commands: [],
      evidence_summary: 'Example MCP server does not run automated verification.',
      machine_evidence: [],
    },
    artifact: { type: 'review', ref: '.planning/PM_SIGNOFF.md' },
    proposed_next_role: 'human',
    phase_transition_request: null,
    run_completion_request: null,
    needs_human_reason: null,
    cost: { input_tokens: 0, output_tokens: 0, usd: 0 },
  };
}

async function startStreamableHttpMcpServer() {
  const requests = [];
  const server = createServer(async (req, res) => {
    if (req.url !== '/mcp') {
      res.writeHead(404).end('not found');
      return;
    }

    if (req.method === 'GET') {
      res.writeHead(405, { 'content-type': 'application/json' });
      res.end(JSON.stringify({
        jsonrpc: '2.0',
        error: { code: -32000, message: 'Method not allowed.' },
        id: null,
      }));
      return;
    }

    const chunks = [];
    for await (const chunk of req) {
      chunks.push(chunk);
    }
    const bodyText = Buffer.concat(chunks).toString('utf8');
    const body = bodyText ? JSON.parse(bodyText) : undefined;
    requests.push({ method: req.method, headers: req.headers, body });

    const mcpServer = new McpServer({ name: 'axc-remote-example-server', version: '1.0.0' });
    mcpServer.registerTool('agentxchain_turn', {
      description: 'Execute a governed turn',
      inputSchema: {
        run_id: z.string(),
        turn_id: z.string(),
        role: z.string(),
        phase: z.string(),
        runtime_id: z.string(),
        project_root: z.string(),
        dispatch_dir: z.string(),
        assignment_path: z.string(),
        prompt_path: z.string(),
        context_path: z.string(),
        staging_path: z.string(),
        prompt: z.string(),
        context: z.string(),
      },
    }, async (args) => ({
      content: [{ type: 'text', text: 'ok' }],
      structuredContent: makeRemoteTurnResult(args),
    }));

    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
    });
    await mcpServer.connect(transport);
    res.on('close', () => {
      void transport.close();
      void mcpServer.close();
    });
    await transport.handleRequest(req, res, body);
  });

  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  httpServers.push(server);
  const address = server.address();
  return {
    url: `http://127.0.0.1:${address.port}/mcp`,
    requests,
  };
}

afterEach(async () => {
  for (const dir of tmpDirs) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {}
  }
  tmpDirs = [];
  for (const server of httpServers) {
    try {
      await new Promise((resolve) => server.close(resolve));
    } catch {}
  }
  httpServers = [];
});

describe('MCP governed example proof', () => {
  before(() => {
    const exampleNodeModules = join(dirname(MCP_SERVER_PATH), 'node_modules');
    if (!existsSync(exampleNodeModules)) {
      execSync('npm install --ignore-scripts', { cwd: dirname(MCP_SERVER_PATH), stdio: 'ignore' });
    }
  });

  it('dispatches the shipped echo server into a validator-clean staged result', async () => {
    const { root, config } = prepareImplementationReadyRepo();

    const assignDev = assignGovernedTurn(root, config, 'dev');
    assert.ok(assignDev.ok, `assignGovernedTurn(dev) failed: ${assignDev.error}`);

    const bundle = writeDispatchBundle(root, assignDev.state, config);
    assert.ok(bundle.ok, `writeDispatchBundle failed: ${bundle.error}`);

    const dispatch = await dispatchMcp(root, assignDev.state, config);
    assert.equal(dispatch.ok, true, dispatch.error);

    const turnId = assignDev.state.current_turn.turn_id;
    const validation = validateStagedTurnResult(root, readJson(root, STATE_PATH), config, {
      stagingPath: getTurnStagingResultPath(turnId),
    });

    assert.equal(validation.ok, true, validation.errors?.join('\n'));
    assert.equal(validation.turnResult.verification.status, 'skipped');
    assert.equal(validation.turnResult.artifact.type, 'review');
    assert.equal(validation.turnResult.proposed_next_role, 'human');
    assert.equal(validation.turnResult.objections.length, 1);
  });

  it('auto-accepts an MCP-backed dev turn through the real CLI step command', () => {
    const { root } = prepareImplementationReadyRepo();

    const result = runCli(root, ['step', '--role', 'dev']);
    assert.equal(result.exit_code, 0, result.combined);
    assert.match(result.combined, /MCP tool completed/i);
    assert.match(result.combined, /accepted/i);

    const state = readJson(root, STATE_PATH);
    const history = readJsonl(root, HISTORY_PATH);

    assert.equal(state.phase, 'implementation');
    assert.equal(state.status, 'active');
    assert.equal(state.current_turn, null);
    assert.equal(history.length, 2);
    assert.deepEqual(history.map((entry) => entry.role), ['pm', 'dev']);
    assert.equal(history[1].runtime_id, 'local-dev');
  });

  it('auto-accepts a streamable_http MCP-backed dev turn through the real CLI step command', async () => {
    const remote = await startStreamableHttpMcpServer();
    const { root } = prepareImplementationReadyRepoWithConfig((repoRoot) => createRemoteMcpExampleConfig(repoRoot, remote.url));

    const result = await runCliAsync(root, ['step', '--role', 'dev']);
    assert.equal(result.exit_code, 0, result.combined);
    assert.match(result.combined, /Dispatching to MCP streamable_http:/i);
    assert.match(result.combined, new RegExp(remote.url.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    assert.match(result.combined, /accepted/i);
    assert.ok(
      remote.requests.some((request) => request.headers['x-agentxchain-project'] === 'governed-example'),
      'streamable_http CLI step should forward configured MCP headers'
    );
  });

  it('documents the governed todo app MCP dev variant', () => {
    const readme = readFileSync(join(EXAMPLE_DIR, 'README.md'), 'utf8');

    assert.match(readme, /## MCP Dev Variant/);
    assert.match(readme, /"type": "mcp"/);
    assert.match(readme, /\.\.\/mcp-echo-agent\/server\.js/);
    assert.match(readme, /agentxchain step --role dev/);
  });
});
