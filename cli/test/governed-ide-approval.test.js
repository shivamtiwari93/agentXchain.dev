import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { scaffoldGoverned } from '../src/commands/init.js';
import { importCompiledVsCodeExtensionModule } from './helpers/vscode-extension-test-helpers.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..', '..');
const CLI_BIN = join(REPO_ROOT, 'cli', 'bin', 'agentxchain.js');
const EXTENSION_ROOT = join(REPO_ROOT, 'cli', 'vscode-extension');

let governedStatusModule;
const tempDirs = [];
const originalCliPath = process.env.AGENTXCHAIN_CLI_PATH;

before(async () => {
  process.env.AGENTXCHAIN_CLI_PATH = CLI_BIN;
  governedStatusModule = await importCompiledVsCodeExtensionModule('governedStatus.js');
});

after(() => {
  if (originalCliPath == null) {
    delete process.env.AGENTXCHAIN_CLI_PATH;
  } else {
    process.env.AGENTXCHAIN_CLI_PATH = originalCliPath;
  }

  for (const dir of tempDirs) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function createGovernedFixture(overrides = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'axc-ide-approve-'));
  tempDirs.push(dir);
  scaffoldGoverned(dir, 'IDE Approval Fixture', 'ide-approval-fixture');

  const statePath = join(dir, '.agentxchain', 'state.json');
  const state = JSON.parse(readFileSync(statePath, 'utf8'));
  Object.assign(state, {
    status: 'active',
    phase: 'implementation',
    run_id: 'run_approval_test',
    turn_sequence: 3,
    blocked: false,
    blocked_on: null,
    active_turns: {},
    ...overrides,
  });
  writeFileSync(statePath, `${JSON.stringify(state, null, 2)}\n`);

  writeFileSync(
    join(dir, '.agentxchain', 'session.json'),
    `${JSON.stringify({
      session_id: 'session_approval_test',
      run_id: 'run_approval_test',
      last_checkpoint_at: '2026-04-10T12:00:00Z',
      last_turn_id: 'turn-003',
      last_role: 'dev',
      checkpoint_reason: 'turn_accepted',
    }, null, 2)}\n`
  );

  return dir;
}

function runCli(cwd, args) {
  return spawnSync(process.execPath, [CLI_BIN, ...args], {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, NO_COLOR: '1' },
    timeout: 20_000,
  });
}

describe('governed IDE approval commands', () => {
  it('approve-transition succeeds via CLI subprocess when a pending phase transition exists', () => {
    const dir = createGovernedFixture({
      status: 'paused',
      pending_phase_transition: {
        from: 'implementation',
        to: 'qa',
        gate: 'implementation_signoff',
        requested_by_turn: 'turn-003',
      },
    });

    const result = runCli(dir, ['approve-transition']);
    assert.equal(result.status, 0, `approve-transition should exit 0, stderr: ${result.stderr}`);
    assert.match(result.stdout, /Phase advanced|Approving Phase Transition/i);

    // Verify state was mutated by the CLI
    const statePath = join(dir, '.agentxchain', 'state.json');
    const state = JSON.parse(readFileSync(statePath, 'utf8'));
    assert.equal(state.phase, 'qa', 'phase should advance to qa');
    assert.equal(state.pending_phase_transition, null, 'pending_phase_transition should be cleared');
  });

  it('approve-transition fails gracefully when no transition is pending', () => {
    const dir = createGovernedFixture({
      pending_phase_transition: null,
    });

    const result = runCli(dir, ['approve-transition']);
    assert.notEqual(result.status, 0, 'approve-transition should fail with non-zero exit');
    assert.match(result.stdout + result.stderr, /No pending phase transition/i);
  });

  it('approve-completion succeeds via CLI subprocess when a pending run completion exists', () => {
    const dir = createGovernedFixture({
      status: 'paused',
      phase: 'qa',
      pending_run_completion: {
        gate: 'qa_ship_verdict',
        requested_by_turn: 'turn-003',
      },
    });

    const result = runCli(dir, ['approve-completion']);
    assert.equal(result.status, 0, `approve-completion should exit 0, stderr: ${result.stderr}`);
    assert.match(result.stdout, /Run completed|Approving Run Completion/i);

    // Verify state was mutated by the CLI
    const statePath = join(dir, '.agentxchain', 'state.json');
    const state = JSON.parse(readFileSync(statePath, 'utf8'));
    assert.equal(state.status, 'completed', 'status should be completed');
    assert.equal(state.pending_run_completion, null, 'pending_run_completion should be cleared');
    assert.ok(state.completed_at, 'completed_at should be set');
  });

  it('approve-completion fails gracefully when no completion is pending', () => {
    const dir = createGovernedFixture({
      pending_run_completion: null,
    });

    const result = runCli(dir, ['approve-completion']);
    assert.notEqual(result.status, 0, 'approve-completion should fail with non-zero exit');
    assert.match(result.stdout + result.stderr, /No pending run completion/i);
  });
});

