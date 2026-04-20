/**
 * Claim-reality preflight gate — discipline rule from HUMAN-ROADMAP.md.
 *
 * Verifies that every source file imported by beta-tester-scenario tests
 * is included in the npm-packed tarball. This catches the "source passes,
 * published binary fails" class of bug where tests exercise code that
 * isn't shipped. For BUG-46, the gate also executes a packaged-tarball
 * proof to ensure the shipped CLI both rejects the tester's exact bad state
 * cleanly and survives the repaired accept/checkpoint/resume seam.
 *
 * This file intentionally also hosts lightweight packaged behavioral smokes
 * for release-blocking beta bugs. That is not drift; it is the release-boundary
 * proof surface for "works from source, broken when built."
 *
 * Runs as part of the release-gate test suite.
 */

import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { join, resolve, dirname, relative } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync, execSync, spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const CLI_DIR = resolve(import.meta.dirname, '..');
const SCENARIOS_DIR = join(import.meta.dirname, 'beta-tester-scenarios');
const TEMP_PATHS = [];

const BUG46_REPLAY_SIDE_EFFECT_PATHS = [
  '.planning/RELEASE_NOTES.md',
  '.planning/acceptance-matrix.md',
  '.planning/ship-verdict.md',
  'tests/fixtures/express-sample/tusq.manifest.json',
  'tests/fixtures/express-sample/tusq-tools/get_users_users.json',
  'tests/fixtures/express-sample/tusq-tools/index.json',
  'tests/fixtures/express-sample/tusq-tools/post_users_users.json',
];

const BUG46_REPLAY_SIDE_EFFECT_SCRIPT = [
  "const { mkdirSync, writeFileSync } = require('node:fs');",
  "mkdirSync('.planning', { recursive: true });",
  "mkdirSync('tests/fixtures/express-sample/tusq-tools', { recursive: true });",
  "writeFileSync('.planning/RELEASE_NOTES.md', '# replay release notes\\n');",
  "writeFileSync('.planning/acceptance-matrix.md', '# replay acceptance matrix\\n');",
  "writeFileSync('.planning/ship-verdict.md', '# replay ship verdict\\n');",
  "writeFileSync('tests/fixtures/express-sample/tusq.manifest.json', '{\\\"ok\\\":true}\\n');",
  "writeFileSync('tests/fixtures/express-sample/tusq-tools/get_users_users.json', '{\\\"name\\\":\\\"get_users_users\\\"}\\n');",
  "writeFileSync('tests/fixtures/express-sample/tusq-tools/index.json', '{\\\"name\\\":\\\"index\\\"}\\n');",
  "writeFileSync('tests/fixtures/express-sample/tusq-tools/post_users_users.json', '{\\\"name\\\":\\\"post_users_users\\\"}\\n');",
].join(' ');

const BUG46_REPLAY_COMMAND = `${JSON.stringify(process.execPath)} -e ${JSON.stringify(BUG46_REPLAY_SIDE_EFFECT_SCRIPT)}`;
const BUG46_TESTER_RUN_ID = 'run_c8a4701ce0d4952d';
const BUG46_TESTER_TURN_ID = 'turn_e015ce32fdafc9c5';
const BUG45_TESTER_INTENT_ID = 'intent_1776535590576_a157';
const BUG45_TESTER_EVENT_ID = 'evt_bug45_packed';

let packedFilesCache = null;
let extractedPackageCache = null;

after(() => {
  while (TEMP_PATHS.length > 0) {
    rmSync(TEMP_PATHS.pop(), { recursive: true, force: true });
  }
});

function getPackedFiles() {
  if (packedFilesCache) {
    return packedFilesCache;
  }
  const output = execSync('npm pack --dry-run --json 2>/dev/null', {
    cwd: CLI_DIR,
    encoding: 'utf8',
    timeout: 30000,
  });
  const data = JSON.parse(output);
  packedFilesCache = new Set(data[0].files.map(f => f.path));
  return packedFilesCache;
}

function getExtractedPackage() {
  if (extractedPackageCache) {
    return extractedPackageCache;
  }

  const output = execSync('npm pack --json', {
    cwd: CLI_DIR,
    encoding: 'utf8',
    timeout: 30000,
  });
  const data = JSON.parse(output);
  const tarballPath = join(CLI_DIR, data[0].filename);
  TEMP_PATHS.push(tarballPath);

  const extractDir = mkdtempSync(join(tmpdir(), 'axc-packed-cli-'));
  TEMP_PATHS.push(extractDir);
  execFileSync('tar', ['-xzf', tarballPath, '-C', extractDir], {
    cwd: CLI_DIR,
    stdio: ['ignore', 'ignore', 'ignore'],
  });

  const packageDir = join(extractDir, 'package');
  // Symlink source-tree node_modules into the extracted tarball so packaged
  // imports can resolve dependencies. This is valid because AgentXchain has
  // zero native/binary dependencies and no optional peer deps today — the
  // dependency tree is identical between source `npm install` and a fresh
  // `npm install` of the published package. If native deps are ever added
  // (e.g., better-sqlite3), this symlink strategy must be replaced with a
  // real `npm install` of the tarball to catch platform-specific resolution
  // differences.
  const rootNodeModules = join(CLI_DIR, 'node_modules');
  const packagedNodeModules = join(packageDir, 'node_modules');
  if (existsSync(rootNodeModules) && !existsSync(packagedNodeModules)) {
    symlinkSync(rootNodeModules, packagedNodeModules, 'dir');
  }

  extractedPackageCache = {
    packageDir,
  };
  return extractedPackageCache;
}

function extractImports(filePath) {
  const content = readFileSync(filePath, 'utf8');
  const imports = [];
  // Match: import ... from '../../src/...'
  // Match: require('../../src/...')
  const importRegex = /(?:import\s+.*?from\s+['"]|require\s*\(\s*['"])(\.\.[/\\].*?)['")]/g;
  let match;
  while ((match = importRegex.exec(content)) !== null) {
    const importPath = match[1];
    // Resolve relative to the test file's directory
    const resolvedPath = resolve(dirname(filePath), importPath);
    // Convert to relative path from CLI_DIR
    const relPath = relative(CLI_DIR, resolvedPath);
    // Only track imports that resolve to src/ (production code)
    if (relPath.startsWith('src/')) {
      imports.push(relPath);
    }
  }
  return imports;
}

function git(cwd, args) {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

function makeBug46Config() {
  return {
    schema_version: '1.0',
    protocol_mode: 'governed',
    template: 'generic',
    project: { id: 'bug46-packed-test', name: 'BUG-46 Packed Test', default_branch: 'main' },
    roles: {
      qa: {
        title: 'QA',
        mandate: 'Verify and ship.',
        write_authority: 'authoritative',
        runtime: 'local-qa',
      },
    },
    runtimes: {
      'local-qa': {
        type: 'local_cli',
        command: process.execPath,
        args: ['-e', 'process.exit(0)'],
        prompt_transport: 'dispatch_bundle_only',
      },
    },
    routing: {
      qa: { entry_role: 'qa', allowed_next_roles: ['qa'], exit_gate: 'qa_complete' },
    },
    gates: {
      qa_complete: {},
    },
    policies: [
      { id: 'replay-proof', rule: 'require_reproducible_verification', action: 'block' },
    ],
  };
}

function makeBug45Config() {
  return {
    schema_version: '1.0',
    protocol_mode: 'governed',
    template: 'generic',
    project: { id: 'bug45-packed', name: 'BUG-45 Packed', default_branch: 'main' },
    roles: {
      pm: {
        title: 'Product Marketing',
        mandate: 'Consolidate.',
        write_authority: 'authoritative',
        runtime: 'r-pm',
      },
    },
    runtimes: {
      'r-pm': {
        type: 'local_cli',
        command: process.execPath,
        args: ['-e', 'process.exit(0)'],
        prompt_transport: 'dispatch_bundle_only',
      },
    },
    routing: {
      qa: { entry_role: 'pm', allowed_next_roles: ['pm'], exit_gate: 'qa_ship_verdict' },
    },
    gates: { qa_ship_verdict: {} },
  };
}

function makeTempGitRepo() {
  const root = mkdtempSync(join(tmpdir(), 'axc-packed-bug46-'));
  TEMP_PATHS.push(root);
  mkdirSync(join(root, '.planning'), { recursive: true });
  writeFileSync(join(root, 'README.md'), '# BUG-46 packed smoke\n');
  writeFileSync(join(root, 'agentxchain.json'), JSON.stringify(makeBug46Config(), null, 2) + '\n');

  git(root, ['init', '-b', 'main']);
  git(root, ['config', 'user.email', 'test@test.com']);
  git(root, ['config', 'user.name', 'Test']);
  git(root, ['add', 'README.md', 'agentxchain.json']);
  git(root, ['commit', '-m', 'init']);
  return root;
}

function makeTempBug45Repo() {
  const root = mkdtempSync(join(tmpdir(), 'axc-packed-bug45-'));
  TEMP_PATHS.push(root);
  const config = makeBug45Config();

  mkdirSync(join(root, '.planning'), { recursive: true });
  writeFileSync(join(root, 'README.md'), '# BUG-45 packed\n');
  writeFileSync(
    join(root, '.planning', 'IMPLEMENTATION_NOTES.md'),
    '# Implementation Notes\n\n## Summary\n- Consolidation\n\n## Changes\n- Done\n',
  );
  writeFileSync(join(root, 'agentxchain.json'), JSON.stringify(config, null, 2) + '\n');
  git(root, ['init', '-b', 'main']);
  git(root, ['config', 'user.email', 'test@test.com']);
  git(root, ['config', 'user.name', 'Test']);
  git(root, ['add', '.']);
  git(root, ['commit', '-m', 'init']);
  return { root, config };
}

function seedBug45ExecutingIntent(root, runId) {
  mkdirSync(join(root, '.agentxchain', 'intake', 'events'), { recursive: true });
  mkdirSync(join(root, '.agentxchain', 'intake', 'intents'), { recursive: true });
  writeFileSync(join(root, '.agentxchain', 'intake', 'events', `${BUG45_TESTER_EVENT_ID}.json`), JSON.stringify({
    schema_version: '1.0',
    event_id: BUG45_TESTER_EVENT_ID,
    source: 'manual',
    category: 'operator_injection',
    created_at: '2026-04-19T01:00:00.000Z',
    signal: { description: 'live-site consolidation', injected: true, priority: 'p0' },
    evidence: [{ type: 'text', value: 'packed BUG-45' }],
    dedup_key: 'manual:bug45-packed',
  }, null, 2));
  writeFileSync(join(root, '.agentxchain', 'intake', 'intents', `${BUG45_TESTER_INTENT_ID}.json`), JSON.stringify({
    schema_version: '1.0',
    intent_id: BUG45_TESTER_INTENT_ID,
    event_id: BUG45_TESTER_EVENT_ID,
    status: 'executing',
    priority: 'p0',
    template: 'generic',
    charter: 'website/ reflects the current live website content',
    acceptance_contract: [
      'website/ reflects the current live website content',
      '.planning/IMPLEMENTATION_NOTES.md contains ## Changes',
    ],
    phase_scope: null,
    approved_run_id: runId,
    target_run: runId,
    cross_run_durable: false,
    created_at: '2026-04-19T01:00:00.000Z',
    updated_at: '2026-04-19T01:00:00.000Z',
    history: [
      { from: 'approved', to: 'planned', at: '2026-04-19T01:00:00.000Z', reason: 'dispatched' },
      { from: 'planned', to: 'executing', at: '2026-04-19T01:00:00.000Z', reason: 'governed execution started' },
    ],
  }, null, 2));
}

function materializeBug46ReplaySideEffects(root) {
  mkdirSync(join(root, '.planning'), { recursive: true });
  mkdirSync(join(root, 'tests', 'fixtures', 'express-sample', 'tusq-tools'), { recursive: true });
  writeFileSync(join(root, '.planning', 'RELEASE_NOTES.md'), '# replay release notes\n');
  writeFileSync(join(root, '.planning', 'acceptance-matrix.md'), '# replay acceptance matrix\n');
  writeFileSync(join(root, '.planning', 'ship-verdict.md'), '# replay ship verdict\n');
  writeFileSync(join(root, 'tests', 'fixtures', 'express-sample', 'tusq.manifest.json'), '{"ok":true}\n');
  writeFileSync(join(root, 'tests', 'fixtures', 'express-sample', 'tusq-tools', 'get_users_users.json'), '{"name":"get_users_users"}\n');
  writeFileSync(join(root, 'tests', 'fixtures', 'express-sample', 'tusq-tools', 'index.json'), '{"name":"index"}\n');
  writeFileSync(join(root, 'tests', 'fixtures', 'express-sample', 'tusq-tools', 'post_users_users.json'), '{"name":"post_users_users"}\n');
}

function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, 'utf8'));
}

function rewriteActiveTurnState(root, { runId, phase, turnId, roleId = 'qa' }) {
  const statePath = join(root, '.agentxchain', 'state.json');
  const state = readJson(statePath);
  const [existingTurnId] = Object.keys(state.active_turns || {});
  assert.ok(existingTurnId, 'packed BUG-46 smoke must start with an assigned turn');
  const existingTurn = state.active_turns[existingTurnId];
  assert.ok(existingTurn, 'packed BUG-46 smoke missing active turn state');

  state.run_id = runId;
  state.phase = phase;
  state.active_turns = {
    [turnId]: {
      ...existingTurn,
      turn_id: turnId,
      assigned_role: roleId,
    },
  };

  writeFileSync(statePath, JSON.stringify(state, null, 2) + '\n');
}

