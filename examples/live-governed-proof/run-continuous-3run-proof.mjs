#!/usr/bin/env node

import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'fs';
import { join, dirname, resolve } from 'path';
import { tmpdir } from 'os';
import { fileURLToPath } from 'url';
import { execSync, spawn } from 'child_process';

import { scaffoldGoverned } from '../../cli/src/commands/init.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, '..', '..');
const cliRoot = join(repoRoot, 'cli');
const cliPkg = JSON.parse(readFileSync(join(cliRoot, 'package.json'), 'utf8'));
const proofAgentPath = join(cliRoot, 'test-support', 'committing-proof-agent.mjs');

const args = process.argv.slice(2);
const jsonMode = args.includes('--json');
const keepTemp = args.includes('--keep-temp');
let shouldCleanup = !keepTemp;

function readFlagValue(flag) {
  const index = args.indexOf(flag);
  if (index === -1) return null;
  const value = args[index + 1];
  if (!value || value.startsWith('--')) {
    throw new Error(`${flag} requires a path value`);
  }
  return value;
}

const outputPath = readFlagValue('--output');

const MODEL = 'claude-haiku-4-5-20251001';
const authEnv = process.env.AXC_PROOF_AUTH_ENV || 'ANTHROPIC_API_KEY';
const providerKey = process.env[authEnv];
const allowMock = process.env.AXC_PROOF_ALLOW_MOCK === '1';
const pollSeconds = String(Number(process.env.AXC_PROOF_POLL_SECONDS ?? 30));
const cooldownSeconds = Number(process.env.AXC_PROOF_COOLDOWN_SECONDS ?? 5);
const baseUrl = process.env.AXC_PROOF_BASE_URL || null;
const shimBinDir = mkdtempSync(join(tmpdir(), 'axc-proof-bin-'));

if (!providerKey) {
  output({
    result: allowMock ? 'fail' : 'skip',
    reason: `Continuous 3-run proof requires ${authEnv}`,
    missing_env: [authEnv],
  });
  process.exit(allowMock ? 1 : 0);
}

const root = mkdtempSync(join(tmpdir(), 'axc-live-cont-3run-'));

try {
  const proof = await runProof(root);
  const payload = buildPayload({ result: 'pass', ...proof });
  writePayloadFile(payload);
  output(payload);
  process.exit(0);
} catch (error) {
  shouldCleanup = false;
  const payload = buildPayload({
    result: 'fail',
    reason: error instanceof Error ? error.message : String(error),
    workdir: root,
  });
  writePayloadFile(payload);
  output(payload);
  process.exit(1);
} finally {
  rmSync(shimBinDir, { recursive: true, force: true });
  if (shouldCleanup) {
    rmSync(root, { recursive: true, force: true });
  }
}

