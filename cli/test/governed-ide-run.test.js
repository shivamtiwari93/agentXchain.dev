import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
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
  const dir = mkdtempSync(join(tmpdir(), 'axc-ide-run-'));
  tempDirs.push(dir);
  scaffoldGoverned(dir, 'IDE Run Fixture', 'ide-run-fixture');

  const statePath = join(dir, '.agentxchain', 'state.json');
  const state = JSON.parse(readFileSync(statePath, 'utf8'));
  Object.assign(state, {
    status: 'idle',
    phase: 'implementation',
    run_id: 'run_ide_run_test',
    turn_sequence: 0,
    blocked: false,
    blocked_on: null,
    pending_phase_transition: null,
    pending_run_completion: null,
    ...overrides,
  });
  writeFileSync(statePath, `${JSON.stringify(state, null, 2)}\n`);

  return dir;
}

describe('governed IDE run helpers', () => {
  it('returns a start run action for an idle governed run with no pending gates', async () => {
    const dir = createGovernedFixture();
    const payload = await governedStatusModule.loadGovernedStatus(dir);
    const action = governedStatusModule.getGovernedRunAction(payload);

    assert.deepEqual(action, {
      cliArgs: ['run'],
      label: 'Start Run',
    });
  });

  it('returns a resume run action for an active governed run with no pending gates', async () => {
    const dir = createGovernedFixture({
      status: 'active',
      turn_sequence: 4,
    });
    const payload = await governedStatusModule.loadGovernedStatus(dir);
    const action = governedStatusModule.getGovernedRunAction(payload);

    assert.deepEqual(action, {
      cliArgs: ['run'],
      label: 'Resume Run',
    });
  });

  it('does not offer a run action while an approval gate is pending', async () => {
    const dir = createGovernedFixture({
      status: 'paused',
      pending_run_completion: {
        gate: 'qa_ship_verdict',
      },
    });
    const payload = await governedStatusModule.loadGovernedStatus(dir);

    assert.equal(governedStatusModule.getGovernedRunAction(payload), null);
  });

  it('does not offer a run action for blocked or terminal governed states', async () => {
    const blocked = governedStatusModule.getGovernedRunAction({
      protocol_mode: 'governed',
      state: {
        status: 'blocked',
        blocked: true,
      },
    });
    const completed = governedStatusModule.getGovernedRunAction({
      protocol_mode: 'governed',
      state: {
        status: 'completed',
      },
    });

    assert.equal(blocked, null);
    assert.equal(completed, null);
  });
});

describe('governed IDE run sidebar surface', () => {
  it('renders a Start Run button when governed run launch is valid', async () => {
    const dir = createGovernedFixture();
    const payload = await governedStatusModule.loadGovernedStatus(dir);
    const html = governedStatusModule.renderGovernedStatusHtml(payload, 'Boundary test');

    assert.match(html, /command:agentxchain\.run/, 'run command link must be present');
    assert.match(html, /Start Run/, 'start run button text must render');
  });

  it('does not render a run button when the run is blocked', async () => {
    const payload = {
      protocol_mode: 'governed',
      config: {
        project: { name: 'IDE Run Fixture' },
      },
      state: {
        status: 'blocked',
        phase: 'implementation',
        blocked: true,
        blocked_reason: 'human review required',
        turn_sequence: 4,
      },
    };
    const html = governedStatusModule.renderGovernedStatusHtml(payload, 'Boundary test');

    assert.doesNotMatch(html, /command:agentxchain\.run/, 'run command link must be hidden for blocked runs');
  });
});

describe('governed IDE run mutation boundary', () => {
  it('run command source launches an integrated terminal and does not write governed files directly', () => {
    const runSource = readFileSync(join(EXTENSION_ROOT, 'src', 'commands', 'run.ts'), 'utf8');
    const terminalSource = readFileSync(join(EXTENSION_ROOT, 'src', 'runTerminal.ts'), 'utf8');
    const combined = `${runSource}\n${terminalSource}`;

    assert.match(runSource, /launchGovernedRunTerminal/, 'run command must use the shared run terminal helper');
    assert.match(terminalSource, /createTerminal/, 'run terminal helper must launch an integrated terminal');
    assert.match(terminalSource, /buildCliShellCommand/, 'run terminal helper must build the CLI shell command');
    assert.doesNotMatch(combined, /writeFileSync/, 'run sources must not use writeFileSync');
    assert.doesNotMatch(combined, /writeJson/, 'run sources must not use writeJson');
    assert.doesNotMatch(combined, /mkdirSync/, 'run sources must not create governed artifacts');
  });

  it('package.json declares the governed run command and commands/index.ts registers it', () => {
    const pkg = JSON.parse(readFileSync(join(EXTENSION_ROOT, 'package.json'), 'utf8'));
    const commandIds = pkg.contributes.commands.map((entry) => entry.command);
    assert.ok(commandIds.includes('agentxchain.run'), 'package.json must declare agentxchain.run');

    const indexSource = readFileSync(join(EXTENSION_ROOT, 'src', 'commands', 'index.ts'), 'utf8');
    assert.match(indexSource, /agentxchain\.run/, 'commands/index.ts must register agentxchain.run');
  });
});