describe('claim-reality preflight', () => {
  it('all production imports used by beta-tester-scenario tests are in the npm tarball', () => {
    const packedFiles = getPackedFiles();
    const scenarioFiles = readdirSync(SCENARIOS_DIR)
      .filter(f => f.endsWith('.test.js'))
      .map(f => join(SCENARIOS_DIR, f));

    const missingFiles = [];

    for (const scenarioFile of scenarioFiles) {
      const imports = extractImports(scenarioFile);
      for (const imp of imports) {
        if (!packedFiles.has(imp)) {
          missingFiles.push({
            scenario: relative(CLI_DIR, scenarioFile),
            import: imp,
          });
        }
      }
    }

    if (missingFiles.length > 0) {
      const details = missingFiles.map(m =>
        `  ${m.scenario} imports ${m.import}`
      ).join('\n');
      assert.fail(
        `${missingFiles.length} production file(s) imported by beta-tester-scenario ` +
        `tests are NOT included in the npm tarball.\n\n` +
        `This means the tests pass against the source tree but the published ` +
        `package is missing these files. Either add the missing paths to the ` +
        `"files" field in package.json, or fix the import path.\n\n${details}`
      );
    }
  });

  it('tarball includes all core lib modules', () => {
    const packedFiles = getPackedFiles();
    // These are the production files most commonly used by beta scenarios
    const criticalFiles = [
      'src/lib/governed-state.js',
      'src/lib/gate-evaluator.js',
      'src/lib/dispatch-bundle.js',
      'src/lib/intake.js',
      'src/lib/verification-replay.js',
      'src/lib/workflow-gate-semantics.js',
      'src/lib/intent-phase-scope.js',
      'src/lib/intent-startup-migration.js',
    ];
    const missing = criticalFiles.filter(f => !packedFiles.has(f));
    assert.equal(missing.length, 0,
      `Critical lib files missing from tarball: ${missing.join(', ')}`);
  });

  it('BUG-44 continuous command-path proof exists and its production imports are packed', () => {
    const packedFiles = getPackedFiles();
    const bug44ContinuousTest = join(SCENARIOS_DIR, 'bug-44-continue-from-continuous.test.js');
    const imports = extractImports(bug44ContinuousTest);
    // The test must import at least intake.js (for intent seeding) from production
    assert.ok(imports.length > 0,
      'BUG-44 continuous command-path test must import production modules');
    const missing = imports.filter(imp => !packedFiles.has(imp));
    assert.equal(missing.length, 0,
      `BUG-44 continuous test imports production files missing from tarball: ${missing.join(', ')}`);
    // Verify the test file itself exists (guards against accidental deletion)
    const testContent = readFileSync(bug44ContinuousTest, 'utf8');
    assert.ok(testContent.includes('--continue-from') && testContent.includes('--continuous'),
      'BUG-44 continuous test must exercise the exact tester command shape');
  });

  it('BUG-45 retained-turn reconciliation proof exists and its production imports are packed', () => {
    const packedFiles = getPackedFiles();
    const bug45Test = join(SCENARIOS_DIR, 'bug-45-retained-turn-stale-intent-coverage.test.js');
    const imports = extractImports(bug45Test);
    assert.ok(imports.length > 0,
      'BUG-45 retained-turn reconciliation test must import production modules');
    const missing = imports.filter(imp => !packedFiles.has(imp));
    assert.equal(missing.length, 0,
      `BUG-45 retained-turn test imports production files missing from tarball: ${missing.join(', ')}`);
    const testContent = readFileSync(bug45Test, 'utf8');
    assert.ok(testContent.includes('accept-turn') && testContent.includes('--outcome') && testContent.includes('HUMAN_TASKS.md'),
      'BUG-45 test must cover accept-turn reconciliation, intake resolve override, and HUMAN_TASKS.md drift');
  });

  it('BUG-46 post-acceptance deadlock proof exists and its production imports are packed', () => {
    const packedFiles = getPackedFiles();
    const bug46Test = join(SCENARIOS_DIR, 'bug-46-post-acceptance-deadlock.test.js');
    const imports = extractImports(bug46Test);
    assert.ok(imports.length > 0,
      'BUG-46 post-acceptance deadlock test must import production modules');
    const missing = imports.filter(imp => !packedFiles.has(imp));
    assert.equal(missing.length, 0,
      `BUG-46 test imports production files missing from tarball: ${missing.join(', ')}`);
    const testContent = readFileSync(bug46Test, 'utf8');
    assert.ok(testContent.includes('accept-turn') && testContent.includes('checkpoint-turn') && testContent.includes('resume'),
      'BUG-46 test must cover the accept-turn/checkpoint-turn/resume deadlock seam');
    assert.ok(testContent.includes('require_reproducible_verification') && testContent.includes('authoritative'),
      'BUG-46 test must exercise reproducible-verification replay on an authoritative role');
    assert.ok(testContent.includes('run_c8a4701ce0d4952d') && testContent.includes('turn_e015ce32fdafc9c5'),
      'BUG-46 test must pin the tester\'s exact run/turn identity');
    assert.ok(testContent.includes('.planning/RELEASE_NOTES.md')
      && testContent.includes('tests/fixtures/express-sample/tusq.manifest.json'),
    'BUG-46 test must cover the tester\'s exact repo mutation shape');
    assert.match(testContent, /artifact\\\.type: "workspace" but files_changed is empty/,
      'BUG-46 test must prove the exact-state rejection');
    assert.match(testContent, /checkCleanBaseline/,
      'BUG-46 test must prove the clean-baseline invariant');
  });

  it('BUG-46 packaged tarball contains the legacy checkpoint recovery implementation', () => {
    const { packageDir } = getExtractedPackage();
    const packedTurnCheckpoint = readFileSync(join(packageDir, 'src/lib/turn-checkpoint.js'), 'utf8');
    assert.match(packedTurnCheckpoint, /function recoverLegacyCheckpointFiles/,
      'packed turn-checkpoint.js must ship the legacy recovery helper');
    assert.match(packedTurnCheckpoint, /files_changed_recovery_source:\s*'legacy_dirty_worktree'/,
      'packed turn-checkpoint.js must persist recovery metadata for repaired history');
    assert.match(packedTurnCheckpoint, /legacy-empty files_changed history/,
      'packed turn-checkpoint.js must ship the legacy pending-checkpoint guidance');
  });

  it('BUG-46 packaged CLI rejects the tester exact-state payload without leaving replay-only dirt', async () => {
    const { packageDir } = getExtractedPackage();
    const cliPath = join(packageDir, 'bin', 'agentxchain.js');
    const governedState = await import(pathToFileURL(join(packageDir, 'src/lib/governed-state.js')).href);
    const repoObserver = await import(pathToFileURL(join(packageDir, 'src/lib/repo-observer.js')).href);
    const turnPaths = await import(pathToFileURL(join(packageDir, 'src/lib/turn-paths.js')).href);
    const { initializeGovernedRun, assignGovernedTurn } = governedState;
    const { checkCleanBaseline } = repoObserver;
    const { getTurnStagingResultPath } = turnPaths;

    const root = makeTempGitRepo();
    const config = makeBug46Config();
    const init = initializeGovernedRun(root, config);
    assert.ok(init.ok, init.error);
    const assign = assignGovernedTurn(root, config, 'qa');
    assert.ok(assign.ok, assign.error);

    rewriteActiveTurnState(root, {
      runId: BUG46_TESTER_RUN_ID,
      phase: 'qa',
      turnId: BUG46_TESTER_TURN_ID,
    });

    const resultPath = join(root, getTurnStagingResultPath(BUG46_TESTER_TURN_ID));
    mkdirSync(join(root, '.agentxchain', 'staging', BUG46_TESTER_TURN_ID), { recursive: true });
    writeFileSync(resultPath, JSON.stringify({
      schema_version: '1.0',
      run_id: BUG46_TESTER_RUN_ID,
      turn_id: BUG46_TESTER_TURN_ID,
      role: 'qa',
      runtime_id: 'local-qa',
      status: 'completed',
      summary: 'Packaged BUG-46 exact-state rejection smoke.',
      decisions: [],
      objections: [],
      files_changed: [],
      verification: {
        status: 'pass',
        machine_evidence: [
          { command: BUG46_REPLAY_COMMAND, exit_code: 0 },
        ],
      },
      artifact: { type: 'workspace', ref: null },
      proposed_next_role: 'qa',
    }, null, 2));

    const accept = spawnSync(process.execPath, [cliPath, 'accept-turn', '--turn', BUG46_TESTER_TURN_ID], {
      cwd: root,
      encoding: 'utf8',
      env: { ...process.env, FORCE_COLOR: '0', NODE_NO_WARNINGS: '1' },
    });
    assert.notEqual(accept.status, 0,
      `packaged accept-turn must reject the tester's exact BUG-46 shape:\n${accept.stdout}\n${accept.stderr}`);
    assert.match(accept.stdout + accept.stderr,
      /artifact\.type: "workspace" but files_changed is empty/,
      'packaged exact-state rejection must fail loudly on workspace/files_changed mismatch');

    const baseline = checkCleanBaseline(root, 'authoritative');
    assert.equal(baseline.clean, true,
      `packaged exact-state rejection must not strand replay-only dirt:\n${baseline.reason || 'baseline reported dirty without a reason'}`);

    const historyPath = join(root, '.agentxchain', 'history.jsonl');
    if (existsSync(historyPath)) {
      const history = readFileSync(historyPath, 'utf8')
        .trim()
        .split('\n')
        .filter(Boolean)
        .map((line) => JSON.parse(line));
    assert.ok(!history.some((entry) => entry.turn_id === BUG46_TESTER_TURN_ID),
        'packaged exact-state rejection must not persist accepted history for the rejected turn');
    }
  });

  it('BUG-46 packaged CLI checkpoint-turn recovers a stranded legacy-empty accepted turn', async () => {
    const { packageDir } = getExtractedPackage();
    const cliPath = join(packageDir, 'bin', 'agentxchain.js');
    const governedState = await import(pathToFileURL(join(packageDir, 'src/lib/governed-state.js')).href);
    const repoObserver = await import(pathToFileURL(join(packageDir, 'src/lib/repo-observer.js')).href);
    const turnPaths = await import(pathToFileURL(join(packageDir, 'src/lib/turn-paths.js')).href);
    const { initializeGovernedRun, assignGovernedTurn } = governedState;
    const { checkCleanBaseline } = repoObserver;
    const { getTurnStagingResultPath } = turnPaths;

    const root = makeTempGitRepo();
    const config = makeBug46Config();
    const init = initializeGovernedRun(root, config);
    assert.ok(init.ok, init.error);
    const assign = assignGovernedTurn(root, config, 'qa');
    assert.ok(assign.ok, assign.error);

    writeFileSync(join(root, 'README.md'), '# BUG-46 packed smoke\nlegacy recovery path\n');

    const turnId = assign.turn.turn_id;
    const resultPath = join(root, getTurnStagingResultPath(turnId));
    mkdirSync(join(root, '.agentxchain', 'staging', turnId), { recursive: true });
    writeFileSync(resultPath, JSON.stringify({
      schema_version: '1.0',
      run_id: init.state.run_id,
      turn_id: turnId,
      role: 'qa',
      runtime_id: 'local-qa',
      status: 'completed',
      summary: 'Packaged BUG-46 legacy recovery smoke.',
      decisions: [],
      objections: [],
      files_changed: ['README.md'],
      verification: {
        status: 'pass',
        machine_evidence: [
          { command: `${JSON.stringify(process.execPath)} -e ${JSON.stringify('process.exit(0)')}`, exit_code: 0 },
        ],
      },
      artifact: { type: 'workspace', ref: null },
      proposed_next_role: 'qa',
    }, null, 2));

    const accept = spawnSync(process.execPath, [cliPath, 'accept-turn', '--turn', turnId], {
      cwd: root,
      encoding: 'utf8',
      env: { ...process.env, FORCE_COLOR: '0', NODE_NO_WARNINGS: '1' },
    });
    assert.equal(accept.status, 0,
      `packaged accept-turn must succeed before legacy recovery proof:\n${accept.stdout}\n${accept.stderr}`);

    const dirtyBeforeRecovery = checkCleanBaseline(root, 'authoritative');
    assert.equal(dirtyBeforeRecovery.clean, false,
      'legacy recovery proof must start from a dirty post-acceptance baseline');
    assert.match((dirtyBeforeRecovery.dirty_files || []).join('\n'), /README\.md/,
      'legacy recovery proof must strand the accepted actor-owned file before checkpoint');

    const historyPath = join(root, '.agentxchain', 'history.jsonl');
    const corruptedHistory = readFileSync(historyPath, 'utf8')
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line))
      .map((entry) => (
        entry.turn_id === turnId
          ? {
              ...entry,
              files_changed: [],
              observed_artifact: entry.observed_artifact
                ? {
                    ...entry.observed_artifact,
                    files_changed: [],
                  }
                : entry.observed_artifact,
            }
          : entry
      ));
    writeFileSync(historyPath, `${corruptedHistory.map((entry) => JSON.stringify(entry)).join('\n')}\n`);

    const checkpoint = spawnSync(process.execPath, [cliPath, 'checkpoint-turn', '--turn', turnId], {
      cwd: root,
      encoding: 'utf8',
      env: { ...process.env, FORCE_COLOR: '0', NODE_NO_WARNINGS: '1' },
    });
    assert.equal(checkpoint.status, 0,
      `packed checkpoint-turn must recover the stranded legacy entry:\n${checkpoint.stdout}\n${checkpoint.stderr}`);
    assert.doesNotMatch(checkpoint.stdout + checkpoint.stderr, /no writable files_changed/i,
      'packed checkpoint-turn must not skip the stranded legacy entry');

    const repairedHistory = readFileSync(historyPath, 'utf8')
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line));
    const repairedEntry = repairedHistory.find((entry) => entry.turn_id === turnId);
    assert.ok(repairedEntry, 'packed legacy recovery must preserve the accepted history entry');
    assert.deepEqual(repairedEntry.files_changed, ['README.md']);
    assert.equal(repairedEntry.files_changed_recovery_source, 'legacy_dirty_worktree');
    assert.ok(repairedEntry.files_changed_recovered_at,
      'packed legacy recovery must stamp recovery time');
    assert.deepEqual(repairedEntry.observed_artifact?.files_changed, ['README.md']);
    assert.ok(repairedEntry.checkpoint_sha,
      'packed legacy recovery must persist the checkpoint SHA back into history');

    const dirtyAfterRecovery = checkCleanBaseline(root, 'authoritative');
    assert.equal(dirtyAfterRecovery.clean, true,
      `packed legacy recovery must leave a clean authoritative baseline:\n${dirtyAfterRecovery.reason || 'baseline remained dirty'}`);

    const committedFiles = execFileSync('git', ['show', '--name-only', '--pretty=format:%s', 'HEAD'], {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    assert.match(committedFiles, /README\.md/,
      'packed legacy recovery checkpoint commit must include the recovered actor-owned file');

  });

  it('BUG-46 packaged CLI smoke proves accept-turn/checkpoint-turn/resume on the shipped tarball', async () => {
    const { packageDir } = getExtractedPackage();
    const cliPath = join(packageDir, 'bin', 'agentxchain.js');
    const governedState = await import(pathToFileURL(join(packageDir, 'src/lib/governed-state.js')).href);
    const turnPaths = await import(pathToFileURL(join(packageDir, 'src/lib/turn-paths.js')).href);
    const { initializeGovernedRun, assignGovernedTurn } = governedState;
    const { getTurnStagingResultPath } = turnPaths;

    const root = makeTempGitRepo();
    const config = makeBug46Config();
    const init = initializeGovernedRun(root, config);
    assert.ok(init.ok, init.error);
    const assign = assignGovernedTurn(root, config, 'qa');
    assert.ok(assign.ok, assign.error);
    materializeBug46ReplaySideEffects(root);

    const turnId = assign.turn.turn_id;
    const resultPath = join(root, getTurnStagingResultPath(turnId));
    mkdirSync(join(root, '.agentxchain', 'staging', turnId), { recursive: true });
    writeFileSync(resultPath, JSON.stringify({
      schema_version: '1.0',
      run_id: init.state.run_id,
      turn_id: turnId,
      role: 'qa',
      runtime_id: 'local-qa',
      status: 'completed',
      summary: 'Packaged BUG-46 smoke: verification outputs are part of the artifact set.',
      decisions: [],
      objections: [],
      files_changed: [],
      verification: {
        status: 'pass',
        machine_evidence: [
          { command: BUG46_REPLAY_COMMAND, exit_code: 0 },
        ],
        produced_files: BUG46_REPLAY_SIDE_EFFECT_PATHS.map((path) => ({
          path,
          disposition: 'artifact',
        })),
      },
      artifact: { type: 'workspace', ref: null },
      proposed_next_role: 'qa',
    }, null, 2));

    const accept = spawnSync(process.execPath, [cliPath, 'accept-turn', '--turn', turnId], {
      cwd: root,
      encoding: 'utf8',
      env: { ...process.env, FORCE_COLOR: '0', NODE_NO_WARNINGS: '1' },
    });
    assert.equal(accept.status, 0,
      `packaged accept-turn must succeed for BUG-46 smoke:\n${accept.stdout}\n${accept.stderr}`);

    const history = readFileSync(join(root, '.agentxchain', 'history.jsonl'), 'utf8')
      .trim().split('\n').filter(Boolean).map((line) => JSON.parse(line));
    const accepted = history.find((entry) => entry.turn_id === turnId);
    assert.ok(accepted, 'packaged smoke must persist accepted turn history');
    for (const relPath of BUG46_REPLAY_SIDE_EFFECT_PATHS) {
      assert.ok(accepted.files_changed.includes(relPath),
        `packaged history must promote verification artifact path into files_changed: ${relPath}`);
    }

    const checkpoint = spawnSync(process.execPath, [cliPath, 'checkpoint-turn', '--turn', turnId], {
      cwd: root,
      encoding: 'utf8',
      env: { ...process.env, FORCE_COLOR: '0', NODE_NO_WARNINGS: '1' },
    });
    assert.equal(checkpoint.status, 0,
      `packaged checkpoint-turn must succeed for BUG-46 smoke:\n${checkpoint.stdout}\n${checkpoint.stderr}`);
    assert.doesNotMatch(checkpoint.stdout, /no writable files_changed/i,
      'packaged checkpoint-turn must not skip promoted verification artifact files');

    const resume = spawnSync(process.execPath, [cliPath, 'resume', '--role', 'qa'], {
      cwd: root,
      encoding: 'utf8',
      env: { ...process.env, FORCE_COLOR: '0', NODE_NO_WARNINGS: '1' },
    });
    assert.equal(resume.status, 0,
      `packaged resume must succeed after BUG-46 checkpoint:\n${resume.stdout}\n${resume.stderr}`);
  });

  it('BUG-44 packaged CLI retires phase-scoped intent on phase advance and accepts QA turn', async () => {
    const { packageDir } = getExtractedPackage();
    const cliPath = join(packageDir, 'bin', 'agentxchain.js');
    const governedState = await import(pathToFileURL(join(packageDir, 'src/lib/governed-state.js')).href);
    const turnPaths = await import(pathToFileURL(join(packageDir, 'src/lib/turn-paths.js')).href);
    const { initializeGovernedRun, assignGovernedTurn, acceptGovernedTurn } = governedState;
    const { getTurnStagingResultPath } = turnPaths;

    // Create temp git repo with implementation+QA routing
    const root = mkdtempSync(join(tmpdir(), 'axc-packed-bug44-'));
    TEMP_PATHS.push(root);
    const config = {
      schema_version: '1.0',
      protocol_mode: 'governed',
      template: 'generic',
      project: { id: 'bug44-packed', name: 'BUG-44 Packed', default_branch: 'main' },
      roles: {
        dev: { title: 'Developer', mandate: 'Build.', write_authority: 'authoritative', runtime: 'r-dev' },
        qa: { title: 'QA', mandate: 'Verify.', write_authority: 'review_only', runtime: 'r-qa' },
      },
      runtimes: {
        'r-dev': { type: 'local_cli', command: process.execPath, args: ['-e', 'process.exit(0)'], prompt_transport: 'dispatch_bundle_only' },
        'r-qa': { type: 'manual' },
      },
      routing: {
        implementation: { entry_role: 'dev', allowed_next_roles: ['dev', 'qa'], exit_gate: 'implementation_complete' },
        qa: { entry_role: 'qa', allowed_next_roles: ['qa'], exit_gate: 'qa_ship_verdict' },
      },
      gates: {
        implementation_complete: { requires_files: ['.planning/IMPLEMENTATION_NOTES.md'], requires_verification_pass: true },
        qa_ship_verdict: {},
      },
    };

    mkdirSync(join(root, '.planning'), { recursive: true });
    writeFileSync(join(root, 'README.md'), '# BUG-44 packed\n');
    writeFileSync(join(root, 'agentxchain.json'), JSON.stringify(config, null, 2) + '\n');
    git(root, ['init', '-b', 'main']);
    git(root, ['config', 'user.email', 'test@test.com']);
    git(root, ['config', 'user.name', 'Test']);
    git(root, ['add', 'README.md', 'agentxchain.json']);
    git(root, ['commit', '-m', 'init']);

    const init = initializeGovernedRun(root, config);
    assert.ok(init.ok, init.error);

    // Seed implementation-scoped repair intent (tester's exact shape)
    const intentId = 'intent_1776534863659_5752';
    const eventId = 'evt_bug44_packed';
    mkdirSync(join(root, '.agentxchain', 'intake', 'events'), { recursive: true });
    mkdirSync(join(root, '.agentxchain', 'intake', 'intents'), { recursive: true });
    writeFileSync(join(root, '.agentxchain', 'intake', 'events', `${eventId}.json`), JSON.stringify({
      schema_version: '1.0', event_id: eventId, source: 'manual', category: 'operator_injection',
      created_at: '2026-04-19T00:00:00.000Z',
      signal: { description: 'implementation repair', injected: true, priority: 'p0' },
      evidence: [{ type: 'text', value: 'packed BUG-44' }], dedup_key: 'manual:bug44-packed',
    }, null, 2));
    writeFileSync(join(root, '.agentxchain', 'intake', 'intents', `${intentId}.json`), JSON.stringify({
      schema_version: '1.0', intent_id: intentId, event_id: eventId, status: 'approved', priority: 'p0',
      template: 'generic',
      charter: 'add literal ## Changes section to .planning/IMPLEMENTATION_NOTES.md, allow implementation to advance to QA.',
      acceptance_contract: ['implementation_complete gate can advance to qa once verification passes'],
      phase_scope: 'implementation', approved_run_id: init.state.run_id,
      created_at: '2026-04-19T00:00:00.000Z', updated_at: '2026-04-19T00:00:00.000Z', history: [],
    }, null, 2));

    // Create the gate-required file and commit
    writeFileSync(join(root, '.planning', 'IMPLEMENTATION_NOTES.md'),
      '# Implementation Notes\n\n## Summary\n- repair\n\n## Changes\n- Repair completed\n\n## Verification\n- pass\n');
    git(root, ['add', '.planning/IMPLEMENTATION_NOTES.md']);
    git(root, ['commit', '-m', 'seed implementation notes']);

    // Assign and accept an implementation turn that passes the gate
    const implAssign = assignGovernedTurn(root, config, 'dev');
    assert.ok(implAssign.ok, implAssign.error);
    const implTurnId = implAssign.turn.turn_id;
    const implResultPath = join(root, getTurnStagingResultPath(implTurnId));
    mkdirSync(join(root, '.agentxchain', 'staging', implTurnId), { recursive: true });
    writeFileSync(implResultPath, JSON.stringify({
      schema_version: '1.0', run_id: init.state.run_id, turn_id: implTurnId,
      role: 'dev', runtime_id: 'r-dev', status: 'completed',
      summary: 'Implementation repair done, advancing to QA.',
      decisions: [], objections: [],
      files_changed: ['.planning/IMPLEMENTATION_NOTES.md'],
      verification: { status: 'pass' },
      artifact: { type: 'workspace', ref: null },
      proposed_next_role: 'qa', phase_transition_request: 'qa',
    }, null, 2));

    const implAccept = acceptGovernedTurn(root, config, { turnId: implTurnId, resultPath: implResultPath });
    assert.ok(implAccept.ok, implAccept.error);
    assert.equal(implAccept.state.phase, 'qa', 'packaged impl accept must advance to qa');

    // Verify intent was retired
    const retiredIntent = JSON.parse(readFileSync(join(root, '.agentxchain', 'intake', 'intents', `${intentId}.json`), 'utf8'));
    assert.equal(retiredIntent.status, 'satisfied',
      'packaged phase advance must retire the implementation-scoped intent');

    // Resume via packaged CLI to dispatch QA turn
    const resume = spawnSync(process.execPath, [cliPath, 'resume'], {
      cwd: root, encoding: 'utf8',
      env: { ...process.env, FORCE_COLOR: '0', NODE_NO_WARNINGS: '1' },
    });
    assert.equal(resume.status, 0,
      `packaged resume must succeed after phase advance:\n${resume.stdout}\n${resume.stderr}`);
    assert.doesNotMatch(resume.stdout, /Bound approved intent to next turn: intent_1776534863659_5752/,
      'packaged resume must not re-bind the retired intent');

    // Get the QA turn and accept it via packaged CLI
    const qaState = JSON.parse(readFileSync(join(root, '.agentxchain', 'state.json'), 'utf8'));
    const qaTurnId = Object.keys(qaState.active_turns || {})[0];
    assert.ok(qaTurnId, 'packaged resume must create a QA turn');
    const qaResultPath = join(root, getTurnStagingResultPath(qaTurnId));
    mkdirSync(join(root, '.agentxchain', 'staging', qaTurnId), { recursive: true });
    writeFileSync(qaResultPath, JSON.stringify({
      schema_version: '1.0', run_id: init.state.run_id, turn_id: qaTurnId,
      role: 'qa', runtime_id: 'r-qa', status: 'completed',
      summary: 'QA pass — no stale coverage blocker.',
      decisions: [],
      objections: [{ id: 'OBJ-001', target: 'implementation', statement: 'Implementation gate already passed.', severity: 'low' }],
      files_changed: [],
      verification: { status: 'skipped' },
      artifact: { type: 'review', ref: null },
      proposed_next_role: 'qa',
    }, null, 2));

    const qaAccept = spawnSync(process.execPath, [cliPath, 'accept-turn', '--turn', qaTurnId], {
      cwd: root, encoding: 'utf8',
      env: { ...process.env, FORCE_COLOR: '0', NODE_NO_WARNINGS: '1' },
    });
    assert.equal(qaAccept.status, 0,
      `packaged QA accept must succeed without stale intent coverage:\n${qaAccept.stdout}\n${qaAccept.stderr}`);
    assert.doesNotMatch(qaAccept.stdout, /Intent coverage incomplete/,
      'packaged QA acceptance must not complain about retired implementation-phase intent');
  });

  it('BUG-44 packaged CLI exact continue-from continuous command retires the implementation intent and keeps QA moving', async () => {
    const { packageDir } = getExtractedPackage();
    const cliPath = join(packageDir, 'bin', 'agentxchain.js');
    const governedState = await import(pathToFileURL(join(packageDir, 'src/lib/governed-state.js')).href);
    const intake = await import(pathToFileURL(join(packageDir, 'src/lib/intake.js')).href);
    const turnPaths = await import(pathToFileURL(join(packageDir, 'src/lib/turn-paths.js')).href);
    const runEvents = await import(pathToFileURL(join(packageDir, 'src/lib/run-events.js')).href);
    const { initializeGovernedRun, assignGovernedTurn, acceptGovernedTurn } = governedState;
    const { injectIntent } = intake;
    const { getTurnStagingResultPath } = turnPaths;
    const { readRunEvents } = runEvents;

    const root = mkdtempSync(join(tmpdir(), 'axc-packed-bug44-cont-'));
    TEMP_PATHS.push(root);

    const bug44Config = {
      schema_version: '1.0',
      protocol_mode: 'governed',
      template: 'generic',
      project: { id: 'bug44-packed-continue', name: 'BUG-44 Packed Continue', default_branch: 'main' },
      roles: {
        dev: { title: 'Developer', mandate: 'Build.', write_authority: 'authoritative', runtime: 'local-dev' },
        qa: { title: 'QA', mandate: 'Verify.', write_authority: 'authoritative', runtime: 'local-qa' },
      },
      runtimes: {
        'local-dev': {
          type: 'local_cli',
          command: process.execPath,
          args: [join(CLI_DIR, 'test-support', 'mock-agent.mjs')],
          cwd: '.',
          prompt_transport: 'dispatch_bundle_only',
        },
        'local-qa': {
          type: 'local_cli',
          command: process.execPath,
          args: [join(CLI_DIR, 'test-support', 'mock-agent.mjs')],
          cwd: '.',
          prompt_transport: 'dispatch_bundle_only',
        },
      },
      routing: {
        implementation: { entry_role: 'dev', allowed_next_roles: ['dev', 'qa'], exit_gate: 'implementation_complete' },
        qa: { entry_role: 'qa', allowed_next_roles: ['qa'], exit_gate: 'qa_ship_verdict' },
      },
      gates: {
        implementation_complete: {
          requires_files: ['.planning/IMPLEMENTATION_NOTES.md'],
          requires_verification_pass: true,
        },
        qa_ship_verdict: {
          requires_files: ['.planning/acceptance-matrix.md', '.planning/ship-verdict.md', '.planning/RELEASE_NOTES.md'],
        },
      },
    };

    mkdirSync(join(root, '.planning'), { recursive: true });
    writeFileSync(join(root, 'README.md'), '# BUG-44 packed continue\n');
    writeFileSync(join(root, '.planning', 'VISION.md'), '# Vision\n\n## QA\n\n- finish QA without stale implementation repair coverage\n');
    writeFileSync(join(root, 'agentxchain.json'), JSON.stringify(bug44Config, null, 2) + '\n');
    git(root, ['init', '-b', 'main']);
    git(root, ['config', 'user.email', 'test@test.com']);
    git(root, ['config', 'user.name', 'Test']);
    git(root, ['add', '-A']);
    git(root, ['commit', '-m', 'init']);

    const init = initializeGovernedRun(root, bug44Config);
    assert.ok(init.ok, init.error);

    const implementationRepair = injectIntent(root, 'implementation repair intent from beta bug report #13', {
      priority: 'p1',
      charter: 'add literal ## Changes section to .planning/IMPLEMENTATION_NOTES.md, preserve implementation summary, allow implementation to advance to QA.',
      acceptance: 'implementation_complete gate can advance to qa once verification passes',
      approver: 'tester-sequence',
    });
    assert.ok(implementationRepair.ok, implementationRepair.error);

    const qaFollowup = injectIntent(root, 'qa validation should continue after the implementation repair', {
      priority: 'p2',
      charter: 'Execute the QA turn and record the ship verdict after the repaired implementation advances.',
      acceptance: 'qa_ship_verdict gate can advance once QA evidence is captured',
      approver: 'tester-sequence',
    });
    assert.ok(qaFollowup.ok, qaFollowup.error);

    writeFileSync(
      join(root, '.planning', 'IMPLEMENTATION_NOTES.md'),
      '# Implementation Notes\n\n## Summary\n- Existing summary\n\n## Changes\n- Repair completed\n\n## Verification\n- Baseline verification\n',
    );
    git(root, ['add', '.planning/IMPLEMENTATION_NOTES.md']);
    git(root, ['commit', '-m', 'seed implementation notes']);

    const implAssign = assignGovernedTurn(root, bug44Config, 'dev');
    assert.ok(implAssign.ok, implAssign.error);

    writeFileSync(
      join(root, '.planning', 'IMPLEMENTATION_NOTES.md'),
      '# Implementation Notes\n\n## Summary\n- Existing summary\n\n## Changes\n- Repair completed\n- Gate exit verified\n\n## Verification\n- Gate verification recorded\n',
    );

    const implResultPath = join(root, getTurnStagingResultPath(implAssign.turn.turn_id));
    mkdirSync(join(root, '.agentxchain', 'staging', implAssign.turn.turn_id), { recursive: true });
    writeFileSync(implResultPath, JSON.stringify({
      schema_version: '1.0',
      run_id: init.state.run_id,
      turn_id: implAssign.turn.turn_id,
      role: 'dev',
      runtime_id: 'local-dev',
      status: 'completed',
      summary: 'Completed the implementation repair and advanced the run to QA.',
      decisions: [],
      objections: [],
      files_changed: ['.planning/IMPLEMENTATION_NOTES.md'],
      verification: { status: 'pass' },
      artifact: { type: 'workspace', ref: null },
      proposed_next_role: 'qa',
      phase_transition_request: 'qa',
    }, null, 2));

    const implAccept = acceptGovernedTurn(root, bug44Config, {
      turnId: implAssign.turn.turn_id,
      resultPath: implResultPath,
    });
    assert.ok(implAccept.ok, implAccept.error);
    assert.equal(implAccept.state.phase, 'qa', 'packaged implementation accept must advance to qa');

    const checkpoint = spawnSync(process.execPath, [
      cliPath,
      'checkpoint-turn',
      '--turn',
      implAssign.turn.turn_id,
    ], {
      cwd: root,
      encoding: 'utf8',
      timeout: 60000,
      env: { ...process.env, FORCE_COLOR: '0', NO_COLOR: '1', NODE_NO_WARNINGS: '1' },
    });
    assert.equal(checkpoint.status, 0,
      `packaged checkpoint-turn must succeed before continue-from continuous:\n${checkpoint.stdout}\n${checkpoint.stderr}`);

    const retiredIntentPath = join(
      root,
      '.agentxchain',
      'intake',
      'intents',
      `${implementationRepair.intent.intent_id}.json`,
    );
    const qaIntentPath = join(root, '.agentxchain', 'intake', 'intents', `${qaFollowup.intent.intent_id}.json`);
    const retiredIntent = JSON.parse(readFileSync(retiredIntentPath, 'utf8'));
    const queuedQaIntent = JSON.parse(readFileSync(qaIntentPath, 'utf8'));
    assert.equal(retiredIntent.status, 'satisfied');
    assert.equal(queuedQaIntent.status, 'approved');

    const continuous = spawnSync(process.execPath, [
      cliPath,
      'run',
      '--continue-from',
      init.state.run_id,
      '--continuous',
      '--auto-approve',
      '--auto-checkpoint',
      '--max-turns',
      '20',
      '--max-runs',
      '1',
      '--max-idle-cycles',
      '1',
      '--poll-seconds',
      '0',
      '--triage-approval',
      'auto',
    ], {
      cwd: root,
      encoding: 'utf8',
      timeout: 120000,
      env: { ...process.env, FORCE_COLOR: '0', NO_COLOR: '1', NODE_NO_WARNINGS: '1' },
    });
    assert.equal(continuous.status, 0,
      `packaged continue-from continuous must succeed:\n${continuous.stdout}\n${continuous.stderr}`);
    assert.match(continuous.stdout, new RegExp(`Found queued intent: ${qaFollowup.intent.intent_id} \\(approved\\)`));
    assert.doesNotMatch(continuous.stdout, new RegExp(`Found queued intent: ${implementationRepair.intent.intent_id} \\(approved\\)`));
    assert.doesNotMatch(continuous.stdout, /Intent coverage incomplete/);
    assert.match(continuous.stdout, /Run 1\/1 completed: completed|Run 1\/1 completed: run_completed/);

    const finalQaIntent = JSON.parse(readFileSync(qaIntentPath, 'utf8'));
    const finalImplementationIntent = JSON.parse(readFileSync(retiredIntentPath, 'utf8'));
    assert.equal(finalQaIntent.status, 'completed');
    assert.equal(finalImplementationIntent.status, 'satisfied');

    const retireEvents = readRunEvents(root).filter((event) => event.event_type === 'intent_retired_by_phase_advance');
    assert.equal(retireEvents.length, 1);
    assert.deepEqual(retireEvents[0].payload.retired_intent_ids, [implementationRepair.intent.intent_id]);
  });

  it('BUG-45 packaged CLI accepts retained turn when live intent is completed on disk', async () => {
    const { packageDir } = getExtractedPackage();
    const cliPath = join(packageDir, 'bin', 'agentxchain.js');
    const governedState = await import(pathToFileURL(join(packageDir, 'src/lib/governed-state.js')).href);
    const turnPaths = await import(pathToFileURL(join(packageDir, 'src/lib/turn-paths.js')).href);
    const { initializeGovernedRun, assignGovernedTurn } = governedState;
    const { getTurnStagingResultPath } = turnPaths;

    const { root, config } = makeTempBug45Repo();

    const init = initializeGovernedRun(root, config);
    assert.ok(init.ok, init.error);

    seedBug45ExecutingIntent(root, init.state.run_id);

    // Assign a turn with stale embedded acceptance_contract
    const assign = assignGovernedTurn(root, config, 'pm', {
      intakeContext: {
        intent_id: BUG45_TESTER_INTENT_ID,
        charter: 'live-site consolidation',
        acceptance_contract: ['stale embedded contract item that does not match the live intent'],
        priority: 'p0',
      },
    });
    assert.ok(assign.ok, assign.error);
    const turnId = assign.turn.turn_id;

    // Simulate: operator resolves the intent to completed on disk
    const intentPath = join(root, '.agentxchain', 'intake', 'intents', `${BUG45_TESTER_INTENT_ID}.json`);
    const intent = JSON.parse(readFileSync(intentPath, 'utf8'));
    intent.status = 'completed';
    intent.completed_at = '2026-04-19T02:00:00.000Z';
    intent.updated_at = '2026-04-19T02:00:00.000Z';
    intent.history.push({
      from: 'executing', to: 'completed',
      at: '2026-04-19T02:00:00.000Z',
      reason: 'operator-resolved via intake resolve --outcome completed',
    });
    writeFileSync(intentPath, JSON.stringify(intent, null, 2));

    // Stage a turn result that does NOT address the stale contract
    const resultPath = join(root, getTurnStagingResultPath(turnId));
    mkdirSync(join(root, '.agentxchain', 'staging', turnId), { recursive: true });
    writeFileSync(resultPath, JSON.stringify({
      schema_version: '1.0', run_id: init.state.run_id, turn_id: turnId,
      role: 'pm', runtime_id: 'r-pm', status: 'completed',
      summary: 'Consolidation pass.',
      decisions: [], objections: [],
      files_changed: ['.planning/IMPLEMENTATION_NOTES.md'],
      verification: { status: 'pass' },
      artifact: { type: 'workspace', ref: null },
      proposed_next_role: 'pm',
    }, null, 2));

    // Accept via packaged CLI
    const accept = spawnSync(process.execPath, [cliPath, 'accept-turn', '--turn', turnId], {
      cwd: root, encoding: 'utf8',
      env: { ...process.env, FORCE_COLOR: '0', NODE_NO_WARNINGS: '1' },
    });
    assert.equal(accept.status, 0,
      `packaged accept-turn must succeed when live intent is completed:\n${accept.stdout}\n${accept.stderr}`);
    assert.doesNotMatch(accept.stdout + accept.stderr, /Intent coverage incomplete/,
      'packaged acceptance must not enforce coverage on a completed intent');
    assert.doesNotMatch(accept.stdout + accept.stderr, /stale embedded contract/i,
      'packaged acceptance must not use the stale embedded contract');
  });

  it('BUG-45 packaged CLI intake resolve transitions executing intents to completed', async () => {
    const { packageDir } = getExtractedPackage();
    const cliPath = join(packageDir, 'bin', 'agentxchain.js');
    const governedState = await import(pathToFileURL(join(packageDir, 'src/lib/governed-state.js')).href);
    const { initializeGovernedRun } = governedState;

    const { root, config } = makeTempBug45Repo();
    const init = initializeGovernedRun(root, config);
    assert.ok(init.ok, init.error);
    seedBug45ExecutingIntent(root, init.state.run_id);

    const resolveResult = spawnSync(process.execPath, [
      cliPath,
      'intake',
      'resolve',
      '--intent',
      BUG45_TESTER_INTENT_ID,
      '--outcome',
      'completed',
      '--json',
    ], {
      cwd: root,
      encoding: 'utf8',
      env: { ...process.env, FORCE_COLOR: '0', NODE_NO_WARNINGS: '1' },
    });
    assert.equal(resolveResult.status, 0,
      `packaged intake resolve must complete the executing BUG-45 intent:\n${resolveResult.stdout}\n${resolveResult.stderr}`);

    const output = JSON.parse(resolveResult.stdout);
    assert.equal(output.previous_status, 'executing');
    assert.equal(output.new_status, 'completed');
    assert.equal(output.no_change, false);

    const intentPath = join(root, '.agentxchain', 'intake', 'intents', `${BUG45_TESTER_INTENT_ID}.json`);
    const intent = JSON.parse(readFileSync(intentPath, 'utf8'));
    assert.equal(intent.status, 'completed');
    assert.ok(intent.completed_at, 'packaged intake resolve must stamp completed_at');
    assert.ok(intent.history.some((entry) => entry.to === 'completed'),
      'packaged intake resolve must append a completion history entry');
  });

  it('BUG-45 packaged CLI excludes HUMAN_TASKS.md framework edits from retained-turn acceptance', async () => {
    const { packageDir } = getExtractedPackage();
    const cliPath = join(packageDir, 'bin', 'agentxchain.js');
    const governedState = await import(pathToFileURL(join(packageDir, 'src/lib/governed-state.js')).href);
    const turnPaths = await import(pathToFileURL(join(packageDir, 'src/lib/turn-paths.js')).href);
    const { initializeGovernedRun, assignGovernedTurn } = governedState;
    const { getTurnStagingResultPath } = turnPaths;

    const { root, config } = makeTempBug45Repo();
    const init = initializeGovernedRun(root, config);
    assert.ok(init.ok, init.error);

    const assign = assignGovernedTurn(root, config, 'pm');
    assert.ok(assign.ok, assign.error);
    const turnId = assign.turn.turn_id;

    writeFileSync(
      join(root, 'HUMAN_TASKS.md'),
      '# Human Tasks\n\n### hesc_cc29324d02653f26 - resolved\nEscalation resolved.\n',
    );
    git(root, ['add', 'HUMAN_TASKS.md']);
    git(root, ['commit', '-m', 'framework escalation']);

    writeFileSync(
      join(root, '.planning', 'IMPLEMENTATION_NOTES.md'),
      '# Implementation Notes\n\n## Summary\n- Consolidation\n\n## Changes\n- Done\n- Verified retained-turn acceptance after framework-owned HUMAN_TASKS drift\n',
    );

    const resultPath = join(root, getTurnStagingResultPath(turnId));
    mkdirSync(join(root, '.agentxchain', 'staging', turnId), { recursive: true });
    writeFileSync(resultPath, JSON.stringify({
      schema_version: '1.0',
      run_id: init.state.run_id,
      turn_id: turnId,
      role: 'pm',
      runtime_id: 'r-pm',
      status: 'completed',
      summary: 'Retained-turn acceptance should ignore framework-owned task-file drift.',
      decisions: [],
      objections: [],
      files_changed: ['.planning/IMPLEMENTATION_NOTES.md'],
      verification: { status: 'pass' },
      artifact: { type: 'workspace', ref: null },
      proposed_next_role: 'pm',
    }, null, 2));

    const accept = spawnSync(process.execPath, [cliPath, 'accept-turn', '--turn', turnId], {
      cwd: root,
      encoding: 'utf8',
      env: { ...process.env, FORCE_COLOR: '0', NODE_NO_WARNINGS: '1' },
    });
    assert.equal(accept.status, 0,
      `packaged accept-turn must ignore HUMAN_TASKS.md framework drift:\n${accept.stdout}\n${accept.stderr}`);
    assert.doesNotMatch(
      accept.stdout + accept.stderr,
      /Undeclared file changes detected:.*HUMAN_TASKS\.md/s,
      'packaged retained-turn acceptance must not report HUMAN_TASKS.md as undeclared dirt',
    );
  });

  it('BUG-45 packaged CLI restart preserves retained-turn intent binding and reconciles live contract', async () => {
    const { packageDir } = getExtractedPackage();
    const cliPath = join(packageDir, 'bin', 'agentxchain.js');
    const governedState = await import(pathToFileURL(join(packageDir, 'src/lib/governed-state.js')).href);
    const turnPaths = await import(pathToFileURL(join(packageDir, 'src/lib/turn-paths.js')).href);
    const dispatchBundle = await import(pathToFileURL(join(packageDir, 'src/lib/dispatch-bundle.js')).href);
    const { initializeGovernedRun, assignGovernedTurn, normalizeGovernedStateShape } = governedState;
    const { getTurnStagingResultPath } = turnPaths;
    const { writeDispatchBundle } = dispatchBundle;

    const { root, config } = makeTempBug45Repo();
    const init = initializeGovernedRun(root, config);
    assert.ok(init.ok, init.error);

    seedBug45ExecutingIntent(root, init.state.run_id);

    // Assign a turn with stale embedded acceptance_contract
    const assign = assignGovernedTurn(root, config, 'pm', {
      intakeContext: {
        intent_id: BUG45_TESTER_INTENT_ID,
        charter: 'live-site consolidation',
        acceptance_contract: ['stale embedded contract item that must not be re-enforced after restart'],
        priority: 'p0',
      },
    });
    assert.ok(assign.ok, assign.error);
    const turnId = assign.turn.turn_id;

    // Read state and write dispatch bundle so restart has something to reconnect to
    const rawState = JSON.parse(readFileSync(join(root, '.agentxchain', 'state.json'), 'utf8'));
    const { state: normalizedState } = normalizeGovernedStateShape(rawState);
    const dispatch = writeDispatchBundle(root, normalizedState, config, { turnId });
    assert.ok(dispatch.ok, dispatch.error);

    // Update the live intent contract on disk (simulating contract drift)
    const intentPath = join(root, '.agentxchain', 'intake', 'intents', `${BUG45_TESTER_INTENT_ID}.json`);
    const intent = JSON.parse(readFileSync(intentPath, 'utf8'));
    intent.acceptance_contract = [
      '.planning/IMPLEMENTATION_NOTES.md contains a literal ## Changes heading describing the consolidation work',
    ];
    intent.updated_at = '2026-04-19T01:45:00.000Z';
    writeFileSync(intentPath, JSON.stringify(intent, null, 2));

    // Run packaged restart
    const restart = spawnSync(process.execPath, [cliPath, 'restart'], {
      cwd: root,
      encoding: 'utf8',
      env: { ...process.env, FORCE_COLOR: '0', NODE_NO_WARNINGS: '1' },
    });
    assert.equal(restart.status, 0,
      `packaged restart must reconnect to the retained turn:\n${restart.stdout}\n${restart.stderr}`);

    // Verify retained turn still has intent_id after restart
    const restartedRaw = JSON.parse(readFileSync(join(root, '.agentxchain', 'state.json'), 'utf8'));
    const { state: restartedState } = normalizeGovernedStateShape(restartedRaw);
    const retainedTurn = restartedState.active_turns?.[turnId];
    assert.ok(retainedTurn, 'packaged restart must preserve the retained active turn');
    assert.equal(retainedTurn.intake_context?.intent_id, BUG45_TESTER_INTENT_ID,
      'packaged restart must preserve intent binding on the retained turn');

    // Stage a turn result that addresses the LIVE contract (not the stale embedded one)
    const resultPath = join(root, getTurnStagingResultPath(turnId));
    mkdirSync(join(root, '.agentxchain', 'staging', turnId), { recursive: true });
    writeFileSync(resultPath, JSON.stringify({
      schema_version: '1.0',
      run_id: init.state.run_id,
      turn_id: turnId,
      role: 'pm',
      runtime_id: 'r-pm',
      status: 'completed',
      summary: 'Implementation Notes still contains the literal ## Changes heading.',
      decisions: [],
      objections: [],
      files_changed: ['.planning/IMPLEMENTATION_NOTES.md'],
      verification: { status: 'pass' },
      artifact: { type: 'workspace', ref: null },
      proposed_next_role: 'pm',
    }, null, 2));

    // Accept via packaged CLI — must reconcile against live contract, not stale embedded one
    const accept = spawnSync(process.execPath, [cliPath, 'accept-turn', '--turn', turnId], {
      cwd: root,
      encoding: 'utf8',
      env: { ...process.env, FORCE_COLOR: '0', NODE_NO_WARNINGS: '1' },
    });
    assert.equal(accept.status, 0,
      `packaged accept-turn must reconcile against the live contract after restart:\n${accept.stdout}\n${accept.stderr}`);
    assert.doesNotMatch(accept.stdout + accept.stderr, /stale embedded contract/i,
      'packaged restart must not cause acceptance to fall back to the embedded stale contract');
  });

  it('BUG-46 packaged CLI continuous-mode proves the tester exact operator path: run --continue-from --continuous with authoritative QA', async () => {
    const { packageDir } = getExtractedPackage();
    const cliPath = join(packageDir, 'bin', 'agentxchain.js');
    const governedState = await import(pathToFileURL(join(packageDir, 'src/lib/governed-state.js')).href);
    const { initializeGovernedRun } = governedState;

    const root = mkdtempSync(join(tmpdir(), 'axc-packed-bug46-cont-'));
    TEMP_PATHS.push(root);

    // Tester's exact governance tuple: QA + authoritative + local_cli
    const bug46ContConfig = {
      schema_version: '1.0',
      protocol_mode: 'governed',
      template: 'generic',
      project: { id: 'bug46-packed-continuous', name: 'BUG-46 Packed Continuous', default_branch: 'main' },
      roles: {
        qa: {
          title: 'QA',
          mandate: 'Verify the release candidate, produce fixture outputs, and record the ship verdict.',
          write_authority: 'authoritative',
          runtime: 'local-qa',
        },
      },
      runtimes: {
        'local-qa': {
          type: 'local_cli',
          command: process.execPath,
          args: [join(CLI_DIR, 'test-support', 'mock-agent-bug46-qa.mjs')],
          cwd: '.',
          prompt_transport: 'dispatch_bundle_only',
        },
      },
      routing: {
        qa: { entry_role: 'qa', allowed_next_roles: ['qa'], exit_gate: 'qa_ship_verdict' },
      },
      gates: {
        qa_ship_verdict: {
          requires_files: ['.planning/acceptance-matrix.md', '.planning/ship-verdict.md', '.planning/RELEASE_NOTES.md'],
        },
      },
    };

    mkdirSync(join(root, '.planning'), { recursive: true });
    writeFileSync(join(root, 'README.md'), '# BUG-46 packed continuous\n');
    writeFileSync(join(root, '.planning', 'VISION.md'), '# Vision\n\n## QA\n\n- verify the release candidate with authoritative QA\n');
    writeFileSync(join(root, 'agentxchain.json'), JSON.stringify(bug46ContConfig, null, 2) + '\n');
    git(root, ['init', '-b', 'main']);
    git(root, ['config', 'user.email', 'test@test.com']);
    git(root, ['config', 'user.name', 'Test']);
    git(root, ['add', '-A']);
    git(root, ['commit', '-m', 'init']);

    const init = initializeGovernedRun(root, bug46ContConfig);
    assert.ok(init.ok, init.error);

    // Run the tester's exact operator command shape:
    // agentxchain run --continue-from <run_id> --continuous
    // Use --max-turns 3 to allow accept→checkpoint→resume to cycle.
    // The BUG-46 proof is: the continuous loop does NOT deadlock on
    // the accept→checkpoint→resume chain with authoritative QA + produced_files.
    const continuous = spawnSync(process.execPath, [
      cliPath,
      'run',
      '--continue-from',
      init.state.run_id,
      '--continuous',
      '--auto-approve',
      '--auto-checkpoint',
      '--max-turns',
      '3',
      '--max-runs',
      '1',
      '--max-idle-cycles',
      '1',
      '--poll-seconds',
      '0',
      '--triage-approval',
      'auto',
    ], {
      cwd: root,
      encoding: 'utf8',
      timeout: 120000,
      env: { ...process.env, FORCE_COLOR: '0', NO_COLOR: '1', NODE_NO_WARNINGS: '1' },
    });

    const combinedOutput = (continuous.stdout || '') + (continuous.stderr || '');

    // Must not produce the old BUG-46 deadlock symptoms
    assert.doesNotMatch(combinedOutput,
      /no writable files_changed paths to checkpoint/i,
      'continuous checkpoint must not skip — produced_files must be promoted');
    assert.doesNotMatch(combinedOutput,
      /Working tree has uncommitted changes in actor-owned files.*Authoritative.*require a clean baseline/i,
      'continuous resume must not block on stranded verification outputs');
    assert.doesNotMatch(combinedOutput,
      /artifact\.type: "workspace" but files_changed is empty/i,
      'continuous acceptance must not reject — produced_files promotion should populate files_changed');

    // The continuous loop must have accepted at least one turn (not stuck before first acceptance)
    assert.match(combinedOutput, /Turn accepted:/,
      'continuous run must accept at least one turn through the accept→checkpoint→resume chain');

    // Verify history shows the promoted files_changed
    const historyPath = join(root, '.agentxchain', 'history.jsonl');
    assert.ok(existsSync(historyPath),
      `continuous run must persist history. Output:\n${combinedOutput}`);
    const history = readFileSync(historyPath, 'utf8')
      .trim().split('\n').filter(Boolean).map((line) => JSON.parse(line));
    const qaEntry = history.find((e) => e.role === 'qa');
    assert.ok(qaEntry,
      `continuous run must have a QA turn in history. Entries: ${history.map((e) => `${e.turn_id}:${e.role}:${e.status}`).join(', ')}`);
    assert.ok(Array.isArray(qaEntry.files_changed) && qaEntry.files_changed.length > 0,
      `continuous QA turn files_changed must be populated after produced_files promotion. Got: ${JSON.stringify(qaEntry.files_changed)}`);
    assert.ok(qaEntry.files_changed.includes('.planning/RELEASE_NOTES.md'),
      'continuous QA turn must include promoted verification artifact in files_changed');
    assert.ok(qaEntry.checkpoint_sha,
      'continuous QA turn must have a checkpoint_sha (auto-checkpoint succeeded)');
  });

  it('BUG-46 packaged CLI product_marketing + authoritative + local_cli accept/checkpoint/resume on shipped tarball', async () => {
    const { packageDir } = getExtractedPackage();
    const cliPath = join(packageDir, 'bin', 'agentxchain.js');
    const governedState = await import(pathToFileURL(join(packageDir, 'src/lib/governed-state.js')).href);
    const repoObserver = await import(pathToFileURL(join(packageDir, 'src/lib/repo-observer.js')).href);
    const turnPaths = await import(pathToFileURL(join(packageDir, 'src/lib/turn-paths.js')).href);
    const { initializeGovernedRun, assignGovernedTurn } = governedState;
    const { checkCleanBaseline } = repoObserver;
    const { getTurnStagingResultPath } = turnPaths;

    const root = mkdtempSync(join(tmpdir(), 'axc-packed-bug46-pm-'));
    TEMP_PATHS.push(root);

    const pmConfig = {
      schema_version: '1.0',
      protocol_mode: 'governed',
      template: 'generic',
      project: { id: 'bug46-packed-pm', name: 'BUG-46 Packed Product Marketing', default_branch: 'main' },
      roles: {
        product_marketing: {
          title: 'Product Marketing',
          mandate: 'Ship evidence-backed release communication.',
          write_authority: 'authoritative',
          runtime: 'local-product-marketing',
        },
      },
      runtimes: {
        'local-product-marketing': {
          type: 'local_cli',
          command: process.execPath,
          args: ['-e', 'process.exit(0)'],
          prompt_transport: 'dispatch_bundle_only',
        },
      },
      routing: {
        qa: { entry_role: 'product_marketing', allowed_next_roles: ['product_marketing'], exit_gate: 'qa_complete' },
      },
      gates: { qa_complete: {} },
      policies: [
        { id: 'replay-proof', rule: 'require_reproducible_verification', action: 'block' },
      ],
    };

    mkdirSync(join(root, '.planning'), { recursive: true });
    writeFileSync(join(root, 'README.md'), '# BUG-46 packed PM tuple\n');
    writeFileSync(join(root, 'agentxchain.json'), JSON.stringify(pmConfig, null, 2) + '\n');
    git(root, ['init', '-b', 'main']);
    git(root, ['config', 'user.email', 'test@test.com']);
    git(root, ['config', 'user.name', 'Test']);
    git(root, ['add', 'README.md', 'agentxchain.json']);
    git(root, ['commit', '-m', 'init']);

    const init = initializeGovernedRun(root, pmConfig);
    assert.ok(init.ok, init.error);
    const assign = assignGovernedTurn(root, pmConfig, 'product_marketing');
    assert.ok(assign.ok, assign.error);
    materializeBug46ReplaySideEffects(root);

    const turnId = assign.turn.turn_id;
    const resultPath = join(root, getTurnStagingResultPath(turnId));
    mkdirSync(join(root, '.agentxchain', 'staging', turnId), { recursive: true });
    writeFileSync(resultPath, JSON.stringify({
      schema_version: '1.0',
      run_id: init.state.run_id,
      turn_id: turnId,
      role: 'product_marketing',
      runtime_id: 'local-product-marketing',
      status: 'completed',
      summary: 'Packed product_marketing: verification outputs promoted as artifacts.',
      decisions: [],
      objections: [],
      files_changed: [],
      verification: {
        status: 'pass',
        machine_evidence: [
          { command: BUG46_REPLAY_COMMAND, exit_code: 0 },
        ],
        produced_files: BUG46_REPLAY_SIDE_EFFECT_PATHS.map((path) => ({
          path,
          disposition: 'artifact',
        })),
      },
      artifact: { type: 'workspace', ref: null },
      proposed_next_role: 'product_marketing',
    }, null, 2));

    const accept = spawnSync(process.execPath, [cliPath, 'accept-turn', '--turn', turnId], {
      cwd: root,
      encoding: 'utf8',
      timeout: 120000,
      env: { ...process.env, FORCE_COLOR: '0', NODE_NO_WARNINGS: '1' },
    });
    assert.equal(accept.status, 0,
      `packed product_marketing accept-turn must succeed:\n${accept.stdout}\n${accept.stderr}`);

    const history = readFileSync(join(root, '.agentxchain', 'history.jsonl'), 'utf8')
      .trim().split('\n').filter(Boolean).map((line) => JSON.parse(line));
    const accepted = history.find((entry) => entry.turn_id === turnId);
    assert.ok(accepted, 'packed product_marketing turn must be in history');
    assert.equal(accepted.role, 'product_marketing',
      'packed history must preserve the non-standard role id');
    for (const relPath of BUG46_REPLAY_SIDE_EFFECT_PATHS) {
      assert.ok(accepted.files_changed.includes(relPath),
        `packed product_marketing history must promote verification artifact: ${relPath}`);
    }

    const checkpoint = spawnSync(process.execPath, [cliPath, 'checkpoint-turn', '--turn', turnId], {
      cwd: root,
      encoding: 'utf8',
      timeout: 120000,
      env: { ...process.env, FORCE_COLOR: '0', NODE_NO_WARNINGS: '1' },
    });
    assert.equal(checkpoint.status, 0,
      `packed product_marketing checkpoint-turn must succeed:\n${checkpoint.stdout}\n${checkpoint.stderr}`);
    assert.doesNotMatch(checkpoint.stdout, /no writable files_changed/i,
      'packed product_marketing checkpoint must not skip promoted files');

    const postCheckpointBaseline = checkCleanBaseline(root, 'authoritative');
    assert.equal(postCheckpointBaseline.clean, true,
      `packed product_marketing checkpoint must leave a clean authoritative baseline:\n${postCheckpointBaseline.reason || 'dirty'}`);

    const resume = spawnSync(process.execPath, [cliPath, 'resume', '--role', 'product_marketing'], {
      cwd: root,
      encoding: 'utf8',
      timeout: 120000,
      env: { ...process.env, FORCE_COLOR: '0', NODE_NO_WARNINGS: '1' },
    });
    assert.equal(resume.status, 0,
      `packed product_marketing resume must succeed after checkpoint:\n${resume.stdout}\n${resume.stderr}`);
  });

  it('BUG-46 packaged CLI continuous mode surfaces legacy-empty checkpoint recovery guidance before dispatch', async () => {
    const { packageDir } = getExtractedPackage();
    const cliPath = join(packageDir, 'bin', 'agentxchain.js');
    const governedState = await import(pathToFileURL(join(packageDir, 'src/lib/governed-state.js')).href);
    const repoObserver = await import(pathToFileURL(join(packageDir, 'src/lib/repo-observer.js')).href);
    const turnPaths = await import(pathToFileURL(join(packageDir, 'src/lib/turn-paths.js')).href);
    const { initializeGovernedRun, assignGovernedTurn } = governedState;
    const { checkCleanBaseline } = repoObserver;
    const { getTurnStagingResultPath } = turnPaths;

    const root = mkdtempSync(join(tmpdir(), 'axc-packed-bug46-cont-recovery-'));
    TEMP_PATHS.push(root);

    const bug46ContConfig = {
      schema_version: '1.0',
      protocol_mode: 'governed',
      template: 'generic',
      project: { id: 'bug46-packed-continuous-recovery', name: 'BUG-46 Packed Continuous Recovery', default_branch: 'main' },
      roles: {
        qa: {
          title: 'QA',
          mandate: 'Verify the release candidate, produce fixture outputs, and record the ship verdict.',
          write_authority: 'authoritative',
          runtime: 'local-qa',
        },
      },
      runtimes: {
        'local-qa': {
          type: 'local_cli',
          command: process.execPath,
          args: [join(CLI_DIR, 'test-support', 'mock-agent-bug46-qa.mjs')],
          cwd: '.',
          prompt_transport: 'dispatch_bundle_only',
        },
      },
      routing: {
        qa: { entry_role: 'qa', allowed_next_roles: ['qa'], exit_gate: 'qa_ship_verdict' },
      },
      gates: {
        qa_ship_verdict: {
          requires_files: ['.planning/acceptance-matrix.md', '.planning/ship-verdict.md', '.planning/RELEASE_NOTES.md'],
        },
      },
    };

    mkdirSync(join(root, '.planning'), { recursive: true });
    writeFileSync(join(root, 'README.md'), '# BUG-46 packed continuous recovery\n');
    writeFileSync(join(root, '.planning', 'VISION.md'), '# Vision\n\n## QA\n\n- recover from stranded accepted turns before dispatching the next authoritative QA turn\n');
    writeFileSync(join(root, 'agentxchain.json'), JSON.stringify(bug46ContConfig, null, 2) + '\n');
    git(root, ['init', '-b', 'main']);
    git(root, ['config', 'user.email', 'test@test.com']);
    git(root, ['config', 'user.name', 'Test']);
    git(root, ['add', '-A']);
    git(root, ['commit', '-m', 'init']);

    const init = initializeGovernedRun(root, bug46ContConfig);
    assert.ok(init.ok, init.error);
    const assign = assignGovernedTurn(root, bug46ContConfig, 'qa');
    assert.ok(assign.ok, assign.error);

    materializeBug46ReplaySideEffects(root);

    const turnId = assign.turn.turn_id;
    const resultPath = join(root, getTurnStagingResultPath(turnId));
    mkdirSync(join(root, '.agentxchain', 'staging', turnId), { recursive: true });
    writeFileSync(resultPath, JSON.stringify({
      schema_version: '1.0',
      run_id: init.state.run_id,
      turn_id: turnId,
      role: 'qa',
      runtime_id: 'local-qa',
      status: 'completed',
      summary: 'Packaged BUG-46 continuous recovery smoke seeds a stranded accepted turn with produced_files promotion.',
      decisions: [],
      objections: [],
      files_changed: [],
      verification: {
        status: 'pass',
        machine_evidence: [
          { command: BUG46_REPLAY_COMMAND, exit_code: 0 },
        ],
        produced_files: BUG46_REPLAY_SIDE_EFFECT_PATHS.map((path) => ({
          path,
          disposition: 'artifact',
        })),
      },
      artifact: { type: 'workspace', ref: null },
      proposed_next_role: 'qa',
    }, null, 2));

    const accept = spawnSync(process.execPath, [cliPath, 'accept-turn', '--turn', turnId], {
      cwd: root,
      encoding: 'utf8',
      timeout: 120000,
      env: { ...process.env, FORCE_COLOR: '0', NO_COLOR: '1', NODE_NO_WARNINGS: '1' },
    });
    assert.equal(accept.status, 0,
      `packaged accept-turn must seed the stranded continuous recovery state:\n${accept.stdout}\n${accept.stderr}`);

    const historyPath = join(root, '.agentxchain', 'history.jsonl');
    const corruptedHistory = readFileSync(historyPath, 'utf8')
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line))
      .map((entry) => (
        entry.turn_id === turnId
          ? {
              ...entry,
              files_changed: [],
              observed_artifact: entry.observed_artifact
                ? {
                    ...entry.observed_artifact,
                    files_changed: [],
                  }
                : entry.observed_artifact,
            }
          : entry
      ));
    writeFileSync(historyPath, `${corruptedHistory.map((entry) => JSON.stringify(entry)).join('\n')}\n`);

    const blockedContinuous = spawnSync(process.execPath, [
      cliPath,
      'run',
      '--continue-from',
      init.state.run_id,
      '--continuous',
      '--auto-approve',
      '--max-turns',
      '1',
      '--max-runs',
      '1',
      '--max-idle-cycles',
      '1',
      '--poll-seconds',
      '0',
      '--triage-approval',
      'auto',
    ], {
      cwd: root,
      encoding: 'utf8',
      timeout: 120000,
      env: { ...process.env, FORCE_COLOR: '0', NO_COLOR: '1', NODE_NO_WARNINGS: '1' },
    });

    const blockedOutput = (blockedContinuous.stdout || '') + (blockedContinuous.stderr || '');
    assert.notEqual(blockedContinuous.status, 0,
      'continuous run must fail closed while the stranded legacy checkpoint is still unrepaired');
    assert.match(blockedOutput, /legacy-empty files_changed history/i,
      `continuous run must surface the legacy recovery guidance:\n${blockedOutput}`);
    assert.match(blockedOutput, new RegExp(`checkpoint-turn --turn ${turnId}`),
      'continuous run must point at checkpoint-turn for recovery');
    assert.doesNotMatch(blockedOutput, /Turn accepted:/,
      'continuous run must block before dispatching a new turn while the stranded checkpoint remains unrepaired');

    const checkpoint = spawnSync(process.execPath, [cliPath, 'checkpoint-turn', '--turn', turnId], {
      cwd: root,
      encoding: 'utf8',
      timeout: 120000,
      env: { ...process.env, FORCE_COLOR: '0', NO_COLOR: '1', NODE_NO_WARNINGS: '1' },
    });
    assert.equal(checkpoint.status, 0,
      `checkpoint-turn must repair the stranded accepted turn before continuous resume:\n${checkpoint.stdout}\n${checkpoint.stderr}`);
    const repairedBaseline = checkCleanBaseline(root, 'authoritative');
    assert.equal(repairedBaseline.clean, true,
      `checkpoint repair must restore a clean authoritative baseline for the next continuous dispatch:\n${repairedBaseline.reason || 'baseline remained dirty'}`);
  });

  it('BUG-47 stale-turn watchdog proof exists and packed watchdog source still honors the stale-threshold contract', () => {
    const packedFiles = getPackedFiles();
    const bug47Test = join(SCENARIOS_DIR, 'bug-47-stale-turn-watchdog.test.js');
    assert.ok(existsSync(bug47Test),
      'BUG-47 stale-turn watchdog beta-tester-scenario must exist at cli/test/beta-tester-scenarios/bug-47-stale-turn-watchdog.test.js');
    const imports = extractImports(bug47Test);
    assert.ok(imports.length > 0,
      'BUG-47 stale-turn watchdog test must import production modules');
    const missing = imports.filter(imp => !packedFiles.has(imp));
    assert.equal(missing.length, 0,
      `BUG-47 test imports production files missing from tarball: ${missing.join(', ')}`);
    const testContent = readFileSync(bug47Test, 'utf8');
    assert.ok(testContent.includes('detectStaleTurns')
      && testContent.includes('status --json')
      && testContent.includes('resume')
      && testContent.includes('step --resume'),
    'BUG-47 test must cover detectStaleTurns plus the operator-facing status/resume/step --resume recovery surfaces');
    assert.ok(testContent.includes('seedOldDispatchProgress'),
      'BUG-47 test must seed dispatch-progress so it proves the stale-turn path, not the BUG-51 ghost-turn path');

    const { packageDir } = getExtractedPackage();
    const packedWatchdog = readFileSync(join(packageDir, 'src/lib/stale-turn-watchdog.js'), 'utf8');
    assert.match(packedWatchdog, /export function detectStaleTurns\b/,
      'packed stale-turn-watchdog.js must export detectStaleTurns for BUG-47 stale-turn detection');
    assert.match(packedWatchdog, /export function detectAndEmitStaleTurns\b/,
      'packed stale-turn-watchdog.js must export detectAndEmitStaleTurns for BUG-47 command-path reconciliation');
    assert.match(packedWatchdog, /run_loop\?\.stale_turn_threshold_ms/,
      'packed stale-turn-watchdog.js must honor run_loop.stale_turn_threshold_ms for the 10-minute stale-turn contract');
    assert.match(packedWatchdog, /status:\s*'stalled'/,
      'packed stale-turn-watchdog.js must retain stale turns as stalled after reconciliation');
    assert.match(packedWatchdog, /reissue-turn --turn .* --reason stale/,
      'packed stale-turn-watchdog.js must surface the stale-turn reissue command');
  });

  it('BUG-47 packaged CLI reconciles a started-but-silent turn to stalled (not failed_start)', async () => {
    // Packaged behavioral proof for BUG-47 — analogous to the BUG-51 ghost-turn
    // smoke at "BUG-51 packaged CLI detects a ghost turn ...". GPT 5.4 Turn 36
    // Next Action: prove the shipped tarball still distinguishes BUG-47 stale
    // ("subprocess started, attached stdout, then went silent") from BUG-51
    // ghost ("subprocess never produced output"). Locks DEC-BUG51-FIRST-OUTPUT-PROOF-001
    // at the packaged-binary boundary. Without this row, a refactor that
    // accidentally collapsed all stale paths into ghost (or vice versa) would
    // ship undetected — claim-reality rule #9 territory.
    const { packageDir } = getExtractedPackage();
    const watchdog = await import(pathToFileURL(join(packageDir, 'src/lib/stale-turn-watchdog.js')).href);
    const dispatchProgress = await import(pathToFileURL(join(packageDir, 'src/lib/dispatch-progress.js')).href);
    const runEvents = await import(pathToFileURL(join(packageDir, 'src/lib/run-events.js')).href);
    const { reconcileStaleTurns } = watchdog;
    const { getDispatchProgressRelativePath } = dispatchProgress;
    const { RUN_EVENTS_PATH } = runEvents;

    // Seed a `running` turn that started 120s ago AND has first-output proof
    // (both on the turn itself and in the packed dispatch-progress file). This
    // is the BUG-47 path: subprocess attached stdout, emitted output, then
    // went quiet past the stale threshold. NOT the BUG-51 path (no proof of
    // first output at all).
    const root = mkdtempSync(join(tmpdir(), 'axc-packed-bug47-'));
    TEMP_PATHS.push(root);
    mkdirSync(join(root, '.agentxchain'), { recursive: true });

    const runId = 'run_bug47_packed_smoke';
    const turnId = 'turn_bug47_stale_packed';
    const startedAt = new Date(Date.now() - 120_000).toISOString();
    const lastActivityAt = new Date(Date.now() - 110_000).toISOString();
    const state = {
      schema_version: '1.0',
      run_id: runId,
      phase: 'implementation',
      status: 'running',
      active_turns: {
        [turnId]: {
          turn_id: turnId,
          assigned_role: 'dev',
          runtime_id: 'local-dev',
          status: 'running',
          assigned_at: startedAt,
          dispatched_at: startedAt,
          started_at: startedAt,
          first_output_at: startedAt,
        },
      },
      budget_reservations: {
        [turnId]: { role: 'dev', estimate_usd: 2.0, reserved_at: startedAt },
      },
    };
    writeFileSync(join(root, '.agentxchain', 'state.json'), JSON.stringify(state, null, 2));

    // Seed dispatch-progress mirroring the source-tree BUG-47 fixture
    // (`seedOldDispatchProgress`) so packed `hasStartupProof()` returns true,
    // which is what makes this stale-not-ghost.
    const progressPath = join(root, getDispatchProgressRelativePath(turnId));
    mkdirSync(dirname(progressPath), { recursive: true });
    writeFileSync(progressPath, JSON.stringify({
      turn_id: turnId,
      started_at: startedAt,
      first_output_at: startedAt,
      last_activity_at: lastActivityAt,
      activity_type: 'output',
      activity_summary: 'Producing output (3 lines)',
      output_lines: 3,
      stderr_lines: 0,
    }));

    const config = {
      schema_version: '1.0',
      protocol_mode: 'governed',
      project: { id: 'bug47-packed', name: 'BUG-47 packed', default_branch: 'main' },
      roles: { dev: { title: 'Dev', mandate: 'x', write_authority: 'authoritative', runtime: 'local-dev' } },
      runtimes: { 'local-dev': { type: 'local_cli', command: 'node', args: ['-e', 'process.exit(0)'] } },
      routing: { implementation: { entry_role: 'dev', allowed_next_roles: ['dev'], exit_gate: 'implementation_signoff' } },
      gates: { implementation_signoff: {} },
      // Override the 10-minute default to 60s so the 120s-old started_at is
      // definitively past threshold without making the test wall-clock slow.
      // Also pin startup_watchdog_ms above the lifecycle age so the BUG-51
      // ghost detector does NOT fire on this turn — proving the path-split
      // works on the packaged binary.
      run_loop: { stale_turn_threshold_ms: 60_000, startup_watchdog_ms: 600_000 },
    };

    const result = reconcileStaleTurns(root, state, config);
    assert.equal(result.changed, true,
      'packaged reconcileStaleTurns must report state change when a started-but-silent turn crosses the stale threshold');
    assert.equal(result.ghost_turns.length, 0,
      `packaged BUG-47 path must NOT classify a turn with first-output proof as ghost; ghost_turns.length=${result.ghost_turns.length}`);
    assert.equal(result.stale_turns.length, 1,
      `packaged BUG-47 path must detect exactly 1 stale turn; got ${result.stale_turns.length}`);
    assert.equal(result.stale_turns[0].turn_id, turnId,
      'packaged BUG-47 path must detect the seeded stale turn by id');

    const turnAfter = result.state.active_turns[turnId];
    assert.equal(turnAfter.status, 'stalled',
      `packaged stale turn must transition to stalled (not failed_start); got status=${turnAfter.status}`);
    assert.equal(turnAfter.stalled_reason, 'no_output_within_threshold',
      'packaged stale turn must record stalled_reason=no_output_within_threshold');
    assert.equal(turnAfter.failed_start_reason, undefined,
      'packaged stale turn must NOT carry the BUG-51 failed_start_reason marker — wrong recovery family');
    assert.ok(
      turnAfter.stalled_threshold_ms === 60_000,
      `packaged stale turn must reflect the configured 60s stale threshold; got threshold_ms=${turnAfter.stalled_threshold_ms}`,
    );
    assert.match(turnAfter.recovery_command || '',
      new RegExp(`reissue-turn --turn ${turnId} --reason stale`),
      'packaged stale turn must advertise `reissue-turn --reason stale` (NOT --reason ghost) as the operator recovery command');

    assert.equal(result.state.budget_reservations[turnId], undefined,
      'packaged stale-turn transition must release the lingering budget reservation (BUG-51 fix #6 also applied to stale)');
    assert.equal(result.state.status, 'blocked',
      'packaged stale-turn reconciliation must mark the run blocked so operators see it immediately');

    const eventsPath = join(root, RUN_EVENTS_PATH);
    assert.ok(existsSync(eventsPath),
      'packaged stale-turn reconciliation must write run events to .agentxchain/events.jsonl');
    const events = readFileSync(eventsPath, 'utf8')
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line));
    const eventTypes = events.map((e) => e.event_type);
    assert.ok(eventTypes.includes('turn_stalled'),
      `packaged stale-turn reconciliation must emit a turn_stalled event; got ${eventTypes.join(',')}`);
    assert.ok(eventTypes.includes('run_blocked'),
      `packaged stale-turn reconciliation must emit a run_blocked event so operators are surfaced the halt; got ${eventTypes.join(',')}`);
    assert.equal(eventTypes.includes('turn_start_failed'), false,
      `packaged stale-turn reconciliation must NOT emit BUG-51 startup-failure events for a started-but-silent turn; got ${eventTypes.join(',')}`);
    assert.equal(eventTypes.includes('runtime_spawn_failed'), false,
      `packaged stale-turn reconciliation must NOT emit runtime_spawn_failed for a turn with first-output proof; got ${eventTypes.join(',')}`);

    const blockedEvent = events.find((e) => e.event_type === 'run_blocked');
    assert.equal(blockedEvent?.payload?.category, 'stale_turn',
      `packaged run_blocked event must carry category='stale_turn' (BUG-47), not 'ghost_turn' (BUG-51); got ${blockedEvent?.payload?.category}`);
    assert.deepEqual(blockedEvent?.payload?.stalled_turn_ids || [], [turnId],
      'packaged run_blocked event must list the stale turn id under stalled_turn_ids');
    assert.deepEqual(blockedEvent?.payload?.ghost_turn_ids || [], [],
      'packaged run_blocked event must leave ghost_turn_ids empty for the stale path');
  });

  it('BUG-48 packaged intake clears superseded preemption markers', async () => {
    // No separate "path-split" row is needed for BUG-48: the packaged behavior
    // seam is singular. Either the shipped intake layer clears a stale marker
    // for a superseded intent, or it does not.
    const packedFiles = getPackedFiles();
    const bug48Test = join(SCENARIOS_DIR, 'bug-48-intent-lifecycle-contradiction.test.js');
    assert.ok(existsSync(bug48Test),
      'BUG-48 beta-tester-scenario must exist at cli/test/beta-tester-scenarios/bug-48-intent-lifecycle-contradiction.test.js');
    const imports = extractImports(bug48Test);
    assert.ok(imports.length > 0,
      'BUG-48 test must import production modules');
    const missing = imports.filter(imp => !packedFiles.has(imp));
    assert.equal(missing.length, 0,
      `BUG-48 test imports production files missing from tarball: ${missing.join(', ')}`);
    const testContent = readFileSync(bug48Test, 'utf8');
    assert.ok(testContent.includes('validatePreemptionMarker')
      && testContent.includes('clearPreemptionMarkerForIntent')
      && testContent.includes('superseded')
      && testContent.includes('injected-priority.json'),
    'BUG-48 test must cover stale preemption-marker clearing for superseded intents');

    const { packageDir } = getExtractedPackage();
    const intake = await import(pathToFileURL(join(packageDir, 'src/lib/intake.js')).href);
    const { validatePreemptionMarker } = intake;

    const root = mkdtempSync(join(tmpdir(), 'axc-packed-bug48-'));
    TEMP_PATHS.push(root);
    mkdirSync(join(root, '.agentxchain', 'intake', 'intents'), { recursive: true });
    const intentId = 'intent_bug48_packed';
    const markerPath = join(root, '.agentxchain', 'intake', 'injected-priority.json');
    writeFileSync(join(root, '.agentxchain', 'intake', 'intents', `${intentId}.json`), JSON.stringify({
      schema_version: '1.0',
      intent_id: intentId,
      event_id: 'evt_bug48_packed',
      status: 'superseded',
      priority: 'p0',
      history: [],
    }, null, 2));
    writeFileSync(markerPath, JSON.stringify({
      intent_id: intentId,
      priority: 'p0',
      description: 'packed stale marker',
      injected_at: new Date().toISOString(),
    }, null, 2));

    const validated = validatePreemptionMarker(root);
    assert.equal(validated, null,
      'packed validatePreemptionMarker must return null for a superseded intent');
    assert.equal(existsSync(markerPath), false,
      'packed validatePreemptionMarker must delete injected-priority.json for a superseded intent');
  });

  it('BUG-49 packaged checkpoint advances accepted_integration_ref to the new checkpoint SHA', async () => {
    // No sibling recovery family exists here like BUG-47 vs BUG-51. The packed
    // seam that matters is the terminal checkpoint mutation itself:
    // accepted_integration_ref must advance to the new checkpoint SHA.
    const packedFiles = getPackedFiles();
    const bug49Test = join(SCENARIOS_DIR, 'bug-49-checkpoint-ref-update.test.js');
    assert.ok(existsSync(bug49Test),
      'BUG-49 beta-tester-scenario must exist at cli/test/beta-tester-scenarios/bug-49-checkpoint-ref-update.test.js');
    const imports = extractImports(bug49Test);
    assert.ok(imports.length > 0,
      'BUG-49 test must import production modules');
    const missing = imports.filter(imp => !packedFiles.has(imp));
    assert.equal(missing.length, 0,
      `BUG-49 test imports production files missing from tarball: ${missing.join(', ')}`);
    const testContent = readFileSync(bug49Test, 'utf8');
    assert.ok(testContent.includes('accepted_integration_ref')
      && testContent.includes('checkpointAcceptedTurn')
      && testContent.includes('no false drift'),
    'BUG-49 test must prove accepted_integration_ref advances on checkpoint and drift stays quiet');

    const { packageDir } = getExtractedPackage();
    const governedState = await import(pathToFileURL(join(packageDir, 'src/lib/governed-state.js')).href);
    const checkpointLib = await import(pathToFileURL(join(packageDir, 'src/lib/turn-checkpoint.js')).href);
    const turnPaths = await import(pathToFileURL(join(packageDir, 'src/lib/turn-paths.js')).href);
    const { initializeGovernedRun, assignGovernedTurn, acceptGovernedTurn } = governedState;
    const { checkpointAcceptedTurn } = checkpointLib;
    const { getTurnStagingResultPath } = turnPaths;

    const root = mkdtempSync(join(tmpdir(), 'axc-packed-bug49-'));
    TEMP_PATHS.push(root);
    mkdirSync(join(root, '.agentxchain'), { recursive: true });
    mkdirSync(join(root, '.planning'), { recursive: true });
    writeFileSync(join(root, 'README.md'), '# BUG-49 packed\n');
    const config = {
      schema_version: '1.0',
      protocol_mode: 'governed',
      template: 'generic',
      project: { id: 'bug49-packed', name: 'BUG-49 packed', default_branch: 'main' },
      roles: {
        pm: {
          title: 'Product Marketing',
          mandate: 'Draft copy.',
          write_authority: 'authoritative',
          runtime: 'manual-pm',
        },
      },
      runtimes: { 'manual-pm': { type: 'manual' } },
      routing: {
        planning: { entry_role: 'pm', allowed_next_roles: ['pm'], exit_gate: 'planning_signoff' },
      },
      gates: { planning_signoff: {} },
    };
    writeFileSync(join(root, 'agentxchain.json'), JSON.stringify(config, null, 2) + '\n');
    git(root, ['init', '-b', 'main']);
    git(root, ['config', 'user.email', 'test@test.com']);
    git(root, ['config', 'user.name', 'Test']);
    git(root, ['add', 'README.md', 'agentxchain.json']);
    git(root, ['commit', '-m', 'init']);

    const init = initializeGovernedRun(root, config);
    assert.ok(init.ok, init.error);
    const assign = assignGovernedTurn(root, config, 'pm');
    assert.ok(assign.ok, assign.error);
    const turnId = assign.turn.turn_id;

    writeFileSync(join(root, '.planning', 'MARKETING_COPY.md'), '# Packed marketing copy\n');
    const resultPath = join(root, getTurnStagingResultPath(turnId));
    mkdirSync(join(root, '.agentxchain', 'staging', turnId), { recursive: true });
    writeFileSync(resultPath, JSON.stringify({
      schema_version: '1.0',
      turn_id: turnId,
      run_id: init.state.run_id,
      role: 'pm',
      runtime_id: 'manual-pm',
      status: 'completed',
      summary: 'Packed BUG-49 proof',
      artifact: { type: 'workspace', path: '.' },
      files_changed: ['.planning/MARKETING_COPY.md'],
      decisions: [],
      objections: [],
      verification: { status: 'pass' },
      proposed_next_role: 'pm',
    }, null, 2));

    const accept = acceptGovernedTurn(root, config);
    assert.ok(accept.ok, accept.error);
    const stateAfterAccept = JSON.parse(readFileSync(join(root, '.agentxchain', 'state.json'), 'utf8'));
    assert.ok(stateAfterAccept.accepted_integration_ref,
      'packed BUG-49 proof must set accepted_integration_ref after acceptance');

    const checkpoint = checkpointAcceptedTurn(root, { turnId });
    assert.ok(checkpoint.ok, checkpoint.error);
    assert.ok(checkpoint.checkpoint_sha,
      'packed BUG-49 proof must return a checkpoint SHA');

    const stateAfterCheckpoint = JSON.parse(readFileSync(join(root, '.agentxchain', 'state.json'), 'utf8'));
    assert.equal(stateAfterCheckpoint.accepted_integration_ref, `git:${checkpoint.checkpoint_sha}`,
      'packed checkpointAcceptedTurn must advance accepted_integration_ref to the new checkpoint SHA');
    assert.notEqual(stateAfterCheckpoint.accepted_integration_ref, stateAfterAccept.accepted_integration_ref,
      'packed BUG-49 proof must not leave accepted_integration_ref pinned to the pre-checkpoint ref');
  });

  it('BUG-50 packaged run-history keeps child-run totals isolated from parent history', async () => {
    // BUG-50 is also a single packaged seam, not a path-split bug class. The
    // release-boundary risk is child-run history contamination, so one packed
    // behavioral row that records history and inspects the written entry is the
    // right proof surface.
    const packedFiles = getPackedFiles();
    const bug50Test = join(SCENARIOS_DIR, 'bug-50-run-history-contamination.test.js');
    assert.ok(existsSync(bug50Test),
      'BUG-50 beta-tester-scenario must exist at cli/test/beta-tester-scenarios/bug-50-run-history-contamination.test.js');
    const imports = extractImports(bug50Test);
    assert.ok(imports.length > 0,
      'BUG-50 test must import production modules');
    const missing = imports.filter(imp => !packedFiles.has(imp));
    assert.equal(missing.length, 0,
      `BUG-50 test imports production files missing from tarball: ${missing.join(', ')}`);
    const testContent = readFileSync(bug50Test, 'utf8');
    assert.ok(testContent.includes('recordRunHistory')
      && testContent.includes('queryRunHistory')
      && testContent.includes('phases_completed')
      && testContent.includes('total_turns'),
    'BUG-50 test must prove run-history totals and phase lists stay child-run scoped');

    const { packageDir } = getExtractedPackage();
    const runHistory = await import(pathToFileURL(join(packageDir, 'src/lib/run-history.js')).href);
    const { recordRunHistory, queryRunHistory } = runHistory;

    const root = mkdtempSync(join(tmpdir(), 'axc-packed-bug50-'));
    TEMP_PATHS.push(root);
    mkdirSync(join(root, '.agentxchain'), { recursive: true });

    const parentRunId = 'run_parent_packed';
    const childRunId = 'run_child_packed';
    const historyEntries = [];
    const phases = ['planning', 'implementation', 'qa', 'launch'];
    for (let i = 0; i < 12; i++) {
      historyEntries.push({
        turn_id: `turn_parent_${String(i).padStart(3, '0')}`,
        run_id: parentRunId,
        role: i < 3 ? 'pm' : i < 8 ? 'dev' : 'qa',
        phase: phases[Math.min(Math.floor(i / 3), 3)],
        status: 'completed',
        summary: `Parent turn ${i}`,
        decisions: [],
      });
    }
    historyEntries.push({
      turn_id: 'turn_child_001',
      run_id: childRunId,
      role: 'pm',
      phase: 'planning',
      status: 'completed',
      summary: 'Child turn',
      decisions: [],
    });
    writeFileSync(
      join(root, '.agentxchain', 'history.jsonl'),
      historyEntries.map((entry) => JSON.stringify(entry)).join('\n') + '\n',
    );

    const result = recordRunHistory(root, {
      run_id: childRunId,
      phase: 'planning',
      status: 'active',
      phase_gate_status: {
        planning_signoff: 'pending',
        implementation_complete: 'pending',
        qa_ship_verdict: 'pending',
        launch_approval: 'pending',
      },
      provenance: { trigger: 'manual', parent_run_id: parentRunId },
      inherited_context: {
        parent_run_id: parentRunId,
        parent_status: 'completed',
        inherited_at: '2026-04-19T00:00:00.000Z',
      },
    }, {
      project: { id: 'bug50-packed', name: 'BUG-50 packed' },
      roles: { pm: { runtime_id: 'manual' } },
    }, 'completed');
    assert.ok(result.ok, result.error);

    const entries = queryRunHistory(root);
    assert.equal(entries.length, 1,
      'packed BUG-50 proof must write exactly one run-history record');
    assert.equal(entries[0].run_id, childRunId,
      'packed BUG-50 proof must record the child run, not the parent');
    assert.equal(entries[0].total_turns, 1,
      'packed BUG-50 proof must keep total_turns scoped to the child run');
    assert.deepEqual(entries[0].phases_completed, ['planning'],
      'packed BUG-50 proof must keep phases_completed scoped to the child run');
  });

  it('BUG-51 fast-startup watchdog proof exists and its production imports are packed', () => {
    const packedFiles = getPackedFiles();
    const bug51Test = join(SCENARIOS_DIR, 'bug-51-fast-startup-watchdog.test.js');
    assert.ok(existsSync(bug51Test),
      'BUG-51 fast-startup watchdog beta-tester-scenario must exist at cli/test/beta-tester-scenarios/bug-51-fast-startup-watchdog.test.js');
    const imports = extractImports(bug51Test);
    assert.ok(imports.length > 0,
      'BUG-51 fast-startup watchdog test must import production modules');
    const missing = imports.filter(imp => !packedFiles.has(imp));
    assert.equal(missing.length, 0,
      `BUG-51 test imports production files missing from tarball: ${missing.join(', ')}`);
    // Ensure the watchdog sources themselves are in the tarball — the tester
    // critique (11 minutes → 30 seconds) is the whole point of this bug, so the
    // packed binary must carry the fast-startup watchdog implementation, not
    // just the slow stale-turn watchdog.
    assert.ok(packedFiles.has('src/lib/stale-turn-watchdog.js'),
      'BUG-51 packed tarball must include src/lib/stale-turn-watchdog.js (detectGhostTurns + failTurnStartup live here)');
    assert.ok(packedFiles.has('src/lib/run-events.js'),
      'BUG-51 packed tarball must include src/lib/run-events.js (typed startup-failure events live here)');
    assert.ok(packedFiles.has('src/lib/run-loop.js'),
      'BUG-51 packed tarball must include src/lib/run-loop.js (startup lifecycle transitions live here)');
    assert.ok(packedFiles.has('src/lib/dispatch-progress.js'),
      'BUG-51 packed tarball must include src/lib/dispatch-progress.js (first-output heartbeat lives here)');
    assert.ok(packedFiles.has('src/lib/adapters/local-cli-adapter.js'),
      'BUG-51 packed tarball must include src/lib/adapters/local-cli-adapter.js (the spawn-attach truth boundary lives here)');
    const testContent = readFileSync(bug51Test, 'utf8');
    assert.ok(testContent.includes('detectGhostTurns') && testContent.includes('reconcileStaleTurns'),
      'BUG-51 test must exercise both ghost-detection and reconciliation surfaces');
    assert.ok(testContent.includes('failed_start') && testContent.includes('runtime_spawn_failed') && testContent.includes('stdout_attach_failed'),
      'BUG-51 test must cover the typed startup-failure vocabulary (failed_start / runtime_spawn_failed / stdout_attach_failed)');
    assert.ok(testContent.includes('startup_watchdog_ms'),
      'BUG-51 test must configure the operator-facing startup_watchdog_ms knob, not just rely on defaults');
    assert.ok(testContent.includes('reissue-turn') && testContent.includes('ghost'),
      'BUG-51 test must prove the operator-facing `reissue-turn --reason ghost` recovery path is advertised');
  });

  it('BUG-51 packaged tarball ships the fast-startup watchdog implementation', () => {
    const { packageDir } = getExtractedPackage();
    const packedWatchdog = readFileSync(join(packageDir, 'src/lib/stale-turn-watchdog.js'), 'utf8');
    assert.match(packedWatchdog, /export function detectGhostTurns\b/,
      'packed stale-turn-watchdog.js must export detectGhostTurns — the BUG-51 fast-startup detector');
    assert.match(packedWatchdog, /export function failTurnStartup\b/,
      'packed stale-turn-watchdog.js must export failTurnStartup — the operator-visible startup-failure transition');
    assert.match(packedWatchdog, /run_loop\?\.startup_watchdog_ms/,
      'packed stale-turn-watchdog.js must honor run_loop.startup_watchdog_ms so operators can tune the 30s default');
    assert.match(packedWatchdog, /status:\s*'failed_start'/,
      'packed stale-turn-watchdog.js must transition ghost turns to failed_start, not the slow "stalled" state');
    assert.match(packedWatchdog, /delete budgetReservations\[/,
      'packed stale-turn-watchdog.js must release budget reservations on startup failure (BUG-51 fix #6)');
    assert.match(packedWatchdog, /reissue-turn --turn .* --reason ghost/,
      'packed stale-turn-watchdog.js must surface the `reissue-turn --reason ghost` recovery command');

    const packedEvents = readFileSync(join(packageDir, 'src/lib/run-events.js'), 'utf8');
    assert.match(packedEvents, /'turn_start_failed'/,
      'packed run-events.js must declare turn_start_failed in VALID_RUN_EVENTS (BUG-51 startup-event contract)');
    assert.match(packedEvents, /'runtime_spawn_failed'/,
      'packed run-events.js must declare runtime_spawn_failed in VALID_RUN_EVENTS (BUG-51 typed subtype)');
    assert.match(packedEvents, /'stdout_attach_failed'/,
      'packed run-events.js must declare stdout_attach_failed in VALID_RUN_EVENTS (BUG-51 typed subtype)');

    const packedRunLoop = readFileSync(join(packageDir, 'src/lib/run-loop.js'), 'utf8');
    assert.match(packedRunLoop, /hasMinimumTurnResultShape/,
      'packed run-loop.js must enforce the minimum staged-result envelope at the SDK boundary (DEC-RUN-LOOP-MIN-SHAPE-SYMMETRY-001)');

    const packedLocalCliAdapter = readFileSync(join(packageDir, 'src/lib/adapters/local-cli-adapter.js'), 'utf8');
    assert.match(packedLocalCliAdapter, /child\.once\('spawn'/,
      'packed local-cli-adapter.js must treat the child `spawn` event as the worker-attachment proof boundary, not child-process object creation');
    assert.match(packedLocalCliAdapter, /startupFailureType:\s*'runtime_spawn_failed'/,
      'packed local-cli-adapter.js must retain the typed runtime_spawn_failed path when a child never reports a successful spawn');
  });

  it('BUG-51 packaged CLI detects a ghost turn and transitions to failed_start within the startup window', async () => {
    const { packageDir } = getExtractedPackage();
    const watchdog = await import(pathToFileURL(join(packageDir, 'src/lib/stale-turn-watchdog.js')).href);
    const runEvents = await import(pathToFileURL(join(packageDir, 'src/lib/run-events.js')).href);
    const { reconcileStaleTurns } = watchdog;
    const { RUN_EVENTS_PATH } = runEvents;

    // Seed a .agentxchain/ state with a dispatched turn whose `dispatched_at`
    // is 60 seconds in the past — well past the 30s startup watchdog default —
    // and no first-output proof, no staged result, no dispatch-progress file.
    // This is the packaged-binary version of the tester's 11-minute ghost.
    const root = mkdtempSync(join(tmpdir(), 'axc-packed-bug51-'));
    TEMP_PATHS.push(root);
    mkdirSync(join(root, '.agentxchain'), { recursive: true });

    const runId = 'run_bug51_packed_smoke';
    const turnId = 'turn_bug51_ghost_packed';
    const dispatchedAt = new Date(Date.now() - 60_000).toISOString();
    const state = {
      schema_version: '1.0',
      run_id: runId,
      phase: 'implementation',
      status: 'running',
      active_turns: {
        [turnId]: {
          turn_id: turnId,
          assigned_role: 'dev',
          runtime_id: 'local-dev',
          status: 'dispatched',
          assigned_at: dispatchedAt,
          dispatched_at: dispatchedAt,
        },
      },
      budget_reservations: {
        [turnId]: { role: 'dev', estimate_usd: 2.0, reserved_at: dispatchedAt },
      },
    };
    writeFileSync(join(root, '.agentxchain', 'state.json'), JSON.stringify(state, null, 2));

    const config = {
      schema_version: '1.0',
      protocol_mode: 'governed',
      project: { id: 'bug51-packed', name: 'BUG-51 packed', default_branch: 'main' },
      roles: { dev: { title: 'Dev', mandate: 'x', write_authority: 'authoritative', runtime: 'local-dev' } },
      runtimes: { 'local-dev': { type: 'local_cli', command: 'node', args: ['-e', 'process.exit(0)'] } },
      routing: { implementation: { entry_role: 'dev', allowed_next_roles: ['dev'], exit_gate: 'implementation_signoff' } },
      gates: { implementation_signoff: {} },
      run_loop: { startup_watchdog_ms: 30_000 },
    };

    const result = reconcileStaleTurns(root, state, config);
    assert.equal(result.changed, true,
      'packaged reconcileStaleTurns must report state change when a ghost turn crosses the startup threshold');
    assert.equal(result.ghost_turns.length, 1,
      `packaged reconcileStaleTurns must detect exactly 1 ghost turn; got ${result.ghost_turns.length}`);
    assert.equal(result.ghost_turns[0].turn_id, turnId,
      'packaged reconcileStaleTurns must detect the seeded ghost turn by id');
    assert.equal(result.ghost_turns[0].failure_type, 'runtime_spawn_failed',
      'a turn stuck in `dispatched` with no output must classify as runtime_spawn_failed, not stdout_attach_failed');

    const turnAfter = result.state.active_turns[turnId];
    assert.equal(turnAfter.status, 'failed_start',
      `packaged ghost turn must transition to failed_start; got status=${turnAfter.status}`);
    assert.equal(turnAfter.failed_start_reason, 'runtime_spawn_failed',
      'packaged ghost turn must record failed_start_reason=runtime_spawn_failed');
    assert.ok(
      turnAfter.failed_start_threshold_ms <= 30_000,
      `packaged ghost turn must trip the 30s default startup window, not the 10m stale window; got threshold_ms=${turnAfter.failed_start_threshold_ms}`,
    );
    assert.match(turnAfter.recovery_command || '',
      new RegExp(`reissue-turn --turn ${turnId} --reason ghost`),
      'packaged ghost turn must advertise `reissue-turn --reason ghost` as the operator recovery command');

    assert.equal(result.state.budget_reservations[turnId], undefined,
      'packaged ghost-turn transition must release the lingering budget reservation (BUG-51 fix #6)');
    assert.equal(result.state.status, 'blocked',
      'packaged ghost-turn reconciliation must mark the run blocked so operators see it immediately');

    const eventsPath = join(root, RUN_EVENTS_PATH);
    assert.ok(existsSync(eventsPath),
      'packaged ghost-turn reconciliation must write run events to .agentxchain/events.jsonl');
    const events = readFileSync(eventsPath, 'utf8')
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line));
    const eventTypes = events.map((e) => e.event_type);
    assert.ok(eventTypes.includes('turn_start_failed'),
      `packaged ghost-turn reconciliation must emit a turn_start_failed event; got ${eventTypes.join(',')}`);
    assert.ok(eventTypes.includes('runtime_spawn_failed'),
      `packaged ghost-turn reconciliation must emit the typed runtime_spawn_failed subtype; got ${eventTypes.join(',')}`);
    assert.ok(eventTypes.includes('run_blocked'),
      `packaged ghost-turn reconciliation must emit a run_blocked event so operators are surfaced the halt; got ${eventTypes.join(',')}`);
  });

  it('BUG-51 packaged local-cli adapter rejects a nonexistent binary as runtime_spawn_failed without firing onSpawnAttached', async () => {
    // Companion to "BUG-51 packaged CLI detects a ghost turn ..." above.
    // That test exercises the watchdog/reconciliation seam against state on
    // disk. This test exercises the OTHER half of DEC-BUG51-SPAWN-ATTACH-
    // TRUTH-001: the packed local-cli adapter itself must refuse to fire the
    // worker-attachment callback for a binary that never reports a successful
    // Node `spawn` event. The previous bug class (tester's 11-minute ghost)
    // started here — child-process object creation was treated as worker
    // attachment, so governed state stamped fake `worker_attached_at` /
    // `worker_pid` for processes that never actually ran. The Turn 40 fix
    // moved the boundary to `child.once('spawn', ...)`. This row locks that
    // contract at the published-tarball boundary so a packaging regression
    // (e.g., minification, transform, file omission) cannot silently restore
    // the old "child object exists ⇒ worker attached" lie.
    const { packageDir } = getExtractedPackage();
    const adapterPath = join(packageDir, 'src/lib/adapters/local-cli-adapter.js');
    assert.ok(existsSync(adapterPath),
      'BUG-51 packed tarball must include src/lib/adapters/local-cli-adapter.js before the packaged behavioral row can prove the spawn-attach contract');
    const adapter = await import(pathToFileURL(adapterPath).href);
    const { dispatchLocalCli } = adapter;

    const root = mkdtempSync(join(tmpdir(), 'axc-packed-bug51-spawn-'));
    TEMP_PATHS.push(root);

    const turnId = 'turn_packed_nonexistent_binary';
    // Adapter requires a dispatch bundle on disk before spawning; without
    // PROMPT.md it short-circuits with "Dispatch bundle not found" instead
    // of reaching the spawn path we want to test. Bundle layout is owned by
    // turn-paths.js (`.agentxchain/dispatch/turns/<turn_id>/`).
    const dispatchDir = join(root, '.agentxchain', 'dispatch', 'turns', turnId);
    mkdirSync(dispatchDir, { recursive: true });
    writeFileSync(join(dispatchDir, 'PROMPT.md'), '# packed bug51 spawn-attach truth proof\n');
    writeFileSync(join(dispatchDir, 'CONTEXT.md'), '');

    const state = {
      schema_version: '1.0',
      run_id: 'run_packed_bug51_spawn',
      phase: 'implementation',
      status: 'running',
      active_turns: {
        [turnId]: {
          turn_id: turnId,
          assigned_role: 'dev',
          runtime_id: 'local-dev',
          status: 'dispatched',
          attempt: 1,
          deadline_at: new Date(Date.now() + 60_000).toISOString(),
        },
      },
    };

    const config = {
      schema_version: '1.0',
      protocol_mode: 'governed',
      project: { id: 'bug51-packed-spawn', name: 'BUG-51 packed spawn', default_branch: 'main' },
      roles: { dev: { title: 'Dev', mandate: 'x', write_authority: 'authoritative', runtime: 'local-dev' } },
      runtimes: {
        'local-dev': {
          type: 'local_cli',
          command: ['__no_such_binary_xyz_bug51_packed__'],
          cwd: '.',
          prompt_transport: 'dispatch_bundle_only',
        },
      },
      routing: { implementation: { entry_role: 'dev', allowed_next_roles: ['dev'], exit_gate: 'implementation_signoff' } },
      gates: { implementation_signoff: {} },
      run_loop: { startup_watchdog_ms: 5_000 },
    };

    const attached = [];
    const firstOutput = [];
    const result = await dispatchLocalCli(root, state, config, {
      turnId,
      skipManifestVerification: true,
      onSpawnAttached: (details) => attached.push(details),
      onFirstOutput: (details) => firstOutput.push(details),
    });

    assert.equal(result.ok, false,
      'packaged dispatchLocalCli must report failure for a runtime whose binary does not exist');
    assert.equal(result.startupFailure, true,
      'packaged dispatchLocalCli must mark a never-spawned subprocess as a startup failure (not a generic exit)');
    assert.equal(result.startupFailureType, 'runtime_spawn_failed',
      'packaged dispatchLocalCli must classify a never-spawned subprocess as runtime_spawn_failed (DEC-BUG51-SPAWN-ATTACH-TRUTH-001) — the ghost-turn family lives here');
    assert.equal(attached.length, 0,
      'packaged dispatchLocalCli must NOT fire onSpawnAttached for a binary that never reports a Node `spawn` event — firing it would let governed-state.js stamp fake worker_attached_at/worker_pid, which is the exact lie the tester reported as the BUG-51 root cause');
    assert.equal(firstOutput.length, 0,
      'packaged dispatchLocalCli must NOT fire onFirstOutput for a binary that never spawned');
  });

  it('scenario test count matches expected range', () => {
    const scenarioFiles = readdirSync(SCENARIOS_DIR)
      .filter(f => f.endsWith('.test.js') && f.startsWith('bug-'));
    // There should be at least 30 bug scenario files (BUG-1 through BUG-39,
    // minus the few that share files). If the count drops, someone deleted a
    // regression test.
    assert.ok(scenarioFiles.length >= 30,
      `Expected at least 30 bug scenario files, found ${scenarioFiles.length}. ` +
      `Beta-tester regression tests must not be deleted.`);
  });
});
