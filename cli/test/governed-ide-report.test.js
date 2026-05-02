import { afterAll, beforeAll, describe, it } from 'vitest';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, rmSync, mkdirSync, existsSync } from 'node:fs';
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
  const dir = mkdtempSync(join(tmpdir(), 'axc-ide-report-'));
  tempDirs.push(dir);
  scaffoldGoverned(dir, 'IDE Report Fixture', 'ide-report-fixture');

  const statePath = join(dir, '.agentxchain', 'state.json');
  const state = JSON.parse(readFileSync(statePath, 'utf8'));
  Object.assign(state, {
    status: 'active',
    phase: 'planning',
    run_id: 'run_ide_report_test',
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

describe('governed IDE report — CLI subprocess integration', () => {
  it('loadGovernedReport returns a valid report payload from a real governed project', async () => {
    const dir = createGovernedFixture();
    const report = await governedStatusModule.loadGovernedReport(dir);

    assert.ok(report, 'report must be returned');
    assert.equal(typeof report.overall, 'string', 'report must have an overall field');
    assert.ok(report.generated_at, 'report must have a generated_at timestamp');
    assert.ok(report.subject, 'report must have a subject');
    assert.equal(report.subject.kind, 'governed_run', 'subject kind must be governed_run');
  });

  it('loadGovernedReport includes project metadata', async () => {
    const dir = createGovernedFixture();
    const report = await governedStatusModule.loadGovernedReport(dir);
    const project = report.subject?.project;

    assert.ok(project, 'subject must have a project');
    assert.equal(project.name, 'IDE Report Fixture', 'project name must match');
    assert.equal(project.id, 'ide-report-fixture', 'project id must match');
  });

  it('loadGovernedReport includes run metadata', async () => {
    const dir = createGovernedFixture();
    const report = await governedStatusModule.loadGovernedReport(dir);
    const run = report.subject?.run;

    assert.ok(run, 'subject must have a run');
    assert.equal(run.run_id, 'run_ide_report_test', 'run_id must match');
    assert.equal(typeof run.status, 'string', 'run must have a status');
    assert.equal(typeof run.phase, 'string', 'run must have a phase');
  });

  it('loadGovernedReport includes verification', async () => {
    const dir = createGovernedFixture();
    const report = await governedStatusModule.loadGovernedReport(dir);

    assert.ok(report.verification !== undefined, 'report must include verification');
    // verification.ok may or may not be present depending on report version;
    // the key contract is that the verification section exists
  });
});

describe('governed IDE report — renderReportLines', () => {
  it('renders overall, project, and run information', () => {
    const report = {
      overall: 'pass',
      generated_at: '2026-04-10T12:00:00Z',
      export_kind: 'agentxchain_run_export',
      verification: { ok: true, errors: [] },
      subject: {
        kind: 'governed_run',
        project: {
          name: 'Test Project',
          id: 'test-project',
          template: 'manual-dev',
          schema_version: '4',
        },
        run: {
          run_id: 'run_test_123',
          status: 'active',
          phase: 'implementation',
          active_turn_count: 3,
          retained_turn_count: 3,
          active_roles: ['dev', 'qa'],
          created_at: '2026-04-10T10:00:00Z',
          duration_seconds: 7200,
        },
        artifacts: {
          history_entries: 3,
          decision_entries: 2,
          hook_audit_entries: 1,
          dispatch_artifact_files: 3,
          staging_artifact_files: 0,
        },
      },
    };

    const lines = governedStatusModule.renderReportLines(report);
    const text = lines.join('\n');

    assert.match(text, /Overall: pass/);
    assert.match(text, /Test Project/);
    assert.match(text, /test-project/);
    assert.match(text, /run_test_123/);
    assert.match(text, /implementation/);
    assert.match(text, /Active turns: 3/);
    assert.match(text, /Roles: dev, qa/);
    assert.match(text, /Duration: 7200s/);
    assert.match(text, /History entries: 3/);
    assert.match(text, /Decision entries: 2/);
  });

  it('renders turn timeline', () => {
    const report = {
      overall: 'pass',
      generated_at: '2026-04-10T12:00:00Z',
      export_kind: 'agentxchain_run_export',
      subject: {
        kind: 'governed_run',
        run: {
          run_id: 'run_turns',
          status: 'active',
          phase: 'planning',
          turns: [
            {
              turn_id: 'turn_001',
              role: 'dev',
              status: 'accepted',
              summary: 'Implemented feature X',
              phase: 'planning',
              files_changed_count: 5,
              decisions: ['DEC-001'],
              cost_usd: 0.05,
            },
          ],
        },
      },
    };

    const lines = governedStatusModule.renderReportLines(report);
    const text = lines.join('\n');

    assert.match(text, /Turn Timeline/);
    assert.match(text, /turn_001/);
    assert.match(text, /dev/);
    assert.match(text, /Implemented feature X/);
    assert.match(text, /DEC: DEC-001/);
    assert.match(text, /5 files/);
  });

  it('renders verification failures', () => {
    const report = {
      overall: 'fail',
      generated_at: '2026-04-10T12:00:00Z',
      verification: {
        ok: false,
        errors: ['history hash mismatch', 'missing staging file'],
      },
      subject: { kind: 'governed_run' },
    };

    const lines = governedStatusModule.renderReportLines(report);
    const text = lines.join('\n');

    assert.match(text, /Overall: fail/);
    assert.match(text, /Verification: FAIL/);
    assert.match(text, /history hash mismatch/);
    assert.match(text, /missing staging file/);
  });

  it('renders workflow-kit artifacts', () => {
    const report = {
      overall: 'pass',
      generated_at: '2026-04-10T12:00:00Z',
      subject: {
        kind: 'governed_run',
        run: {
          run_id: 'run_wk',
          status: 'active',
          phase: 'planning',
          workflow_kit_artifacts: [
            { path: '.planning/SYSTEM_SPEC.md', required: true, exists: true, owned_by: 'pm' },
            { path: '.planning/IMPLEMENTATION_NOTES.md', required: false, exists: false, owned_by: 'dev' },
          ],
        },
      },
    };

    const lines = governedStatusModule.renderReportLines(report);
    const text = lines.join('\n');

    assert.match(text, /Workflow-Kit Artifacts/);
    assert.match(text, /SYSTEM_SPEC\.md: present, required \(pm\)/);
    assert.match(text, /IMPLEMENTATION_NOTES\.md: MISSING, optional \(dev\)/);
  });
});

describe('governed IDE report — mutation boundary', () => {
  it('loadGovernedReport uses a single audit subprocess call, not export+report double-hop', () => {
    const gsSource = readFileSync(join(EXTENSION_ROOT, 'src', 'governedStatus.ts'), 'utf8');
    assert.match(gsSource, /execCliCommand\(root, \['audit', '--format', 'json'\]/, 'must use execCliCommand with audit --format json');
    assert.doesNotMatch(gsSource, /execCliCommand\(root, \['export'\]/, 'must not use separate export subprocess');
    assert.doesNotMatch(gsSource, /execCliCommand\(root, \['report'/, 'must not use separate report subprocess');
  });

  it('loadGovernedReport does not use temp files or fs writes', () => {
    const gsSource = readFileSync(join(EXTENSION_ROOT, 'src', 'governedStatus.ts'), 'utf8');
    // Extract the loadGovernedReport function body
    const fnStart = gsSource.indexOf('export async function loadGovernedReport');
    const fnEnd = gsSource.indexOf('\nexport ', fnStart + 1);
    const fnBody = gsSource.slice(fnStart, fnEnd > -1 ? fnEnd : undefined);
    assert.doesNotMatch(fnBody, /tmpdir/, 'loadGovernedReport must not use temp files');
    assert.doesNotMatch(fnBody, /writeFileSync/, 'loadGovernedReport must not write files');
    assert.doesNotMatch(fnBody, /unlinkSync/, 'loadGovernedReport must not clean up temp files');
  });

  it('report command wrapper does not import fs or write any files', () => {
    const reportSource = readFileSync(join(EXTENSION_ROOT, 'src', 'commands', 'report.ts'), 'utf8');
    assert.doesNotMatch(reportSource, /writeFileSync/, 'report command must not use writeFileSync');
    assert.doesNotMatch(reportSource, /writeJson/, 'report command must not use writeJson');
    assert.doesNotMatch(reportSource, /mkdirSync/, 'report command must not create directories');
    assert.doesNotMatch(reportSource, /import.*\bfs\b/, 'report command must not import fs');
  });

  it('package.json declares the governed report command and commands/index.ts registers it', () => {
    const pkg = JSON.parse(readFileSync(join(EXTENSION_ROOT, 'package.json'), 'utf8'));
    const commandIds = pkg.contributes.commands.map((entry) => entry.command);
    assert.ok(commandIds.includes('agentxchain.report'), 'package.json must declare agentxchain.report');

    const indexSource = readFileSync(join(EXTENSION_ROOT, 'src', 'commands', 'index.ts'), 'utf8');
    assert.match(indexSource, /agentxchain\.report/, 'commands/index.ts must register agentxchain.report');
  });

  it('package.json now declares exactly 12 commands', () => {
    const pkg = JSON.parse(readFileSync(join(EXTENSION_ROOT, 'package.json'), 'utf8'));
    assert.equal(pkg.contributes.commands.length, 12, 'must have exactly 12 commands after adding restart and dashboard');
  });
});
