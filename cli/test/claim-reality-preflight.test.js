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