async function runProof(projectRoot) {
  scaffoldGoverned(projectRoot, 'Live Continuous 3-Run Proof', `live-continuous-3run-${Date.now()}`);

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
    auth_env: authEnv,
    ...(baseUrl ? { base_url: baseUrl } : {}),
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
  config.run_loop = {
    ...(config.run_loop || {}),
    continuous: {
      ...((config.run_loop && config.run_loop.continuous) || {}),
      triage_approval: 'human',
      cooldown_seconds: cooldownSeconds,
    },
  };

  writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n');

  mkdirSync(join(projectRoot, '.planning'), { recursive: true });
  const visionPath = join(projectRoot, '.planning', 'VISION.md');
  const visionContent = `# Live Continuous 3-Run Proof

## Proof Queue

- capture alpha ledger evidence trail
- capture beta provenance dashboard slice
- capture gamma escalation recovery drill
`;
  writeFileSync(visionPath, visionContent, 'utf8');

  writeFileSync(
    join(projectRoot, '.planning', 'acceptance-matrix.md'),
    '# Acceptance Matrix\n\n| Req # | Requirement | Acceptance criteria | Test status | Last tested | Status |\n|-------|-------------|-------------------|-------------|-------------|--------|\n| 1 | Continuous 3-run proof | Three governed runs complete unattended with real QA review | pass | 2026-04-17 | pass |\n',
  );
  writeFileSync(
    join(projectRoot, '.planning', 'ship-verdict.md'),
    '# Ship Verdict\n\n## Verdict: YES\n\nQA review is delegated to an api_proxy runtime; gate files remain repo-local truth.\n',
  );
  writeFileSync(
    join(projectRoot, '.planning', 'RELEASE_NOTES.md'),
    '# Release Notes\n\n## User Impact\n\nContinuous 3-run proof completed through real or contract-equivalent QA review.\n\n## Verification Summary\n\n- agentxchain run --continuous --vision .planning/VISION.md --max-runs 3 --poll-seconds 30 --triage-approval auto\n',
  );

  execSync('git init', { cwd: projectRoot, stdio: 'pipe' });
  execSync('git add -A', { cwd: projectRoot, stdio: 'pipe' });
  execSync('git commit -m "init proof repo\n\nCo-Authored-By: GPT 5.4 (Codex) <noreply@openai.com>"', {
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

  const command = [
    'agentxchain',
    'run',
    '--continuous',
    '--vision',
    '.planning/VISION.md',
    '--max-runs',
    '3',
    '--poll-seconds',
    pollSeconds,
    '--triage-approval',
    'auto',
  ];

  const sessionPath = join(projectRoot, '.agentxchain', 'continuous-session.json');
  const beforeSnapshot = existsSync(sessionPath)
    ? JSON.parse(readFileSync(sessionPath, 'utf8'))
    : null;
  const visionBefore = readFileSync(visionPath, 'utf8');
  const startedAt = Date.now();
  const shimPath = join(shimBinDir, 'agentxchain');
  if (!existsSync(shimPath)) {
    symlinkSync(join(cliRoot, 'bin', 'agentxchain.js'), shimPath);
  }

  const child = spawn(command[0], command.slice(1), {
    cwd: projectRoot,
    env: {
      ...process.env,
      PATH: `${shimBinDir}:${process.env.PATH || ''}`,
      NO_COLOR: '1',
      NODE_NO_WARNINGS: '1',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
  child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });

  const sessionStartedSnapshot = await waitForSessionSnapshot(sessionPath, stdout, stderr);
  const exit = await waitForChild(child, stdout, stderr);

  if (exit.code !== 0) {
    throw new Error(
      `continuous 3-run proof CLI failed with exit ${exit.code}\nstdout:\n${trim(stdout)}\nstderr:\n${trim(stderr)}`
    );
  }

  const sessionAfter = JSON.parse(readFileSync(sessionPath, 'utf8'));
  if (sessionAfter.status !== 'completed') {
    throw new Error(`expected completed continuous session, got ${sessionAfter.status}`);
  }
  if (sessionAfter.runs_completed < 3) {
    throw new Error(`expected runs_completed >= 3, got ${sessionAfter.runs_completed}`);
  }

  const visionAfter = readFileSync(visionPath, 'utf8');
  if (visionAfter !== visionBefore) {
    throw new Error('expected project VISION.md to remain unchanged during proof');
  }

  const history = readJsonl(projectRoot, '.agentxchain/history.jsonl');
  const runHistory = readJsonl(projectRoot, '.agentxchain/run-history.jsonl');
  if (runHistory.length < 3) {
    throw new Error(`expected at least 3 run-history entries, got ${runHistory.length}`);
  }

  const reviewsDir = join(projectRoot, '.agentxchain', 'reviews');
  const reviewFiles = existsSync(reviewsDir) ? readdirSync(reviewsDir) : [];

  const runSummaries = runHistory.slice(0, 3).map((entry, index) => {
    const runTurns = history.filter((turn) => turn.run_id === entry.run_id);
    const qaTurn = history.find((turn) => turn.run_id === entry.run_id && turn.role === 'qa' && turn.runtime_id === 'api-qa');
    if (!qaTurn) {
      throw new Error(`expected a real-credential QA turn for run ${entry.run_id}`);
    }
    const reviewArtifact = reviewFiles.find((name) => name.includes(`${qaTurn.turn_id}-qa-review`)) || null;
    return {
      ordinal: index + 1,
      run_id: entry.run_id,
      turns_taken: runTurns.length,
      spend_usd: entry.total_cost_usd,
      provenance_trigger: entry.provenance?.trigger || null,
      provenance_created_by: entry.provenance?.created_by || null,
      vision_goal: entry.provenance?.trigger_reason || null,
      real_credential_turn: {
        role: qaTurn.role,
        turn_id: qaTurn.turn_id,
        runtime_id: qaTurn.runtime_id,
        provider: 'anthropic',
        model: MODEL,
        review_artifact: reviewArtifact ? join('.agentxchain', 'reviews', reviewArtifact) : null,
      },
    };
  });

  for (const summary of runSummaries) {
    if (summary.provenance_trigger !== 'vision_scan') {
      throw new Error(`expected vision_scan provenance for ${summary.run_id}, got ${summary.provenance_trigger}`);
    }
    if (summary.provenance_created_by !== 'continuous_loop') {
      throw new Error(`expected continuous_loop provenance for ${summary.run_id}, got ${summary.provenance_created_by}`);
    }
  }

  const gitLogOneline = execSync('git log --oneline --decorate --max-count=12', {
    cwd: projectRoot,
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
  }).trim().split('\n').filter(Boolean);

  const gitLogRaw = execSync("git log --pretty=format:'%H%n%s%n%b<<<END>>>' --max-count=12", {
    cwd: projectRoot,
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
  }).trim();

  const runCommitEntries = gitLogRaw
    .split('<<<END>>>')
    .map((block) => block.trim())
    .filter(Boolean)
    .map((block) => {
      const [hash = '', subject = '', ...bodyLines] = block.split('\n');
      const body = bodyLines.join('\n').trim();
      const sessionMatch = body.match(/Continuous-Session:\s+(\S+)/);
      const runMatch = subject.match(/proof\((planning|implementation)\):\s+(run_[a-f0-9]+)\s+(.+)/);
      return {
        hash,
        subject,
        body,
        phase: runMatch?.[1] || null,
        run_id: runMatch?.[2] || null,
        objective_slug: runMatch?.[3] || null,
        session_id: sessionMatch?.[1] || null,
      };
    })
    .filter((entry) => entry.subject.startsWith('proof('));

  for (const run of runSummaries) {
    const commitsForRun = runCommitEntries.filter((entry) => entry.run_id === run.run_id);
    if (commitsForRun.length === 0) {
      throw new Error(`expected at least one git commit for ${run.run_id}`);
    }
    if (commitsForRun.some((entry) => entry.session_id !== sessionAfter.session_id)) {
      throw new Error(`expected all commits for ${run.run_id} to carry session ${sessionAfter.session_id}`);
    }
  }

  return {
    provider: 'anthropic',
    model: MODEL,
    command: command.join(' '),
    proof: {
      workdir: projectRoot,
      started_at: new Date(startedAt).toISOString(),
      finished_at: new Date().toISOString(),
      wall_clock_seconds: Number(((Date.now() - startedAt) / 1000).toFixed(3)),
      continuous_session_before: beforeSnapshot,
      continuous_session_started: sessionStartedSnapshot,
      continuous_session_after: sessionAfter,
      run_summaries: runSummaries,
      git_log_oneline: gitLogOneline,
      run_commit_entries: runCommitEntries,
      blockers: [],
      vision_unchanged: true,
      stdout_tail: trim(stdout).slice(-2000),
      stderr_tail: trim(stderr).slice(-1000),
    },
  };
}

async function waitForSessionSnapshot(sessionPath, stdout, stderr) {
  const started = Date.now();
  while (!existsSync(sessionPath)) {
    if (Date.now() - started > 20000) {
      throw new Error(`continuous session never materialized\nstdout:\n${trim(stdout)}\nstderr:\n${trim(stderr)}`);
    }
    await sleep(100);
  }
  return JSON.parse(readFileSync(sessionPath, 'utf8'));
}

async function waitForChild(child, stdout, stderr) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`continuous 3-run proof timed out\nstdout:\n${trim(stdout)}\nstderr:\n${trim(stderr)}`));
    }, 240000);

    child.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });

    child.on('close', (code, signal) => {
      clearTimeout(timer);
      resolve({ code, signal });
    });
  });
}