describe('governed IDE approval extension integration', () => {
  it('execCliCommand is exported and callable from the extension module', () => {
    assert.equal(typeof governedStatusModule.execCliCommand, 'function', 'execCliCommand must be an exported function');
  });

  it('execCliCommand returns status --json for a governed fixture', async () => {
    const dir = createGovernedFixture();
    const { stdout } = await governedStatusModule.execCliCommand(dir, ['status', '--json']);
    const payload = JSON.parse(stdout);
    assert.equal(payload.protocol_mode, 'governed');
    assert.ok(payload.state, 'payload must include state');
    assert.equal(payload.state.phase, 'implementation');
  });

  it('sidebar HTML includes approval buttons when pending transition exists', async () => {
    const dir = createGovernedFixture({
      status: 'paused',
      pending_phase_transition: {
        from: 'implementation',
        to: 'qa',
        gate: 'implementation_signoff',
      },
    });

    const payload = await governedStatusModule.loadGovernedStatus(dir);
    const html = governedStatusModule.renderGovernedStatusHtml(payload, 'Test boundary');
    assert.match(html, /approveTransition/, 'HTML should contain approve transition command link');
    assert.match(html, /Approve Transition/, 'HTML should show Approve Transition button text');
  });

  it('sidebar HTML includes approval buttons when pending completion exists', async () => {
    const dir = createGovernedFixture({
      status: 'paused',
      phase: 'qa',
      pending_run_completion: {
        gate: 'qa_ship_verdict',
      },
    });

    const payload = await governedStatusModule.loadGovernedStatus(dir);
    const html = governedStatusModule.renderGovernedStatusHtml(payload, 'Test boundary');
    assert.match(html, /approveCompletion/, 'HTML should contain approve completion command link');
    assert.match(html, /Approve Completion/, 'HTML should show Approve Completion button text');
  });

  it('sidebar HTML does NOT show approval buttons when no gates are pending', async () => {
    const dir = createGovernedFixture({
      pending_phase_transition: null,
      pending_run_completion: null,
    });

    const payload = await governedStatusModule.loadGovernedStatus(dir);
    const html = governedStatusModule.renderGovernedStatusHtml(payload, 'Test boundary');
    assert.doesNotMatch(html, /approveTransition/, 'no transition button when no transition pending');
    assert.doesNotMatch(html, /approveCompletion/, 'no completion button when no completion pending');
  });
});

describe('governed IDE approval mutation boundary', () => {
  it('approval command sources do not write to .agentxchain directly', () => {
    const approveTransitionSrc = readFileSync(
      join(EXTENSION_ROOT, 'src', 'commands', 'approve-transition.ts'), 'utf8'
    );
    const approveCompletionSrc = readFileSync(
      join(EXTENSION_ROOT, 'src', 'commands', 'approve-completion.ts'), 'utf8'
    );
    const combined = approveTransitionSrc + '\n' + approveCompletionSrc;

    assert.doesNotMatch(combined, /writeFileSync/, 'approval commands must not use writeFileSync');
    assert.doesNotMatch(combined, /writeJson/, 'approval commands must not use writeJson');
    assert.doesNotMatch(combined, /mkdirSync/, 'approval commands must not create directories');

    // Must use execCliCommand — the subprocess boundary
    assert.match(approveTransitionSrc, /execCliCommand/, 'approve-transition must use execCliCommand');
    assert.match(approveCompletionSrc, /execCliCommand/, 'approve-completion must use execCliCommand');
  });

  it('package.json declares both approval commands', () => {
    const pkg = JSON.parse(readFileSync(join(EXTENSION_ROOT, 'package.json'), 'utf8'));
    const commandIds = pkg.contributes.commands.map(c => c.command);
    assert.ok(commandIds.includes('agentxchain.approveTransition'), 'approveTransition must be declared');
    assert.ok(commandIds.includes('agentxchain.approveCompletion'), 'approveCompletion must be declared');
  });

  it('commands/index.ts registers both approval commands', () => {
    const indexSrc = readFileSync(join(EXTENSION_ROOT, 'src', 'commands', 'index.ts'), 'utf8');
    assert.match(indexSrc, /agentxchain\.approveTransition/, 'index must register approveTransition');
    assert.match(indexSrc, /agentxchain\.approveCompletion/, 'index must register approveCompletion');
  });
});
