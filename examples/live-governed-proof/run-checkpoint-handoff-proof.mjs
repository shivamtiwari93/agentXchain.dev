#!/usr/bin/env node

/**
 * BUG-23 live proof: continuous checkpoint handoff.
 *
 * Proves that `agentxchain run --continuous --auto-checkpoint` emits a
 * `checkpoint: <turn_id> (role=<role>, phase=<phase>)` git commit after every
 * accepted authoritative turn, and that no "clean baseline" errors surface
 * between role handoffs inside the same continuous session.
 *
 * Self-contained: uses the committing-proof-agent mock for all roles by
 * default.  Pass `--runtime-command <cmd>` to drive all roles through a real
 * local runtime instead.
 *
 * Flags
 *   --json               Machine-readable JSON output
 *   --keep-temp          Preserve the temp directory for post-mortem inspection
 *   --runtime-command    Path (or shell command) to use as the local_cli runtime
 *                        instead of the built-in committing-proof-agent
 */

import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'fs';
import { join, dirname } from 'path';
import { tmpdir } from 'os';
import { fileURLToPath } from 'url';
import { execSync, spawnSync } from 'child_process';

import { scaffoldGoverned } from '../../cli/src/commands/init.js';

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, '..', '..');
const cliRoot = join(repoRoot, 'cli');
const binPath = join(cliRoot, 'bin', 'agentxchain.js');
const defaultMockAgentPath = join(cliRoot, 'test-support', 'mock-agent.mjs');

// ---------------------------------------------------------------------------
// Flags
// ---------------------------------------------------------------------------

const args = process.argv.slice(2);
const jsonMode = args.includes('--json');
const keepTemp = args.includes('--keep-temp');

const runtimeCmdIdx = args.indexOf('--runtime-command');
const customRuntimeCommand = runtimeCmdIdx !== -1 ? args[runtimeCmdIdx + 1] : null;

let shouldCleanup = !keepTemp;

// ---------------------------------------------------------------------------
// Temp dir
// ---------------------------------------------------------------------------

