import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { scaffoldGoverned } from '../src/commands/init.js';
import { importCompiledVsCodeExtensionModule } from './helpers/vscode-extension-test-helpers.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..', '..');
const CLI_BIN = join(REPO_ROOT, 'cli', 'bin', 'agentxchain.js');
const EXTENSION_ROOT = join(REPO_ROOT, 'cli', 'vscode-extension');
const GOVERNED_STATUS_TS = join(EXTENSION_ROOT, 'src', 'governedStatus.ts');

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

function createGovernedFixture() {
  const dir = mkdtempSync(join(tmpdir(), 'axc-ide-governed-'));
  tempDirs.push(dir);
  scaffoldGoverned(dir, 'IDE Governed Fixture', 'ide-governed-fixture');

  const configPath = join(dir, 'agentxchain.json');
  const statePath = join(dir, '.agentxchain', 'state.json');
  const sessionPath = join(dir, '.agentxchain', 'session.json');
  const config = JSON.parse(readFileSync(configPath, 'utf8'));
  config.workflow_kit = {
    phases: {
      implementation: {
        artifacts: [
          { path: '.planning/SYSTEM_SPEC.md', required: true, owned_by: 'pm' },
          { path: '.planning/QA_NOTES.md', required: false, owned_by: 'dev' },
        ],
      },
    },
  };
  writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);

  const state = JSON.parse(readFileSync(statePath, 'utf8'));
  Object.assign(state, {
    status: 'paused',
    phase: 'implementation',
    run_id: 'run_ide_status',
    turn_sequence: 4,
    blocked: false,
    blocked_on: null,
    active_turns: {},
    pending_phase_transition: {
      from: 'implementation',
      to: 'qa',
      gate: 'implementation_signoff',
    },
  });
  writeFileSync(statePath, `${JSON.stringify(state, null, 2)}\n`);

    writeFileSync(
    sessionPath,
    `${JSON.stringify({
      session_id: 'session_ide_status',
      run_id: 'run_ide_status',
      last_checkpoint_at: '2026-04-10T10:00:00Z',
      last_turn_id: 'turn-004',
      last_role: 'dev',
      checkpoint_reason: 'turn_accepted',
    }, null, 2)}\n`
  );

  writeFileSync(join(dir, '.planning', 'SYSTEM_SPEC.md'), '# System Spec\n');

  return dir;
}

function runCliJson(cwd, args) {
  const result = spawnSync(process.execPath, [CLI_BIN, ...args], {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, NO_COLOR: '1' },
    timeout: 20_000,
  });
  assert.equal(result.status, 0, `CLI command failed: ${result.stdout}\n${result.stderr}`);
  return JSON.parse(result.stdout);
}

describe('governed IDE status surface', () => {
  it('loads governed status from the CLI JSON contract', async () => {
    const dir = createGovernedFixture();

    const cliPayload = runCliJson(dir, ['status', '--json']);
    const extensionPayload = await governedStatusModule.loadGovernedStatus(dir);

    assert.equal(extensionPayload.protocol_mode, 'governed');
    assert.equal(extensionPayload.state.phase, cliPayload.state.phase);
    assert.equal(extensionPayload.state.status, cliPayload.state.status);
    assert.equal(extensionPayload.continuity.checkpoint.session_id, cliPayload.continuity.checkpoint.session_id);
    assert.deepEqual(extensionPayload.workflow_kit_artifacts, cliPayload.workflow_kit_artifacts);
  });

  it('renders governed status lines and sidebar HTML from the CLI payload', async () => {
    const dir = createGovernedFixture();
    const payload = await governedStatusModule.loadGovernedStatus(dir);

    const lines = governedStatusModule.renderGovernedStatusLines(payload).join('\n');
    assert.match(lines, /Project: IDE Governed Fixture/);
    assert.match(lines, /Pending phase transition: implementation -> qa \(implementation_signoff\)/);
    assert.match(lines, /Action: agentxchain approve-transition/);
    assert.match(lines, /Workflow-kit artifacts \(implementation\):/);
    assert.match(lines, /\.planning\/SYSTEM_SPEC\.md: present, required \(pm\)/);
    assert.match(lines, /\.planning\/QA_NOTES\.md: missing, optional \(dev\)/);

    const html = governedStatusModule.renderGovernedStatusHtml(payload, 'Boundary notice');
    assert.match(html, /IDE Governed Fixture/);
    assert.match(html, /Pending phase transition/);
    assert.match(html, /Boundary notice/);
    assert.match(html, /SYSTEM_SPEC\.md/);
  });

  it('summarizes governed status bar tone from pending and blocked states', () => {
    const warningSummary = governedStatusModule.summarizeGovernedStatus({
      config: { project: { name: 'Warning Repo' } },
      state: {
        phase: 'implementation',
        status: 'paused',
        pending_phase_transition: { from: 'implementation', to: 'qa', gate: 'implementation_signoff' },
      },
      continuity: { recommended_command: 'agentxchain approve-transition' },
    });

    assert.equal(warningSummary.tone, 'warning');
    assert.match(warningSummary.tooltip, /Action: agentxchain approve-transition/);

    const errorSummary = governedStatusModule.summarizeGovernedStatus({
      config: { project: { name: 'Blocked Repo' } },
      state: {
        phase: 'qa',
        status: 'blocked',
        blocked: true,
        blocked_reason: 'qa signoff rejected',
      },
    });

    assert.equal(errorSummary.tone, 'error');
    assert.match(errorSummary.tooltip, /Blocked: qa signoff rejected/);
  });
});

describe('governed IDE mutation boundary', () => {
  it('keeps governed status read-only and sourced from the CLI', () => {
    const source = readFileSync(GOVERNED_STATUS_TS, 'utf8');
    assert.match(source, /status', '--json'/, 'governed status loader must call agentxchain status --json');
  });

  it('does not directly write governed state from the extension source tree', () => {
    const sourceFiles = [
      join(EXTENSION_ROOT, 'src', 'commands', 'status.ts'),
      join(EXTENSION_ROOT, 'src', 'statusBar.ts'),
      join(EXTENSION_ROOT, 'src', 'sidebar.ts'),
      join(EXTENSION_ROOT, 'src', 'governedStatus.ts'),
    ].map((filePath) => readFileSync(filePath, 'utf8')).join('\n');

    assert.doesNotMatch(sourceFiles, /writeFileSync\([^)]*\.agentxchain/i);
    assert.doesNotMatch(sourceFiles, /writeJson\([^)]*statePath\([^)]*governed/i);
    assert.doesNotMatch(sourceFiles, /mkdirSync\([^)]*\.agentxchain/i);
  });
});
