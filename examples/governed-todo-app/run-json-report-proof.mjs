#!/usr/bin/env node

/**
 * Governed Todo App — Built-In JSON Report Proof
 *
 * Proves the built-in `json-report` plugin can be installed by short name
 * and will emit structured report artifacts during a real governed run.
 *
 * Usage:
 *   node examples/governed-todo-app/run-json-report-proof.mjs [--json]
 *
 * Environment:
 *   ANTHROPIC_API_KEY — required for api_proxy dispatch
 */

import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { randomBytes, createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const jsonMode = process.argv.includes('--json');
const repoRoot = join(__dirname, '..', '..');
const cliRoot = join(repoRoot, 'cli');
const binPath = join(cliRoot, 'bin', 'agentxchain.js');
const cliPkg = JSON.parse(readFileSync(join(cliRoot, 'package.json'), 'utf8'));

const HAIKU_MODEL = 'claude-haiku-4-5-20251001';
const MAX_TURNS = 12;
const MAX_ATTEMPTS = 3;

function makeConfig() {
  return {
    schema_version: 4,
    protocol_mode: 'governed',
    project: {
      id: `governed-todo-plugin-${randomBytes(4).toString('hex')}`,
      name: 'Governed Todo App — Built-In JSON Report Proof',
      description: 'Prove built-in json-report plugin execution during a governed todo-app run.',
      default_branch: 'main',
    },
    roles: {
      pm: {
        title: 'Product Manager',
        mandate: 'Produce a one-paragraph delivery plan with acceptance criteria for a todo app, then set phase_transition_request to "implementation".',
        write_authority: 'review_only',
        runtime: 'api-pm',
        runtime_class: 'api_proxy',
        runtime_id: 'api-pm',
      },
      dev: {
        title: 'Developer',
        mandate: 'Describe how to implement the todo app with Node.js HTTP endpoints for add, list, complete, and delete, then set phase_transition_request to "qa".',
        write_authority: 'review_only',
        runtime: 'api-dev',
        runtime_class: 'api_proxy',
        runtime_id: 'api-dev',
      },
      qa: {
        title: 'QA',
        mandate: 'Review the implementation plan, raise one testing observation, and set run_completion_request to true.',
        write_authority: 'review_only',
        runtime: 'api-qa',
        runtime_class: 'api_proxy',
        runtime_id: 'api-qa',
      },
      eng_director: {
        title: 'Engineering Director',
        mandate: 'Resolve tactical deadlocks only if the run gets stuck.',
        write_authority: 'review_only',
        runtime: 'api-director',
        runtime_class: 'api_proxy',
        runtime_id: 'api-director',
      },
    },
    runtimes: {
      'api-pm': {
        type: 'api_proxy',
        provider: 'anthropic',
        model: HAIKU_MODEL,
        auth_env: 'ANTHROPIC_API_KEY',
        max_output_tokens: 4096,
        timeout_seconds: 90,
      },
      'api-dev': {
        type: 'api_proxy',
        provider: 'anthropic',
        model: HAIKU_MODEL,
        auth_env: 'ANTHROPIC_API_KEY',
        max_output_tokens: 4096,
        timeout_seconds: 90,
      },
      'api-qa': {
        type: 'api_proxy',
        provider: 'anthropic',
        model: HAIKU_MODEL,
        auth_env: 'ANTHROPIC_API_KEY',
        max_output_tokens: 4096,
        timeout_seconds: 90,
      },
      'api-director': {
        type: 'api_proxy',
        provider: 'anthropic',
        model: HAIKU_MODEL,
        auth_env: 'ANTHROPIC_API_KEY',
        max_output_tokens: 4096,
        timeout_seconds: 90,
      },
    },
    routing: {
      planning: {
        entry_role: 'pm',
        allowed_next_roles: ['pm', 'dev', 'eng_director', 'human'],
        exit_gate: 'planning_signoff',
      },
      implementation: {
        entry_role: 'dev',
        allowed_next_roles: ['dev', 'qa', 'eng_director', 'human'],
        exit_gate: 'implementation_complete',
      },
      qa: {
        entry_role: 'qa',
        allowed_next_roles: ['dev', 'qa', 'eng_director', 'human'],
        exit_gate: 'qa_ship_verdict',
      },
    },
    gates: {
      // Force real gate approvals so the built-in plugin proves both
      // after_acceptance and before_gate hook execution paths.
      planning_signoff: { requires_human_approval: true },
      implementation_complete: { requires_human_approval: true },
      qa_ship_verdict: { requires_human_approval: true },
    },
    budget: { per_turn_max_usd: 1.0, per_run_max_usd: 5.0 },
    rules: { challenge_required: false, max_turn_retries: 3, max_deadlock_cycles: 2 },
    workflow_kit: {},
    files: {
      talk: 'TALK.md',
      history: '.agentxchain/history.jsonl',
      state: '.agentxchain/state.json',
    },
    compat: {
      next_owner_source: 'state-json',
      lock_based_coordination: false,
      original_version: 4,
    },
  };
}

function gitInit(root) {
  const opts = { cwd: root, stdio: 'ignore' };
  spawnSync('git', ['init'], opts);
  spawnSync('git', ['config', 'user.name', 'AgentXchain JSON Report Proof'], opts);
  spawnSync('git', ['config', 'user.email', 'agentxchain-proof@example.invalid'], opts);
  spawnSync('git', ['add', '-A'], opts);
  spawnSync('git', ['commit', '--allow-empty', '-m', 'scaffold'], opts);
}

function scaffoldProject(root) {
  const config = makeConfig();

  mkdirSync(join(root, '.agentxchain', 'prompts'), { recursive: true });
  mkdirSync(join(root, '.planning'), { recursive: true });

  writeFileSync(join(root, 'agentxchain.json'), JSON.stringify(config, null, 2));
  writeFileSync(
    join(root, '.agentxchain', 'state.json'),
    JSON.stringify(
      {
        schema_version: '1.1',
        project_id: config.project.id,
        status: 'idle',
        phase: 'planning',
        run_id: null,
        turn_sequence: 0,
        active_turns: {},
        next_role: null,
        pending_phase_transition: null,
        pending_run_completion: null,
        blocked_on: null,
        blocked_reason: null,
      },
      null,
      2,
    ),
  );
  writeFileSync(join(root, '.agentxchain', 'history.jsonl'), '');
  writeFileSync(join(root, '.agentxchain', 'decision-ledger.jsonl'), '');
  writeFileSync(
    join(root, 'TALK.md'),
    `# Governed Todo App — Built-In JSON Report Proof\n\n## Task\n\nBuild a minimal todo app plan and implementation outline.\nThe proof target is built-in plugin execution, not workspace mutation.\n`,
  );

  const promptsDir = join(__dirname, '.agentxchain', 'prompts');
  for (const file of ['pm.md', 'dev.md', 'qa.md', 'eng_director.md']) {
    const src = join(promptsDir, file);
    if (existsSync(src)) {
      cpSync(src, join(root, '.agentxchain', 'prompts', file));
    }
  }

  gitInit(root);
  return config;
}

function sha256(content) {
  return createHash('sha256').update(content).digest('hex');
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function readJsonl(path) {
  if (!existsSync(path)) return [];
  const content = readFileSync(path, 'utf8').trim();
  if (!content) return [];
  return content.split('\n').map((line) => JSON.parse(line));
}

function installPlugin(root) {
  return spawnSync(process.execPath, [binPath, 'plugin', 'install', 'json-report', '--json'], {
    cwd: root,
    env: process.env,
    encoding: 'utf8',
    timeout: 60_000,
  });
}

function runCli(root) {
  return spawnSync(
    process.execPath,
    [binPath, 'run', '--auto-approve', '--max-turns', String(MAX_TURNS)],
    {
      cwd: root,
      env: process.env,
      encoding: 'utf8',
      timeout: 300_000,
    },
  );
}

function collectPluginReports(reportDir) {
  const files = existsSync(reportDir) ? readdirSync(reportDir).sort() : [];
  const timestampedJsonFiles = files.filter((file) => /^\d{4}-\d{2}-\d{2}T.*-(after_acceptance|before_gate)\.json$/.test(file));
  return {
    files,
    timestampedJsonFiles,
    latest: readJson(join(reportDir, 'latest.json')),
    latestAfterAcceptance: readJson(join(reportDir, 'latest-after_acceptance.json')),
    latestBeforeGate: readJson(join(reportDir, 'latest-before_gate.json')),
  };
}

function validateArtifacts(root, installData) {
  const rawState = readFileSync(join(root, '.agentxchain', 'state.json'), 'utf8');
  const state = JSON.parse(rawState);
  const history = readJsonl(join(root, '.agentxchain', 'history.jsonl'));
  const ledger = readJsonl(join(root, '.agentxchain', 'decision-ledger.jsonl'));
  const reportDir = join(root, '.agentxchain', 'reports');
  const reports = collectPluginReports(reportDir);

  return {
    install: {
      ok: installData.ok === true,
      name: installData.name,
      source_type: installData.source?.type || null,
      source_spec: installData.source?.spec || null,
    },
    state: {
      valid: state.status === 'completed' && Boolean(state.completed_at),
      sha256: sha256(rawState),
      status: state.status,
      phase: state.phase,
      run_id: state.run_id || null,
    },
    history: {
      valid: history.length >= 3,
      entry_count: history.length,
      roles: history.map((entry) => entry.role),
      distinct_role_count: new Set(history.map((entry) => entry.role)).size,
    },
    ledger: {
      valid: ledger.length >= 2,
      entry_count: ledger.length,
    },
    reports: {
      dir: reportDir,
      timestamped_json_count: reports.timestampedJsonFiles.length,
      files: reports.files,
      latest: reports.latest,
      latest_after_acceptance: reports.latestAfterAcceptance,
      latest_before_gate: reports.latestBeforeGate,
    },
    cost: {
      total_usd: history.reduce((sum, entry) => sum + (entry.cost?.usd || 0), 0),
      real_api_calls: history.filter((entry) => (entry.cost?.usd || 0) > 0).length,
    },
  };
}

function formatResult(payload) {
  if (jsonMode) {
    process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
    return;
  }

  console.log(`Governed Todo App Built-In JSON Report Proof — agentxchain v${cliPkg.version}`);
  if (payload.result === 'pass') {
    console.log(`  CLI:       ${binPath}`);
    console.log(`  Run ID:    ${payload.artifacts.state.run_id}`);
    console.log(`  Roles:     ${payload.artifacts.history.roles.join(' -> ')}`);
    console.log(`  Turns:     ${payload.artifacts.history.entry_count} accepted`);
    console.log(`  Cost:      $${payload.artifacts.cost.total_usd.toFixed(4)} total`);
    console.log(`  Plugin:    ${payload.artifacts.install.name} (${payload.artifacts.install.source_type}:${payload.artifacts.install.source_spec})`);
    console.log(`  Reports:   ${payload.artifacts.reports.timestamped_json_count} timestamped plugin JSON files`);
    console.log('  Result:    PASS — built-in json-report installed by short name and emitted governed hook artifacts');
    return;
  }

  console.log('  Result:    FAIL');
  for (const error of payload.errors) {
    console.log(`  Error:     ${error}`);
  }
}

function requireApiKey() {
  if (process.env.ANTHROPIC_API_KEY) return null;
  return 'Missing ANTHROPIC_API_KEY';
}

const envError = requireApiKey();
if (envError) {
  const payload = { result: 'fail', errors: [envError] };
  formatResult(payload);
  process.exit(1);
}

let root = null;

try {
  const errors = [];
  let bestPayload = null;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    root = join(tmpdir(), `axc-json-report-proof-${randomBytes(6).toString('hex')}`);
    scaffoldProject(root);

    const installResult = installPlugin(root);
    if (installResult.status !== 0) {
      errors.push(`Attempt ${attempt}: plugin install failed: ${installResult.stderr || installResult.stdout}`);
      rmSync(root, { recursive: true, force: true });
      root = null;
      continue;
    }

    let installData;
    try {
      installData = JSON.parse(installResult.stdout);
    } catch (error) {
      errors.push(`Attempt ${attempt}: invalid plugin install JSON: ${error.message}`);
      rmSync(root, { recursive: true, force: true });
      root = null;
      continue;
    }

    const runResult = runCli(root);
    if (runResult.status !== 0) {
      errors.push(`Attempt ${attempt}: run failed: ${runResult.stderr || runResult.stdout}`);
      rmSync(root, { recursive: true, force: true });
      root = null;
      continue;
    }

    const artifacts = validateArtifacts(root, installData);
    const proofErrors = [];

    if (!artifacts.install.ok) proofErrors.push('plugin install did not report ok=true');
    if (artifacts.install.name !== '@agentxchain/plugin-json-report') proofErrors.push('unexpected plugin name');
    if (artifacts.install.source_type !== 'builtin') proofErrors.push('plugin source type was not builtin');
    if (artifacts.install.source_spec !== 'json-report') proofErrors.push('plugin source spec was not json-report');
    if (!artifacts.state.valid) proofErrors.push('run did not complete');
    if (!artifacts.history.valid) proofErrors.push('history did not record at least 3 accepted turns');
    if (!artifacts.ledger.valid) proofErrors.push('decision ledger did not record at least 2 entries');
    if (artifacts.cost.total_usd <= 0 || artifacts.cost.real_api_calls <= 0) proofErrors.push('run did not record real API cost');
    if (!artifacts.reports.files.includes('latest.json')) proofErrors.push('latest.json missing');
    if (!artifacts.reports.files.includes('latest-after_acceptance.json')) proofErrors.push('latest-after_acceptance.json missing');
    if (!artifacts.reports.files.includes('latest-before_gate.json')) proofErrors.push('latest-before_gate.json missing');
    if (artifacts.reports.timestamped_json_count < 4) proofErrors.push('expected at least 4 timestamped plugin report files');

    for (const [label, report, expectedPhase] of [
      ['latest', artifacts.reports.latest, 'before_gate'],
      ['latest_after_acceptance', artifacts.reports.latest_after_acceptance, 'after_acceptance'],
      ['latest_before_gate', artifacts.reports.latest_before_gate, 'before_gate'],
    ]) {
      if (report.plugin_name !== '@agentxchain/plugin-json-report') {
        proofErrors.push(`${label} plugin_name mismatch`);
      }
      if (report.hook_phase !== expectedPhase) {
        proofErrors.push(`${label} hook_phase mismatch`);
      }
      if (report.run_id !== artifacts.state.run_id) {
        proofErrors.push(`${label} run_id mismatch`);
      }
    }

    bestPayload = {
      result: proofErrors.length === 0 ? 'pass' : 'fail',
      attempt,
      artifacts,
      errors: proofErrors,
    };

    if (proofErrors.length === 0) {
      formatResult(bestPayload);
      process.exit(0);
    }

    errors.push(...proofErrors.map((error) => `Attempt ${attempt}: ${error}`));
    rmSync(root, { recursive: true, force: true });
    root = null;
  }

  const payload = bestPayload || { result: 'fail', errors };
  if (!bestPayload) payload.errors = errors;
  formatResult(payload);
  process.exit(1);
} finally {
  if (root) {
    rmSync(root, { recursive: true, force: true });
  }
}
