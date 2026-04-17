#!/usr/bin/env node

/**
 * Live mixed-runtime continuous proof.
 *
 * Truthful scope:
 *   - proves the real `run --continuous` CLI surface
 *   - proves one real `api_proxy` review role participates in a full governed run
 *   - proves continuous session + intake provenance + review artifact + spend tracking
 *   - does NOT pretend that review_only api_proxy roles can author repo-local gate files
 */

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, readdirSync } from 'fs';
import { join, dirname } from 'path';
import { tmpdir } from 'os';
import { fileURLToPath } from 'url';
import { execSync, spawnSync } from 'child_process';

import { scaffoldGoverned } from '../../cli/src/commands/init.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, '..', '..');
const cliRoot = join(repoRoot, 'cli');
const binPath = join(cliRoot, 'bin', 'agentxchain.js');
const proofAgentPath = join(cliRoot, 'test-support', 'committing-proof-agent.mjs');

const jsonMode = process.argv.includes('--json');
const keepTemp = process.argv.includes('--keep-temp');
let shouldCleanup = true;

if (!process.env.ANTHROPIC_API_KEY) {
  output({
    result: 'skip',
    reason: 'Live continuous mixed-runtime proof requires ANTHROPIC_API_KEY',
    missing_env: ['ANTHROPIC_API_KEY'],
  });
  process.exit(0);
}

const MODEL = 'claude-haiku-4-5-20251001';
const root = mkdtempSync(join(tmpdir(), 'axc-live-cont-proof-'));

try {
  const proof = runProof(root);
  output({ result: 'pass', ...proof });
  process.exit(0);
} catch (error) {
  shouldCleanup = false;
  output({
    result: 'fail',
    reason: error instanceof Error ? error.message : String(error),
    workdir: root,
  });
  process.exit(1);
} finally {
  if (shouldCleanup && !keepTemp) {
    rmSync(root, { recursive: true, force: true });
  }
}