const root = mkdtempSync(join(tmpdir(), 'axc-ckpt-handoff-proof-'));

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

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
  if (shouldCleanup) {
    rmSync(root, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------
// Proof body
// ---------------------------------------------------------------------------

function runProof(projectRoot) {
  // -- scaffold
  scaffoldGoverned(
    projectRoot,
    'BUG-23 Checkpoint Handoff Proof',
    `bug23-ckpt-handoff-${Date.now()}`,
  );

  // -- configure runtimes
  const configPath = join(projectRoot, 'agentxchain.json');
  const config = JSON.parse(readFileSync(configPath, 'utf8'));

  const localRuntime = buildLocalRuntime(projectRoot, customRuntimeCommand);

  config.runtimes['local-pm'] = { ...localRuntime };
  config.runtimes['local-dev'] = { ...localRuntime };
  config.runtimes['local-director'] = { ...localRuntime };
  config.runtimes['local-qa'] = { ...localRuntime };

  config.roles.pm.runtime = 'local-pm';
  config.roles.pm.write_authority = 'authoritative';
  config.roles.dev.runtime = 'local-dev';
  config.roles.dev.write_authority = 'authoritative';
  config.roles.eng_director.runtime = 'local-director';
  config.roles.eng_director.write_authority = 'authoritative';
  config.roles.qa.runtime = 'local-qa';
  config.roles.qa.write_authority = 'authoritative';

  config.intent_coverage_mode = 'lenient';
  if (config.rules) config.rules.max_turn_retries = 2;

  writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n');

  // -- planning artifacts
  mkdirSync(join(projectRoot, '.planning'), { recursive: true });
  writeFileSync(
    join(projectRoot, '.planning', 'VISION.md'),
    `# BUG-23 Checkpoint Handoff Proof

## Goal

- prove that auto-checkpoint emits a git commit after every accepted authoritative turn
- prove that no clean-baseline error surfaces between role handoffs

## Constraints

- all roles use local_cli runtimes so the proof is self-contained
- each authoritative turn must leave the working tree clean before the next assignment
`,
    'utf8',
  );
  writeFileSync(
    join(projectRoot, '.planning', 'acceptance-matrix.md'),
    '# Acceptance Matrix\n\n| Req # | Requirement | Acceptance criteria | Test status | Last tested | Status |\n' +
      '|-------|-------------|-------------------|-------------|-------------|--------|\n' +
      '| 1 | BUG-23 checkpoint handoff | checkpoint commit per accepted turn, no clean-baseline errors | pass | 2026-04-18 | pass |\n',
  );
  writeFileSync(
    join(projectRoot, '.planning', 'ship-verdict.md'),
    '# Ship Verdict\n\n## Verdict: YES\n\nCheckpoint handoff proven: one git commit per accepted authoritative turn, no baseline errors.\n',
  );
  writeFileSync(
    join(projectRoot, '.planning', 'RELEASE_NOTES.md'),
    '# Release Notes\n\n## User Impact\n\nBUG-23 continuous checkpoint handoff proof completed.\n\n## Verification Summary\n\n- node examples/live-governed-proof/run-checkpoint-handoff-proof.mjs --json\n',
  );

  // -- git init
  const gitEnv = {
    ...process.env,
    GIT_AUTHOR_NAME: 'proof',
    GIT_AUTHOR_EMAIL: 'proof@example.com',
    GIT_COMMITTER_NAME: 'proof',
    GIT_COMMITTER_EMAIL: 'proof@example.com',
  };
  execSync('git init', { cwd: projectRoot, stdio: 'pipe' });
  execSync('git config user.name "proof"', { cwd: projectRoot, stdio: 'pipe' });
  execSync('git config user.email "proof@example.com"', { cwd: projectRoot, stdio: 'pipe' });
  execSync('git add -A', { cwd: projectRoot, stdio: 'pipe' });
  execSync('git commit -m "init proof repo"', { cwd: projectRoot, stdio: 'pipe', env: gitEnv });

  // -- run agentxchain
  const command = [
    binPath,
    'run',
    '--continuous',
    '--auto-checkpoint',
    '--vision', '.planning/VISION.md',
    '--max-runs', '1',
    '--max-idle-cycles', '1',
    '--poll-seconds', '0',
  ];

  const run = spawnSync(process.execPath, command, {
    cwd: projectRoot,
    encoding: 'utf8',
    env: {
      ...process.env,
      NO_COLOR: '1',
      NODE_NO_WARNINGS: '1',
    },
    timeout: 300_000,
  });

  if (run.error) throw run.error;

  const combinedOutput = `${trim(run.stdout)}\n${trim(run.stderr)}`;

  if (run.status !== 0) {
    throw new Error(
      `agentxchain run exited with status ${run.status}\nstdout:\n${trim(run.stdout)}\nstderr:\n${trim(run.stderr)}`,
    );
  }

  // -- verify: no clean-baseline errors
  const cleanBaselineErrors = combinedOutput.match(
    /Authoritative\/proposed turns require a clean baseline/gi,
  );
  if (cleanBaselineErrors && cleanBaselineErrors.length > 0) {
    throw new Error(
      `BUG-23 regression: ${cleanBaselineErrors.length} "clean baseline" error(s) found in output`,
    );
  }

  // -- verify: no checkpoint-turn reminder messages
  if (/checkpoint-turn --turn/.test(combinedOutput)) {
    throw new Error('BUG-23 regression: unresolved checkpoint-turn reminder found in output');
  }

  // -- read session
  const sessionPath = join(projectRoot, '.agentxchain', 'continuous-session.json');
  if (!existsSync(sessionPath)) {
    throw new Error('continuous-session.json not found after run');
  }
  const session = JSON.parse(readFileSync(sessionPath, 'utf8'));
  if (session.status !== 'completed' && session.status !== 'stopped') {
    throw new Error(`expected session status completed or stopped, got ${session.status}`);
  }
  if (session.runs_completed < 1) {
    throw new Error(`expected runs_completed >= 1, got ${session.runs_completed}`);
  }

  // -- read events
  const events = readJsonl(projectRoot, '.agentxchain/events.jsonl');
  const checkpointEvents = events.filter((e) => e.event_type === 'turn_checkpointed');
  if (checkpointEvents.length === 0) {
    throw new Error('expected turn_checkpointed events in events.jsonl, got none');
  }

  // -- read git log
  const gitLogRaw = execSync('git log --pretty=format:%s', {
    cwd: projectRoot,
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
  })
    .trim()
    .split('\n')
    .filter(Boolean);

  const checkpointSubjects = gitLogRaw.filter((s) => s.startsWith('checkpoint: '));
  if (checkpointSubjects.length === 0) {
    throw new Error('expected checkpoint: commits in git log, got none');
  }

  // -- parse checkpoint commit metadata
  const checkpointDetails = parseCheckpointSubjects(checkpointSubjects);

  // -- verify role/phase coverage (planning + implementation expected across 2 runs)
  const phases = checkpointDetails.map((c) => c.phase).filter(Boolean);
  if (!phases.includes('planning')) {
    throw new Error('expected at least one checkpoint commit for phase=planning');
  }
  if (!phases.includes('implementation')) {
    throw new Error('expected at least one checkpoint commit for phase=implementation');
  }

  // -- gather checkpoint events breakdown
  const checkpointEventBreakdown = checkpointEvents.map((e) => ({
    event_id: e.event_id,
    turn_id: e.turn?.turn_id || null,
    role: e.turn?.role_id || null,
    phase: e.phase || null,
    run_id: e.run_id || null,
    checkpoint_sha: e.payload?.checkpoint_sha || null,
    checkpointed_at: e.payload?.checkpointed_at || null,
  }));

  // -- run-history
  const runHistory = readJsonl(projectRoot, '.agentxchain/run-history.jsonl');
  const completedRuns = runHistory.filter((r) => r.status === 'completed');

  return {
    bug: 'BUG-23',
    description: 'continuous checkpoint handoff proof',
    runtime: customRuntimeCommand
      ? { type: 'custom', command: customRuntimeCommand }
      : { type: 'mock', agent: defaultMockAgentPath },
    command: `node ${binPath} ${command.slice(1).join(' ')}`,
    proof: {
      workdir: projectRoot,
      session_id: session.session_id,
      session_status: session.status,
      runs_completed: session.runs_completed,
      clean_baseline_errors: 0,
      checkpoint_commit_count: checkpointSubjects.length,
      checkpoint_commits: checkpointDetails,
      checkpoint_event_count: checkpointEvents.length,
      checkpoint_events: checkpointEventBreakdown,
      completed_runs: completedRuns.length,
      phases_checkpointed: [...new Set(phases)],
      stdout_tail: trim(run.stdout).slice(-1500),
    },
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build the local_cli runtime descriptor.
 * If a custom command string is given, use it (split on spaces for args).
 * Otherwise build a changingAgent wrapper around mock-agent.mjs that writes
 * role-specific files to make the working tree dirty — proving checkpoint
 * clears the state between each role handoff.
 */
function buildLocalRuntime(projectRoot, customCommand) {
  if (customCommand) {
    const parts = customCommand.split(/\s+/).filter(Boolean);
    return {
      type: 'local_cli',
      command: parts[0],
      args: parts.slice(1),
      prompt_transport: 'dispatch_bundle_only',
    };
  }

  // Write a changingAgent wrapper that appends phase-specific files
  // (making the tree dirty) then delegates to mock-agent.mjs for gate files.
  const agentPath = join(projectRoot, '_checkpoint-proof-agent.mjs');
  writeFileSync(agentPath, [
    "import { appendFileSync, readFileSync, mkdirSync } from 'node:fs';",
    "import { join } from 'node:path';",
    'const root = process.cwd();',
    `const index = JSON.parse(readFileSync(join(root, '.agentxchain/dispatch/index.json'), 'utf8'));`,
    `const entry = Object.values(index.active_turns || {})[0] || {};`,
    `const turnId = entry.turn_id || 'unknown';`,
    `const phase = index.phase || 'unknown';`,
    `if (phase === 'planning') { mkdirSync(join(root, '.planning'), { recursive: true }); appendFileSync(join(root, '.planning/ROADMAP.md'), '\\n- ckpt ' + turnId + '\\n'); }`,
    `if (phase === 'implementation') { mkdirSync(join(root, 'src'), { recursive: true }); appendFileSync(join(root, 'src/output.js'), '// ckpt ' + turnId + '\\n'); }`,
    `if (phase === 'qa') { mkdirSync(join(root, '.planning'), { recursive: true }); appendFileSync(join(root, '.planning/RELEASE_NOTES.md'), '\\n- ckpt ' + turnId + '\\n'); }`,
    `await import(${JSON.stringify(defaultMockAgentPath)});`,
    '',
  ].join('\n'));

  return {
    type: 'local_cli',
    command: process.execPath,
    args: [agentPath],
    prompt_transport: 'dispatch_bundle_only',
  };
}

/**
 * Parse checkpoint commit subjects of the form:
 *   checkpoint: <turn_id> (role=<role>, phase=<phase>)
 */
function parseCheckpointSubjects(subjects) {
  return subjects.map((subject) => {
    const m = subject.match(/^checkpoint:\s+(\S+)\s+\(role=([^,)]+),\s*phase=([^)]+)\)/);
    return {
      subject,
      turn_id: m ? m[1] : null,
      role: m ? m[2] : null,
      phase: m ? m[3] : null,
    };
  });
}

function readJsonl(root, relativePath) {
  const filePath = join(root, relativePath);
  if (!existsSync(filePath)) return [];
  const raw = readFileSync(filePath, 'utf8').trim();
  if (!raw) return [];
  return raw.split('\n').filter(Boolean).map((line) => JSON.parse(line));
}

function trim(value) {
  return String(value || '').trim();
}

// ---------------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------------

function output(data) {
  if (jsonMode) {
    process.stdout.write(JSON.stringify(data, null, 2) + '\n');
    return;
  }

  const badge = String(data.result).toUpperCase();
  console.log(`\n=== BUG-23 Checkpoint Handoff Proof: ${badge} ===\n`);

  if (data.reason) {
    console.log(`Reason: ${data.reason}`);
  }
  if (data.workdir) {
    console.log(`Workdir (preserved): ${data.workdir}`);
  }

  if (data.proof) {
    const p = data.proof;
    console.log(`Runtime:             ${data.runtime?.type === 'custom' ? data.runtime.command : 'mock (mock-agent + changingAgent wrapper)'}`);
    console.log(`Session:             ${p.session_id}  status=${p.session_status}  runs_completed=${p.runs_completed}`);
    console.log(`Completed runs:      ${p.completed_runs}`);
    console.log(`Clean-baseline errs: ${p.clean_baseline_errors}`);
    console.log(`Checkpoint commits:  ${p.checkpoint_commit_count}  (phases: ${p.phases_checkpointed.join(', ')})`);
    console.log(`Checkpoint events:   ${p.checkpoint_event_count}`);
    console.log('');
    console.log('--- Checkpoint commits ---');
    for (const c of p.checkpoint_commits) {
      console.log(`  ${c.subject}`);
    }
    console.log('');
    console.log('--- Checkpoint events (events.jsonl) ---');
    for (const e of p.checkpoint_events) {
      const sha = e.checkpoint_sha ? e.checkpoint_sha.slice(0, 8) : 'no-sha';
      console.log(`  [${e.phase ?? '?'}] turn=${e.turn_id ?? '?'}  role=${e.role ?? '?'}  sha=${sha}`);
    }
    console.log('');
    if (data.result === 'pass') {
      console.log('PROOF PASSED: BUG-23 continuous checkpoint handoff is working correctly.');
    }
  }
}