function readJsonl(root, relativePath) {
  const raw = readFileSync(join(root, relativePath), 'utf8').trim();
  if (!raw) return [];
  return raw.split('\n').filter(Boolean).map((line) => JSON.parse(line));
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function trim(value) {
  return String(value || '').trim();
}

function sanitizePath(value) {
  if (typeof value !== 'string') return value;
  const marker = '/examples/live-governed-proof/';
  const idx = value.indexOf(marker);
  if (idx !== -1) return value.slice(idx + 1);
  const tmpMarker = '/axc-live-cont-3run-';
  const tmpIdx = value.indexOf(tmpMarker);
  if (tmpIdx !== -1) return '<tmp>' + value.slice(tmpIdx);
  return value;
}

function sanitizePayload(obj) {
  if (obj === null || obj === undefined) return obj;
  if (typeof obj === 'string') return sanitizePath(obj);
  if (Array.isArray(obj)) return obj.map(sanitizePayload);
  if (typeof obj === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(obj)) {
      out[k] = sanitizePayload(v);
    }
    return out;
  }
  return obj;
}

function buildPayload(raw) {
  const base = {
    runner: 'continuous-3run-live-proof',
    recorded_at: new Date().toISOString(),
    cli_version: cliPkg.version,
    cli_path: 'cli/bin/agentxchain.js',
    script_path: 'examples/live-governed-proof/run-continuous-3run-proof.mjs',
    result: raw.result,
  };
  if (raw.reason) base.reason = raw.reason;
  if (raw.proof) base.proof = sanitizePayload(raw.proof);
  if (raw.provider) base.provider = raw.provider;
  if (raw.model) base.model = raw.model;
  if (raw.command) base.command = raw.command;
  return base;
}

function writePayloadFile(payload) {
  if (!outputPath) return;
  const absolutePath = resolve(process.cwd(), outputPath);
  mkdirSync(dirname(absolutePath), { recursive: true });
  writeFileSync(absolutePath, JSON.stringify(payload, null, 2) + '\n');
}

function output(data) {
  if (jsonMode) {
    process.stdout.write(JSON.stringify(data, null, 2) + '\n');
    return;
  }

  console.log(`\n=== Live Continuous 3-Run Proof: ${String(data.result).toUpperCase()} ===\n`);
  if (data.reason) console.log(`Reason: ${data.reason}`);
  if (data.command) console.log(`Command: ${data.command}`);
  if (data.proof?.continuous_session_after) {
    console.log(`Session: ${data.proof.continuous_session_after.session_id}`);
    console.log(`Runs completed: ${data.proof.continuous_session_after.runs_completed}`);
    console.log(`Spend: $${data.proof.continuous_session_after.cumulative_spent_usd}`);
  }
  if (data.workdir || data.proof?.workdir) {
    console.log(`Workdir: ${data.workdir || data.proof.workdir}`);
  }
}
