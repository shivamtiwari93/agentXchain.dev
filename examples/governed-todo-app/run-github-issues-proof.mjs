#!/usr/bin/env node

/**
 * Governed Todo App — GitHub Issues Plugin Proof
 *
 * Proves the built-in `github-issues` plugin works end-to-end through a real
 * governed `agentxchain run`, producing externally verifiable artifacts:
 * - A plugin-owned comment on a GitHub issue with run status
 * - Managed labels (agentxchain, agentxchain:phase:*)
 *
 * Usage:
 *   node examples/governed-todo-app/run-github-issues-proof.mjs [--json]
 *
 * Environment:
 *   ANTHROPIC_API_KEY — required for api_proxy dispatch
 *   GITHUB_TOKEN      — required for GitHub issue API (or `gh auth token`)
 *
 * Exit codes:
 *   0 — governed run completed, GitHub issue comment + labels verified
 *   1 — run failed or GitHub artifacts invalid
 */

import { mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, cpSync } from 'fs';
import { join, dirname } from 'path';
import { tmpdir } from 'os';
import { randomBytes, createHash } from 'crypto';
import { spawnSync, execSync } from 'child_process';
import { fileURLToPath } from 'url';
import https from 'node:https';

const __dirname = dirname(fileURLToPath(import.meta.url));
const jsonMode = process.argv.includes('--json');
const repoRoot = join(__dirname, '..', '..');
const cliRoot = join(repoRoot, 'cli');
const binPath = join(cliRoot, 'bin', 'agentxchain.js');
const cliPkg = JSON.parse(readFileSync(join(cliRoot, 'package.json'), 'utf8'));

const HAIKU_MODEL = 'claude-haiku-4-5-20251001';
const MAX_TURNS = 6;
const MAX_ATTEMPTS = 3;
const PROOF_REPO = 'shivamtiwari93/agentXchain.dev';
const PROOF_ISSUE = 77;

// --- GitHub API helpers ---

function resolveGitHubToken() {
  if (process.env.GITHUB_TOKEN) return process.env.GITHUB_TOKEN;
  try {
    return execSync('gh auth token', { encoding: 'utf8' }).trim();
  } catch {
    return '';
  }
}

function githubApi(method, path, token, body) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, 'https://api.github.com/');
    const payload = body ? JSON.stringify(body) : '';
    const req = https.request(url, {
      method,
      headers: {
        accept: 'application/vnd.github+json',
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
        'content-length': Buffer.byteLength(payload),
        'user-agent': 'agentxchain-proof',
        'x-github-api-version': '2022-11-28',
      },
      timeout: 10000,
    }, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, body: JSON.parse(data) });
        } catch {
          resolve({ status: res.statusCode, body: data });
        }
      });
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

async function getIssueComments(token) {
  const resp = await githubApi('GET', `/repos/${PROOF_REPO}/issues/${PROOF_ISSUE}/comments?per_page=100`, token);
  return resp.status === 200 ? resp.body : [];
}

async function getIssueLabels(token) {
  const resp = await githubApi('GET', `/repos/${PROOF_REPO}/issues/${PROOF_ISSUE}/labels`, token);
  return resp.status === 200 ? resp.body.map((l) => l.name) : [];
}

// --- Project scaffolding ---

