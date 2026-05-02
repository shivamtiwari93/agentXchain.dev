import { afterAll, beforeAll, describe, it } from 'vitest';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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

beforeAll(async () => {
  process.env.AGENTXCHAIN_CLI_PATH = CLI_BIN;
  governedStatusModule = await importCompiledVsCodeExtensionModule('governedStatus.js');
});

afterAll(() => {
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
  const dir = mkdtempSync(join(tmpdir(), 'axc-ide-restart-'));
  tempDirs.push(dir);
  scaffoldGoverned(dir, 'IDE Restart Fixture', 'ide-restart-fixture');

  const statePath = join(dir, '.agentxchain', 'state.json');
  const state = JSON.parse(readFileSync(statePath, 'utf8'));
  Object.assign(state, {
    status: 'active',
    phase: 'implementation',
    run_id: 'run_ide_restart_test',
    turn_sequence: 2,
    blocked: false,
    blocked_on: null,
    pending_phase_transition: null,
    pending_run_completion: null,
    ...overrides,
  });
  writeFileSync(statePath, `${JSON.stringify(state, null, 2)}\n`);

  return dir;
}

describe('governed IDE restart helpers', () => {
  it('returns a restart action when CLI continuity recommends restart', () => {
    const action = governedStatusModule.getGovernedRestartAction({
      protocol_mode: 'governed',
      continuity: {
        restart_recommended: true,
        recommended_command: 'agentxchain restart',
      },
    });

    assert.deepEqual(action, {
      cliArgs: ['restart'],
      label: 'Restart Run',
    });
  });

  it('parses restart arguments from the CLI continuity command', () => {
    assert.deepEqual(
      governedStatusModule.parseRecommendedRestartArgs('agentxchain restart --role qa'),
      ['restart', '--role', 'qa']
    );
    assert.equal(
      governedStatusModule.parseRecommendedRestartArgs('agentxchain approve-transition'),
      null
    );
  });

  it('does not offer restart when continuity does not recommend it', () => {
    const action = governedStatusModule.getGovernedRestartAction({
      protocol_mode: 'governed',
      continuity: {
        restart_recommended: false,
        recommended_command: 'agentxchain approve-transition',
      },
    });

    assert.equal(action, null);
  });
});

describe('governed IDE restart and dashboard sidebar surface', () => {
  it('renders restart and dashboard buttons when restart is recommended', async () => {
    const dir = createGovernedFixture();
    const payload = await governedStatusModule.loadGovernedStatus(dir);
    payload.continuity = {
      restart_recommended: true,
      recommended_command: 'agentxchain restart',
      recommended_detail: 'session context lost',
      checkpoint: payload.continuity?.checkpoint ?? null,
    };

    const html = governedStatusModule.renderGovernedStatusHtml(payload, 'Boundary test');
    assert.match(html, /command:agentxchain\.openDashboard/, 'dashboard command link must be present');
    assert.match(html, /Open Dashboard/, 'dashboard button text must render');
    assert.match(html, /command:agentxchain\.restart/, 'restart command link must be present');
    assert.match(html, /Restart Run/, 'restart button text must render');
    assert.match(html, /command:agentxchain\.report/, 'report button remains available in the operator surface');
  });

  it('omits the restart button when CLI continuity does not recommend restart', async () => {
    const dir = createGovernedFixture();
    const payload = await governedStatusModule.loadGovernedStatus(dir);
    payload.continuity = {
      restart_recommended: false,
      recommended_command: 'agentxchain approve-transition',
      recommended_detail: 'planning_signoff',
      checkpoint: payload.continuity?.checkpoint ?? null,
    };

    const html = governedStatusModule.renderGovernedStatusHtml(payload, 'Boundary test');
    assert.match(html, /command:agentxchain\.openDashboard/, 'dashboard button must remain available');
    assert.doesNotMatch(html, /command:agentxchain\.restart/, 'restart button must be hidden when restart is not recommended');
  });
});

describe('governed IDE restart and dashboard mutation boundary', () => {
  it('restart command stays on the CLI subprocess boundary', () => {
    const restartSource = readFileSync(join(EXTENSION_ROOT, 'src', 'commands', 'restart.ts'), 'utf8');

    assert.match(restartSource, /execCliCommand/, 'restart command must use execCliCommand');
    assert.match(restartSource, /showWarningMessage/, 'restart command must require explicit confirmation');
    assert.doesNotMatch(restartSource, /writeFileSync/, 'restart command must not use writeFileSync');
    assert.doesNotMatch(restartSource, /writeJson/, 'restart command must not use writeJson');
    assert.doesNotMatch(restartSource, /mkdirSync/, 'restart command must not create governed artifacts');
  });

  it('dashboard command launches an integrated terminal and does not write governed files directly', () => {
    const dashboardSource = readFileSync(join(EXTENSION_ROOT, 'src', 'commands', 'dashboard.ts'), 'utf8');
    const terminalSource = readFileSync(join(EXTENSION_ROOT, 'src', 'dashboardTerminal.ts'), 'utf8');
    const combined = `${dashboardSource}\n${terminalSource}`;

    assert.match(dashboardSource, /launchGovernedDashboardTerminal/, 'dashboard command must use the shared terminal helper');
    assert.match(terminalSource, /createTerminal/, 'dashboard terminal helper must launch an integrated terminal');
    assert.match(terminalSource, /buildCliShellCommand/, 'dashboard terminal helper must build the CLI shell command');
    assert.doesNotMatch(combined, /writeFileSync/, 'dashboard sources must not use writeFileSync');
    assert.doesNotMatch(combined, /writeJson/, 'dashboard sources must not use writeJson');
    assert.doesNotMatch(combined, /mkdirSync/, 'dashboard sources must not create governed artifacts');
  });

  it('package.json declares restart/dashboard and commands/index.ts registers both', () => {
    const pkg = JSON.parse(readFileSync(join(EXTENSION_ROOT, 'package.json'), 'utf8'));
    const commandIds = pkg.contributes.commands.map((entry) => entry.command);
    assert.ok(commandIds.includes('agentxchain.restart'), 'package.json must declare agentxchain.restart');
    assert.ok(commandIds.includes('agentxchain.openDashboard'), 'package.json must declare agentxchain.openDashboard');
    assert.equal(commandIds.length, 12, 'must have exactly 12 commands after adding restart and dashboard');

    const indexSource = readFileSync(join(EXTENSION_ROOT, 'src', 'commands', 'index.ts'), 'utf8');
    assert.match(indexSource, /agentxchain\.restart/, 'commands/index.ts must register agentxchain.restart');
    assert.match(indexSource, /agentxchain\.openDashboard/, 'commands/index.ts must register agentxchain.openDashboard');
  });
});