function runProof(projectRoot) {
  scaffoldGoverned(projectRoot, 'Live Continuous Mixed Runtime Proof', `live-continuous-proof-${Date.now()}`);

  const configPath = join(projectRoot, 'agentxchain.json');
  const config = JSON.parse(readFileSync(configPath, 'utf8'));

  const localRuntime = {
    type: 'local_cli',
    command: process.execPath,
    args: [proofAgentPath],
    prompt_transport: 'dispatch_bundle_only',
  };

  config.runtimes['local-pm'] = { ...localRuntime };
  config.runtimes['local-dev'] = { ...localRuntime };
  config.runtimes['local-director'] = { ...localRuntime };
  config.runtimes['api-qa'] = {
    type: 'api_proxy',
    provider: 'anthropic',
    model: MODEL,
    auth_env: 'ANTHROPIC_API_KEY',
    max_output_tokens: 4096,
    timeout_seconds: 120,
    retry_policy: { max_attempts: 1 },
  };

  config.roles.pm.runtime = 'local-pm';
  config.roles.pm.write_authority = 'authoritative';
  config.roles.dev.runtime = 'local-dev';
  config.roles.dev.write_authority = 'authoritative';
  config.roles.eng_director.runtime = 'local-director';
  config.roles.eng_director.write_authority = 'authoritative';
  config.roles.qa.runtime = 'api-qa';
  config.roles.qa.write_authority = 'review_only';

  writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n');

  mkdirSync(join(projectRoot, '.planning'), { recursive: true });
  writeFileSync(join(projectRoot, '.planning', 'VISION.md'), `# Live Continuous Mixed Runtime Proof

## Goal

- complete one truthful governed run through the continuous loop

## Constraints

- local authoring roles satisfy repo-local gate files
- QA reviews through the real api_proxy adapter
`, 'utf8');

  // QA is review_only + api_proxy, so final gate artifacts must already exist in the repo.
  // The local proof agent commits each authored slice so the git-backed repo
  // returns to a clean baseline before the next authoritative turn.
  writeFileSync(
    join(projectRoot, '.planning', 'acceptance-matrix.md'),
    '# Acceptance Matrix\n\n| Req # | Requirement | Acceptance criteria | Test status | Last tested | Status |\n|-------|-------------|-------------------|-------------|-------------|--------|\n| 1 | Mixed-runtime continuous run | One bounded continuous run completes with real api-backed QA | pass | 2026-04-17 | pass |\n',
  );
  writeFileSync(
    join(projectRoot, '.planning', 'ship-verdict.md'),
    '# Ship Verdict\n\n## Verdict: YES\n\nQA review is delegated to a real api_proxy role; gate files are repo-local truth, not remote fantasy.\n',
  );
  writeFileSync(
    join(projectRoot, '.planning', 'RELEASE_NOTES.md'),
    '# Release Notes\n\n## User Impact\n\nLive mixed-runtime continuous proof completed through real API-backed QA review.\n\n## Verification Summary\n\n- node examples/live-governed-proof/run-continuous-mixed-proof.mjs --json\n',
  );

  execSync('git init', { cwd: projectRoot, stdio: 'pipe' });
  execSync('git add -A', { cwd: projectRoot, stdio: 'pipe' });
  execSync('git commit -m "init proof repo"', {
    cwd: projectRoot,
    stdio: 'pipe',
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: 'proof',
      GIT_AUTHOR_EMAIL: 'proof@example.com',
      GIT_COMMITTER_NAME: 'proof',
      GIT_COMMITTER_EMAIL: 'proof@example.com',
    },
  });

  const run = spawnSync(
    process.execPath,
    [
      binPath,
      'run',
      '--continuous',
      '--vision', '.planning/VISION.md',
      '--max-runs', '1',
      '--max-idle-cycles', '1',
      '--poll-seconds', '0',
      '--session-budget', '2.00',
    ],
    {
      cwd: projectRoot,
      encoding: 'utf8',
      env: {
        ...process.env,
        NO_COLOR: '1',
        NODE_NO_WARNINGS: '1',
      },
      timeout: 240_000,
    },
  );

  if (run.error) {
    throw run.error;
  }
  if (run.status !== 0) {
    throw new Error(
      `continuous proof CLI failed with exit ${run.status}\nstdout:\n${trim(run.stdout)}\nstderr:\n${trim(run.stderr)}`
    );
  }

  const session = readJson(projectRoot, '.agentxchain/continuous-session.json');
  if (session.status !== 'completed') {
    throw new Error(`expected continuous session to be completed, got ${session.status}`);
  }
  if (session.runs_completed !== 1) {
    throw new Error(`expected continuous session runs_completed=1, got ${session.runs_completed}`);
  }

  const state = readJson(projectRoot, '.agentxchain/state.json');
  const runHistory = readJsonl(projectRoot, '.agentxchain/run-history.jsonl');
  const history = readJsonl(projectRoot, '.agentxchain/history.jsonl');
  const qaTurn = history.find((entry) => entry.role === 'qa' && entry.runtime_id === 'api-qa');
  if (!qaTurn) {
    throw new Error('expected a qa turn with runtime_id "api-qa" in governed history');
  }

  if (runHistory.length !== 1) {
    throw new Error(`expected exactly one run-history entry, got ${runHistory.length}`);
  }
  const historyEntry = runHistory[0];
  if (historyEntry.status !== 'completed') {
    throw new Error(`expected completed run-history entry, got ${historyEntry.status}`);
  }
  if (historyEntry.provenance?.created_by !== 'continuous_loop') {
    throw new Error(`expected continuous provenance created_by=continuous_loop, got ${historyEntry.provenance?.created_by ?? 'null'}`);
  }
  if (!historyEntry.provenance?.intake_intent_id) {
    throw new Error('expected continuous run-history provenance to include intake_intent_id');
  }

  const reviewsDir = join(projectRoot, '.agentxchain', 'reviews');
  if (!existsSync(reviewsDir)) {
    throw new Error('expected .agentxchain/reviews directory to exist');
  }
  const reviewFiles = readdirSync(reviewsDir).filter((name) => name.includes('-qa-review.md'));
  if (reviewFiles.length === 0) {
    throw new Error('expected a qa review artifact generated from the api_proxy turn');
  }

  const spentUsd = Number(session.cumulative_spent_usd || state.budget_status?.spent_usd || 0);
  if (!(spentUsd > 0)) {
    throw new Error(`expected non-zero recorded spend for live api proof, got ${spentUsd}`);
  }

  return {
    provider: 'anthropic',
    model: MODEL,
    command: 'agentxchain run --continuous --vision .planning/VISION.md --max-runs 1 --max-idle-cycles 1 --poll-seconds 0 --session-budget 2.00',
    proof: {
      workdir: projectRoot,
      session_id: session.session_id,
      current_run_id: session.current_run_id,
      status: session.status,
      runs_completed: session.runs_completed,
      cumulative_spent_usd: spentUsd,
      continuous_provenance: historyEntry.provenance,
      qa_turn_id: qaTurn.turn_id,
      qa_runtime_id: qaTurn.runtime_id,
      review_artifact: join('.agentxchain', 'reviews', reviewFiles[0]),
      stdout_tail: trim(run.stdout).slice(-1000),
    },
  };
}

function readJson(root, relativePath) {
  return JSON.parse(readFileSync(join(root, relativePath), 'utf8'));
}

function readJsonl(root, relativePath) {
  const raw = readFileSync(join(root, relativePath), 'utf8').trim();
  if (!raw) return [];
  return raw.split('\n').filter(Boolean).map((line) => JSON.parse(line));
}

function trim(value) {
  return String(value || '').trim();
}

function output(data) {
  if (jsonMode) {
    process.stdout.write(JSON.stringify(data, null, 2) + '\n');
    return;
  }

  console.log(`\n=== Live Continuous Mixed Runtime Proof: ${String(data.result).toUpperCase()} ===\n`);
  if (data.reason) {
    console.log(`Reason: ${data.reason}`);
  }
  if (data.proof) {
    console.log(`Provider: ${data.provider}`);
    console.log(`Model: ${data.model}`);
    console.log(`Command: ${data.command}`);
    console.log(`Session: ${data.proof.session_id}`);
    console.log(`Run: ${data.proof.current_run_id}`);
    console.log(`Spend: $${Number(data.proof.cumulative_spent_usd).toFixed(4)}`);
    console.log(`QA Turn: ${data.proof.qa_turn_id} (${data.proof.qa_runtime_id})`);
    console.log(`Review: ${data.proof.review_artifact}`);
  }
}
