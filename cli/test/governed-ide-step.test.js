import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { scaffoldGoverned } from '../src/commands/init.js';
import { importCompiledVsCodeExtensionModule } from '../test-support/vscode-extension-test-helpers.js';

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
  const dir = mkdtempSync(join(tmpdir(), 'axc-ide-step-'));
  tempDirs.push(dir);
  scaffoldGoverned(dir, 'IDE Step Fixture', 'ide-step-fixture');

  const statePath = join(dir, '.agentxchain', 'state.json');
  const state = JSON.parse(readFileSync(statePath, 'utf8'));
  Object.assign(state, {
    status: 'active',
    phase: 'implementation',
    run_id: 'run_step_test',
    turn_sequence: 4,
    blocked: false,
    blocked_on: null,
    pending_phase_transition: null,
    pending_run_completion: null,
    ...overrides,
  });
  writeFileSync(statePath, `${JSON.stringify(state, null, 2)}\n`);

  writeFileSync(
    join(dir, '.agentxchain', 'session.json'),
    `${JSON.stringify({
      session_id: 'session_step_test',
      run_id: 'run_step_test',
      last_checkpoint_at: '2026-04-10T16:00:00Z',
      last_turn_id: 'turn-004',
      last_role: 'dev',
      checkpoint_reason: 'turn_accepted',
    }, null, 2)}\n`
  );

  return dir;
}

describe('governed IDE step helpers', () => {
  it('returns a dispatch step action for an active governed run with no pending gates', async () => {
    const dir = createGovernedFixture();
    const payload = await governedStatusModule.loadGovernedStatus(dir);
    const action = governedStatusModule.getGovernedStepAction(payload);

    assert.deepEqual(action, {
      cliArgs: ['step'],
      label: 'Dispatch Step',
    });
  });

  it('returns a resume step action when continuity recommends step --resume', () => {
    const action = governedStatusModule.getGovernedStepAction({
      protocol_mode: 'governed',
      state: {
        status: 'blocked',
        blocked: true,
        pending_phase_transition: null,
        pending_run_completion: null,
      },
      continuity: {
        recommended_command: 'agentxchain step --resume --turn turn_conflict_01',
      },
    });

    assert.deepEqual(action, {
      cliArgs: ['step', '--resume', '--turn', 'turn_conflict_01'],
      label: 'Resume Step',
    });
  });

  it('does not offer a step action while a pending approval gate exists', async () => {
    const dir = createGovernedFixture({
      status: 'paused',
      pending_phase_transition: {
        from: 'implementation',
        to: 'qa',
        gate: 'implementation_signoff',
      },
    });
    const payload = await governedStatusModule.loadGovernedStatus(dir);

    assert.equal(governedStatusModule.getGovernedStepAction(payload), null);
  });

  it('builds a shell command that respects AGENTXCHAIN_CLI_PATH for local testing', () => {
    const command = governedStatusModule.buildCliShellCommand(['step', '--resume']);
    assert.match(command, new RegExp(process.execPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    assert.match(command, new RegExp(CLI_BIN.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    assert.match(command, /\bstep\b/);
    assert.match(command, /--resume/);
  });
});

describe('governed IDE step sidebar surface', () => {
  it('renders a Dispatch Step button when governed step dispatch is valid', async () => {
    const dir = createGovernedFixture();
    const payload = await governedStatusModule.loadGovernedStatus(dir);
    const html = governedStatusModule.renderGovernedStatusHtml(payload, 'Boundary test');

    assert.match(html, /command:agentxchain\.step/, 'step command link must be present');
    assert.match(html, /Dispatch Step/, 'dispatch step button text must render');
  });

  it('does not render a step button while a governed approval gate is pending', async () => {
    const dir = createGovernedFixture({
      status: 'paused',
      pending_run_completion: {
        gate: 'qa_ship_verdict',
      },
    });
    const payload = await governedStatusModule.loadGovernedStatus(dir);
    const html = governedStatusModule.renderGovernedStatusHtml(payload, 'Boundary test');

    assert.doesNotMatch(html, /command:agentxchain\.step/, 'step command link must be hidden while gates are pending');
  });
});

describe('governed IDE step mutation boundary', () => {
  it('step command source launches an integrated terminal and does not write governed files directly', () => {
    const source = readFileSync(join(EXTENSION_ROOT, 'src', 'commands', 'step.ts'), 'utf8');
    assert.match(source, /createTerminal/, 'step command must launch an integrated terminal');
    assert.match(source, /buildCliShellCommand/, 'step command must use the shared CLI command builder');
    assert.doesNotMatch(source, /writeFileSync/, 'step command must not use writeFileSync');
    assert.doesNotMatch(source, /writeJson/, 'step command must not use writeJson');
    assert.doesNotMatch(source, /mkdirSync/, 'step command must not create governed artifacts');
  });

  it('package.json declares the governed step command and commands/index.ts registers it', () => {
    const pkg = JSON.parse(readFileSync(join(EXTENSION_ROOT, 'package.json'), 'utf8'));
    const commandIds = pkg.contributes.commands.map((entry) => entry.command);
    assert.ok(commandIds.includes('agentxchain.step'), 'package.json must declare agentxchain.step');

    const indexSource = readFileSync(join(EXTENSION_ROOT, 'src', 'commands', 'index.ts'), 'utf8');
    assert.match(indexSource, /agentxchain\.step/, 'commands/index.ts must register agentxchain.step');
  });
});