function makeConfig(ghToken) {
  return {
    schema_version: 4,
    protocol_mode: 'governed',
    project: {
      id: `ghi-proof-${randomBytes(4).toString('hex')}`,
      name: 'GitHub Issues Plugin Proof',
      description: 'Prove github-issues built-in plugin mirrors run status to a real GitHub issue.',
      default_branch: 'main',
    },
    roles: {
      pm: {
        title: 'Product Manager',
        mandate: 'Produce a one-paragraph plan for a todo app. Then set phase_transition_request to "implementation".',
        write_authority: 'review_only',
        runtime: 'api-pm',
        runtime_class: 'api_proxy',
        runtime_id: 'api-pm',
      },
      dev: {
        title: 'Developer',
        mandate: 'Review the plan. Describe the implementation approach. Then set phase_transition_request to "qa".',
        write_authority: 'review_only',
        runtime: 'api-dev',
        runtime_class: 'api_proxy',
        runtime_id: 'api-dev',
      },
      qa: {
        title: 'QA',
        mandate: 'Review the implementation plan. Confirm coverage. Then set run_completion_request to true.',
        write_authority: 'review_only',
        runtime: 'api-qa',
        runtime_class: 'api_proxy',
        runtime_id: 'api-qa',
      },
    },
    runtimes: {
      'api-pm': { type: 'api_proxy', provider: 'anthropic', model: HAIKU_MODEL, auth_env: 'ANTHROPIC_API_KEY', max_output_tokens: 4096, timeout_seconds: 90 },
      'api-dev': { type: 'api_proxy', provider: 'anthropic', model: HAIKU_MODEL, auth_env: 'ANTHROPIC_API_KEY', max_output_tokens: 4096, timeout_seconds: 90 },
      'api-qa': { type: 'api_proxy', provider: 'anthropic', model: HAIKU_MODEL, auth_env: 'ANTHROPIC_API_KEY', max_output_tokens: 4096, timeout_seconds: 90 },
    },
    routing: {
      planning: {
        entry_role: 'pm',
        allowed_next_roles: ['pm', 'dev', 'human'],
        exit_gate: 'planning_signoff',
      },
      implementation: {
        entry_role: 'dev',
        allowed_next_roles: ['dev', 'qa', 'human'],
        exit_gate: 'impl_complete',
      },
      qa: {
        entry_role: 'qa',
        allowed_next_roles: ['dev', 'qa', 'human'],
        exit_gate: 'qa_verdict',
      },
    },
    gates: {
      planning_signoff: {},
      impl_complete: {},
      qa_verdict: {},
    },
    budget: { per_turn_max_usd: 1.00, per_run_max_usd: 5.00 },
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
  spawnSync('git', ['config', 'user.name', 'AgentXchain Proof'], opts);
  spawnSync('git', ['config', 'user.email', 'proof@example.invalid'], opts);
  spawnSync('git', ['add', '-A'], opts);
  spawnSync('git', ['commit', '--allow-empty', '-m', 'scaffold'], opts);
}

function scaffoldProject(root, ghToken) {
  const config = makeConfig(ghToken);

  mkdirSync(join(root, '.agentxchain', 'prompts'), { recursive: true });
  mkdirSync(join(root, '.planning'), { recursive: true });

  writeFileSync(join(root, 'agentxchain.json'), JSON.stringify(config, null, 2));

  writeFileSync(
    join(root, '.agentxchain', 'state.json'),
    JSON.stringify({
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
    }, null, 2),
  );

  writeFileSync(join(root, '.agentxchain', 'history.jsonl'), '');
  writeFileSync(join(root, '.agentxchain', 'decision-ledger.jsonl'), '');

  writeFileSync(
    join(root, 'TALK.md'),
    '# GitHub Issues Plugin Proof\n\n## Task\n\nBuild a minimal todo app. This run proves the github-issues plugin mirrors status to a real GitHub issue.\n',
  );

  // Copy prompts if available
  const promptsDir = join(__dirname, '.agentxchain', 'prompts');
  for (const file of ['pm.md', 'dev.md', 'qa.md']) {
    const src = join(promptsDir, file);
    if (existsSync(src)) {
      cpSync(src, join(root, '.agentxchain', 'prompts', file));
    }
  }

  gitInit(root);
  return config;
}

function installPlugin(root, ghToken) {
  const pluginConfig = JSON.stringify({
    repo: PROOF_REPO,
    issue_number: PROOF_ISSUE,
    token_env: 'GITHUB_TOKEN',
  });

  return spawnSync(
    process.execPath,
    [binPath, 'plugin', 'install', 'github-issues', '--config', pluginConfig, '--json'],
    {
      cwd: root,
      env: { ...process.env, GITHUB_TOKEN: ghToken },
      encoding: 'utf8',
      timeout: 30000,
    },
  );
}

function runCli(root, ghToken) {
  return spawnSync(
    process.execPath,
    [binPath, 'run', '--auto-approve', '--max-turns', String(MAX_TURNS)],
    {
      cwd: root,
      env: { ...process.env, GITHUB_TOKEN: ghToken },
      encoding: 'utf8',
      timeout: 300000,
    },
  );
}

function readJsonl(path) {
  if (!existsSync(path)) return [];
  const content = readFileSync(path, 'utf8').trim();
  if (!content) return [];
  return content.split('\n').map((line) => JSON.parse(line));
}

async function verifyGitHubArtifacts(runId, ghToken) {
  const comments = await getIssueComments(ghToken);
  const labels = await getIssueLabels(ghToken);

  const marker = `<!-- agentxchain:github-issues:run:${runId} -->`;
  const pluginComment = comments.find((c) => typeof c.body === 'string' && c.body.includes(marker));

  return {
    comment_found: Boolean(pluginComment),
    comment_contains_marker: Boolean(pluginComment),
    comment_contains_after_acceptance: Boolean(pluginComment && pluginComment.body.includes('after_acceptance')),
    comment_contains_run_id: Boolean(pluginComment && pluginComment.body.includes(runId)),
    comment_url: pluginComment?.html_url || null,
    has_agentxchain_label: labels.includes('agentxchain'),
    has_phase_label: labels.some((l) => l.startsWith('agentxchain:phase:')),
    all_labels: labels.filter((l) => l.startsWith('agentxchain')),
    total_comments_on_issue: comments.length,
  };
}

async function attempt(ghToken) {
  const root = join(tmpdir(), `axc-ghi-proof-${randomBytes(6).toString('hex')}`);
  const errors = [];
  let cliResult = null;
  let artifacts = null;
  let githubResult = null;

  try {
    mkdirSync(root, { recursive: true });
    scaffoldProject(root, ghToken);

    // Install github-issues plugin
    const installResult = installPlugin(root, ghToken);
    if (installResult.status !== 0) {
      errors.push(`Plugin install failed: ${installResult.stderr || installResult.stdout || 'unknown'}`);
      return { passed: false, payload: buildPayload(false, null, null, null, errors) };
    }

    // Run governed execution
    cliResult = runCli(root, ghToken);

    if (cliResult.error) {
      errors.push(`CLI spawn failed: ${cliResult.error.message}`);
    }

    if (cliResult.status !== 0) {
      errors.push(`expected CLI exit 0, got ${cliResult.status}`);
    }

    // Validate local governance artifacts
    const state = JSON.parse(readFileSync(join(root, '.agentxchain', 'state.json'), 'utf8'));
    const history = readJsonl(join(root, '.agentxchain', 'history.jsonl'));
    const ledger = readJsonl(join(root, '.agentxchain', 'decision-ledger.jsonl'));
    const runId = state.run_id || 'unknown';
    const distinctRoles = [...new Set(history.map((e) => e.role))];

    artifacts = {
      state: { status: state.status, run_id: runId, phase: state.phase },
      history: {
        entry_count: history.length,
        roles: history.map((e) => e.role),
        distinct_roles: distinctRoles,
        distinct_role_count: distinctRoles.length,
      },
      ledger: { entry_count: ledger.length },
      cost: {
        total_usd: history.reduce((sum, e) => sum + (e.cost?.usd || 0), 0),
        real_api_calls: history.filter((e) => (e.cost?.usd || 0) > 0).length,
      },
    };

    if (state.status !== 'completed') errors.push(`expected state completed, got ${state.status}`);
    if (history.length < 3) errors.push(`expected ≥3 turns, got ${history.length}`);
    if (distinctRoles.length < 3) errors.push(`expected ≥3 distinct roles, got ${distinctRoles.length}`);

    // Verify GitHub issue artifacts via API
    // Small delay to let GitHub API consistency settle
    await new Promise((r) => setTimeout(r, 2000));
    githubResult = await verifyGitHubArtifacts(runId, ghToken);

    if (!githubResult.comment_found) errors.push('no plugin-owned comment found on GitHub issue');
    if (!githubResult.comment_contains_after_acceptance) errors.push('comment does not contain after_acceptance event');
    if (!githubResult.comment_contains_run_id) errors.push('comment does not contain run_id');
    if (!githubResult.has_agentxchain_label) errors.push('issue missing agentxchain label');
    if (!githubResult.has_phase_label) errors.push('issue missing agentxchain:phase:* label');

    const passed = errors.length === 0;
    return { passed, payload: buildPayload(passed, cliResult, artifacts, githubResult, errors) };
  } catch (err) {
    errors.push(`Unexpected: ${err.message}`);
    return { passed: false, payload: buildPayload(false, cliResult, artifacts, githubResult, errors) };
  } finally {
    try {
      rmSync(root, { recursive: true, force: true });
    } catch {}
  }
}

function buildPayload(passed, cliResult, artifacts, githubResult, errors) {
  return {
    runner: 'governed-todo-app-github-issues-proof',
    cli_version: cliPkg.version,
    result: passed ? 'pass' : 'fail',
    proof_issue: `https://github.com/${PROOF_REPO}/issues/${PROOF_ISSUE}`,
    cli_exit_status: cliResult?.status ?? null,
    artifacts: artifacts || null,
    github: githubResult || null,
    errors,
  };
}

function formatResult(payload) {
  if (jsonMode) {
    process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
  } else if (payload.result === 'pass') {
    console.log(`GitHub Issues Plugin Proof — agentxchain v${cliPkg.version}`);
    console.log(`  Plugin:   github-issues (built-in)`);
    console.log(`  Issue:    ${payload.proof_issue}`);
    console.log(`  Roles:    ${payload.artifacts.history.roles.join(' → ')}`);
    console.log(`  Turns:    ${payload.artifacts.history.entry_count} accepted`);
    console.log(`  Cost:     $${payload.artifacts.cost.total_usd.toFixed(4)} total`);
    console.log(`  Run ID:   ${payload.artifacts.state.run_id}`);
    console.log(`  Comment:  ${payload.github.comment_url}`);
    console.log(`  Labels:   ${payload.github.all_labels.join(', ')}`);
    console.log('  Result:   PASS — plugin mirrored run status to GitHub issue');
  } else {
    console.log(`GitHub Issues Plugin Proof — agentxchain v${cliPkg.version}`);
    console.log('  Result:   FAIL');
    for (const error of payload.errors) {
      console.log(`  Error:    ${error}`);
    }
  }
}

// --- main ---

if (!process.env.ANTHROPIC_API_KEY) {
  console.error('ANTHROPIC_API_KEY is required for api_proxy dispatch');
  process.exit(1);
}

const ghToken = resolveGitHubToken();
if (!ghToken) {
  console.error('GITHUB_TOKEN is required (set env var or login via `gh auth login`)');
  process.exit(1);
}

const attempts = [];
for (let i = 1; i <= MAX_ATTEMPTS; i++) {
  const outcome = await attempt(ghToken);
  attempts.push({
    attempt: i,
    result: outcome.passed ? 'pass' : 'fail',
    errors: outcome.payload.errors,
  });
  if (outcome.passed) {
    if (jsonMode) {
      outcome.payload.attempts_used = i;
      outcome.payload.attempt_history = attempts;
    }
    formatResult(outcome.payload);
    process.exit(0);
  }
  if (i < MAX_ATTEMPTS && !jsonMode) {
    console.log(`\n  Retrying (attempt ${i + 1}/${MAX_ATTEMPTS})...\n`);
  }
}

const last = attempts[attempts.length - 1];
formatResult({
  runner: 'governed-todo-app-github-issues-proof',
  cli_version: cliPkg.version,
  result: 'fail',
  proof_issue: `https://github.com/${PROOF_REPO}/issues/${PROOF_ISSUE}`,
  cli_exit_status: null,
  attempts_used: attempts.length,
  attempt_history: attempts,
  errors: last?.errors || ['Proof failed without a captured error.'],
});
process.exit(1);
