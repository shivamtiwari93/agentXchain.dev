import { afterEach, describe, it } from 'node:test';
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
import { execSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { scaffoldGoverned } from '../src/commands/init.js';

const cliRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const CLI_BIN = join(cliRoot, 'bin', 'agentxchain.js');
const MOCK_AGENT = join(cliRoot, 'test-support', 'mock-agent.mjs');

const tempDirs = [];

/**
 * Build a governed project with a `changingAgent` that writes role-specific
 * files so each turn produces real git-dirty state that must be checkpointed
 * before the next role can start with a clean baseline.
 */
function makeProject() {
  const root = mkdtempSync(join(tmpdir(), 'axc-ckpt-multirun-e2e-'));
  tempDirs.push(root);
  scaffoldGoverned(root, 'Checkpoint Multirun Vision E2E', `ckpt-multirun-e2e-${Date.now()}`);

  const configPath = join(root, 'agentxchain.json');
  const config = JSON.parse(readFileSync(configPath, 'utf8'));

  // Build the changing-agent inline: writes role-specific files BEFORE
  // delegating to the standard mock-agent so all gate files are produced.
  const agentEntry = join(root, '_changing-mock-agent.mjs');
  writeFileSync(
    agentEntry,
    [
      "import { appendFileSync, readFileSync, mkdirSync, existsSync } from 'node:fs';",
      "import { join, dirname } from 'node:path';",
      'const root = process.cwd();',
      "const index = JSON.parse(readFileSync(join(root, '.agentxchain/dispatch/index.json'), 'utf8'));",
      "const entry = Object.values(index.active_turns || {})[0] || {};",
      "const turnId = entry.turn_id || 'unknown';",
      "const phase = index.phase || 'unknown';",
      // Write role-specific files that make the working tree dirty, proving
      // the checkpoint cleared the prior run's dirty state on each handoff.
      "if (phase === 'planning') {",
      "  mkdirSync(join(root, '.planning'), { recursive: true });",
      "  appendFileSync(join(root, '.planning/ROADMAP.md'), `\\n- checkpoint ${turnId}\\n`);",
      '}',
      "if (phase === 'implementation') {",
      "  mkdirSync(join(root, 'src'), { recursive: true });",
      "  appendFileSync(join(root, 'src/output.js'), `// checkpoint ${turnId}\\n`);",
      '}',
      "if (phase === 'qa') {",
      "  mkdirSync(join(root, '.planning'), { recursive: true });",
      "  appendFileSync(join(root, '.planning/RELEASE_NOTES.md'), `\\n- checkpoint ${turnId}\\n`);",
      '}',
      // Delegate to the standard mock-agent for gate files + turn-result.json
      `await import(${JSON.stringify(MOCK_AGENT)});`,
      '',
    ].join('\n'),
  );

  const mockRuntime = {
    type: 'local_cli',
    command: process.execPath,
    args: [agentEntry],
    prompt_transport: 'dispatch_bundle_only',
  };

  for (const runtimeId of Object.keys(config.runtimes || {})) {
    config.runtimes[runtimeId] = { ...mockRuntime };
  }

  // Every role must be authoritative so turns produce real git-dirty state.
  for (const role of Object.values(config.roles || {})) {
    role.write_authority = 'authoritative';
    role.intent_coverage_mode = 'lenient';
  }
  config.intent_coverage_mode = 'lenient';

  writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n');

  mkdirSync(join(root, '.planning'), { recursive: true });
  writeFileSync(
    join(root, '.planning', 'VISION.md'),
    `# Test Vision

## Governed Delivery

- durable decision ledger
- explicit phase gates
- recovery-first blocked state handling
`,
    'utf8',
  );

  execSync('git init', { cwd: root, stdio: 'ignore' });
  execSync('git config user.email "ckpt-multirun@test.local"', { cwd: root, stdio: 'ignore' });
  execSync('git config user.name "Checkpoint Multirun Test"', { cwd: root, stdio: 'ignore' });
  execSync('git add .', { cwd: root, stdio: 'ignore' });
  execSync('git commit -m "initial"', { cwd: root, stdio: 'ignore' });
  return root;
}

function runCli(root, args, timeout = 180000) {
  const result = spawnSync(process.execPath, [CLI_BIN, ...args], {
    cwd: root,
    encoding: 'utf8',
    timeout,
    env: { ...process.env, NO_COLOR: '1', NODE_NO_WARNINGS: '1' },
  });
  return {
    status: result.status ?? 1,
    stdout: result.stdout || '',
    stderr: result.stderr || '',
    combined: `${result.stdout || ''}${result.stderr || ''}`,
  };
}

function readJson(root, relPath) {
  return JSON.parse(readFileSync(join(root, relPath), 'utf8'));
}

function readJsonl(root, relPath) {
  const raw = readFileSync(join(root, relPath), 'utf8').trim();
  if (!raw) return [];
  return raw.split('\n').filter(Boolean).map((line) => JSON.parse(line));
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('BUG-23: continuous checkpoint handoff across multiple runs', () => {
  it('AT-CONT-CKPT-002: first continuous run checkpoints all role handoffs; second run starts cleanly from checkpointed state', () => {
    const root = makeProject();

    // ── Run 1: continuous session with auto-checkpoint ────────────────────────
    const run1 = runCli(root, [
      'run',
      '--continuous',
      '--vision',
      '.planning/VISION.md',
      '--max-runs',
      '1',
      '--auto-checkpoint',
      '--max-idle-cycles',
      '1',
      '--poll-seconds',
      '0',
    ]);

    assert.equal(
      run1.status,
      0,
      `first continuous run failed:\n${run1.combined}`,
    );

    // No "clean baseline" errors — checkpoints cleared dirty state between handoffs.
    assert.doesNotMatch(
      run1.combined,
      /Authoritative\/proposed turns require a clean baseline/,
      'clean-baseline error must not appear in run 1',
    );
    assert.doesNotMatch(
      run1.combined,
      /checkpoint-turn --turn/,
      'manual checkpoint prompt must not appear — auto-checkpoint must handle all handoffs',
    );

    // Run 1 session completed
    const session1 = readJson(root, '.agentxchain/continuous-session.json');
    assert.equal(session1.status, 'completed', `run 1 session must complete, got: ${session1.status}`);
    assert.equal(session1.runs_completed, 1);

    // Run 1 produced checkpoint commits for each role
    const log1 = execSync('git log --pretty=%s', { cwd: root, encoding: 'utf8' })
      .trim().split('\n').filter(Boolean);
    const ckpt1 = log1.filter((line) => line.startsWith('checkpoint: '));
    assert.ok(ckpt1.length >= 3, `run 1 must produce at least 3 checkpoints (pm+dev+qa), got ${ckpt1.length}`);
    assert.ok(ckpt1.some((s) => s.includes('role=pm')), 'run 1 must checkpoint pm');
    assert.ok(ckpt1.some((s) => s.includes('role=dev')), 'run 1 must checkpoint dev');
    assert.ok(ckpt1.some((s) => s.includes('role=qa')), 'run 1 must checkpoint qa');

    // Run 1 produced checkpoint events
    const events1 = readJsonl(root, '.agentxchain/events.jsonl');
    const ckptEvents1 = events1.filter((e) => e.event_type === 'turn_checkpointed');
    assert.ok(ckptEvents1.length >= 3, `run 1 must emit at least 3 turn_checkpointed events, got ${ckptEvents1.length}`);

    // ── Run 2: standalone governed run from checkpointed state ─────────────
    // This is the BUG-23 proof: after checkpointed multi-role continuous
    // execution, a fresh governed run starts without "clean baseline" errors.
    // Commit remaining dirty state (TALK.md, .agentxchain/) to match what
    // an operator would do between sessions.
    execSync('git add -A && git commit -m "inter-session cleanup" --allow-empty', {
      cwd: root, stdio: 'ignore',
    });

    const run2 = runCli(root, ['run', '--auto-checkpoint']);

    assert.equal(
      run2.status,
      0,
      `second governed run must start cleanly from checkpointed state:\n${run2.combined}`,
    );

    // The critical assertion: NO baseline errors on the second run
    assert.doesNotMatch(
      run2.combined,
      /Authoritative\/proposed turns require a clean baseline/,
      'second run must not see baseline errors — run 1 checkpoints must have cleared all dirty state',
    );

    // Run 1's checkpoints must still be in git log (not lost by run 2)
    const logAll = execSync('git log --pretty=%s', { cwd: root, encoding: 'utf8' })
      .trim().split('\n').filter(Boolean);
    const ckptAll = logAll.filter((line) => line.startsWith('checkpoint: '));
    assert.ok(
      ckptAll.length >= 3,
      `run 1 checkpoints must persist through run 2, got ${ckptAll.length}`,
    );
    assert.ok(ckptAll.some((s) => s.includes('role=pm')), 'pm checkpoint persists');
    assert.ok(ckptAll.some((s) => s.includes('role=dev')), 'dev checkpoint persists');
    assert.ok(ckptAll.some((s) => s.includes('role=qa')), 'qa checkpoint persists');
  });
});
