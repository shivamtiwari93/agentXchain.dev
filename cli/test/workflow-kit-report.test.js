import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  rmSync,
} from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { extractWorkflowKitArtifacts } from '../src/lib/report.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI_BIN = join(__dirname, '..', 'bin', 'agentxchain.js');

function writeJson(filePath, value) {
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, JSON.stringify(value, null, 2) + '\n');
}

function writeJsonl(filePath, entries) {
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, entries.map((entry) => JSON.stringify(entry)).join('\n') + '\n');
}

function runCli(cwd, args) {
  return spawnSync(process.execPath, [CLI_BIN, ...args], {
    cwd,
    encoding: 'utf8',
    timeout: 15000,
    env: { ...process.env, NODE_NO_WARNINGS: '1' },
  });
}

function makeArtifactStub(overrides = {}) {
  return {
    summary: { phase: 'planning', ...overrides.summary },
    state: { phase: 'planning', ...overrides.state },
    config: overrides.config || {},
    files: overrides.files || {},
  };
}

function createGovernedProjectWithWorkflowKit() {
  const root = mkdtempSync(join(tmpdir(), 'axc-wkr-'));
  mkdirSync(join(root, '.agentxchain', 'dispatch', 'turns', 'turn_001'), { recursive: true });
  mkdirSync(join(root, '.agentxchain', 'staging', 'turn_001'), { recursive: true });
  mkdirSync(join(root, '.agentxchain', 'transactions', 'accept', 'txn_001'), { recursive: true });
  mkdirSync(join(root, '.planning'), { recursive: true });

  writeJson(join(root, 'agentxchain.json'), {
    schema_version: '1.0',
    template: 'generic',
    protocol_mode: 'governed',
    project: { id: 'wkr-test', name: 'WKR Test', default_branch: 'main' },
    roles: {
      pm: { title: 'PM', mandate: 'Plan.', write_authority: 'authoritative', runtime: 'manual-pm' },
      dev: { title: 'Dev', mandate: 'Build.', write_authority: 'authoritative', runtime: 'manual-dev' },
    },
    runtimes: {
      'manual-pm': { type: 'manual', model: 'manual' },
      'manual-dev': { type: 'manual', model: 'manual' },
    },
    routing: {
      planning: { entry_role: 'pm', allowed_roles: ['pm'] },
      implementation: { entry_role: 'dev', allowed_roles: ['dev'] },
      qa: { entry_role: 'pm', allowed_roles: ['pm'] },
    },
    workflow_kit: {
      phases: {
        planning: {
          artifacts: [
            { path: '.planning/SYSTEM_SPEC.md', required: true, semantics: 'system_spec', owned_by: 'pm' },
            { path: '.planning/PM_SIGNOFF.md', required: false, semantics: 'pm_signoff' },
          ],
        },
        implementation: {
          artifacts: [
            { path: '.planning/IMPLEMENTATION_NOTES.md', required: true, semantics: 'implementation_notes' },
          ],
        },
        qa: { artifacts: [] },
      },
    },
  });

  writeJson(join(root, '.agentxchain', 'state.json'), {
    schema_version: '1.1',
    run_id: 'run_wkr_001',
    status: 'active',
    phase: 'planning',
    project_id: 'wkr-test',
    active_turns: {
      turn_001: {
        turn_id: 'turn_001',
        assigned_role: 'pm',
        status: 'dispatched',
        attempt: 1,
        runtime_id: 'manual-pm',
        assigned_sequence: 1,
      },
    },
    retained_turns: {},
    turn_sequence: 1,
    budget_reservations: {},
    queued_phase_transition: null,
    queued_run_completion: null,
    budget_status: { spent_usd: 0, remaining_usd: null },
  });

  writeFileSync(join(root, '.planning', 'SYSTEM_SPEC.md'), '# Spec\nPurpose: test');

  writeJsonl(join(root, '.agentxchain', 'history.jsonl'), []);
  writeJsonl(join(root, '.agentxchain', 'decision-ledger.jsonl'), []);
  writeJsonl(join(root, '.agentxchain', 'hook-audit.jsonl'), []);
  writeJsonl(join(root, '.agentxchain', 'notification-audit.jsonl'), []);

  writeJson(join(root, '.agentxchain', 'dispatch', 'turns', 'turn_001', 'ASSIGNMENT.json'), {
    turn_id: 'turn_001', role: 'pm', phase: 'planning',
  });
  writeJson(join(root, '.agentxchain', 'staging', 'turn_001', 'turn-result.json'), {
    turn_id: 'turn_001', role: 'pm', status: 'completed', summary: 'test',
  });

  return root;
}

describe('workflow-kit report extraction (unit)', () => {
  it('AT-WKR-RPT-001: returns array when config has workflow_kit', () => {
    const artifact = makeArtifactStub({
      config: {
        workflow_kit: {
          phases: {
            planning: {
              artifacts: [
                { path: '.planning/SYSTEM_SPEC.md', required: true, semantics: 'system_spec', owned_by: 'pm' },
              ],
            },
          },
        },
        routing: { planning: { entry_role: 'pm' } },
      },
      files: { '.planning/SYSTEM_SPEC.md': { format: 'text', data: '# Spec', bytes: 6 } },
    });

    const result = extractWorkflowKitArtifacts(artifact);
    assert.ok(Array.isArray(result), 'should be an array');
    assert.equal(result.length, 1);
  });

  it('AT-WKR-RPT-002: each artifact has correct fields', () => {
    const artifact = makeArtifactStub({
      config: {
        workflow_kit: {
          phases: {
            planning: {
              artifacts: [
                { path: '.planning/SYSTEM_SPEC.md', required: true, semantics: 'system_spec', owned_by: 'pm' },
              ],
            },
          },
        },
        routing: { planning: { entry_role: 'pm' } },
      },
      files: { '.planning/SYSTEM_SPEC.md': { format: 'text', data: '# Spec', bytes: 6 } },
    });

    const result = extractWorkflowKitArtifacts(artifact);
    const art = result[0];
    assert.equal(art.path, '.planning/SYSTEM_SPEC.md');
    assert.equal(art.required, true);
    assert.equal(art.semantics, 'system_spec');
    assert.equal(art.owned_by, 'pm');
    assert.equal(art.owner_resolution, 'explicit');
    assert.equal(art.exists, true);
  });

  it('AT-WKR-RPT-003: absent owned_by falls back to entry_role', () => {
    const artifact = makeArtifactStub({
      config: {
        workflow_kit: {
          phases: {
            planning: {
              artifacts: [
                { path: '.planning/PM_SIGNOFF.md', required: false, semantics: 'pm_signoff' },
              ],
            },
          },
        },
        routing: { planning: { entry_role: 'pm' } },
      },
      files: {},
    });

    const result = extractWorkflowKitArtifacts(artifact);
    const art = result[0];
    assert.equal(art.owned_by, 'pm');
    assert.equal(art.owner_resolution, 'entry_role');
    assert.equal(art.exists, false);
  });

  it('AT-WKR-RPT-004: missing workflow_kit in config produces null', () => {
    const artifact = makeArtifactStub({ config: {} });
    const result = extractWorkflowKitArtifacts(artifact);
    assert.equal(result, null);
  });

  it('AT-WKR-RPT-005: phase with zero artifacts produces empty array', () => {
    const artifact = makeArtifactStub({
      summary: { phase: 'qa' },
      state: { phase: 'qa' },
      config: {
        workflow_kit: { phases: { qa: { artifacts: [] } } },
      },
    });
    const result = extractWorkflowKitArtifacts(artifact);
    assert.deepEqual(result, []);
  });

  it('AT-WKR-RPT-008: file existence is checked against artifact.files keys', () => {
    const artifact = makeArtifactStub({
      config: {
        workflow_kit: {
          phases: {
            planning: {
              artifacts: [
                { path: '.planning/SYSTEM_SPEC.md', required: true, semantics: 'system_spec', owned_by: 'pm' },
                { path: '.planning/MISSING.md', required: true, semantics: 'missing_doc', owned_by: 'pm' },
              ],
            },
          },
        },
        routing: { planning: { entry_role: 'pm' } },
      },
      files: { '.planning/SYSTEM_SPEC.md': { format: 'text', data: '# Spec', bytes: 6 } },
    });

    const result = extractWorkflowKitArtifacts(artifact);
    const found = result.find((a) => a.path === '.planning/SYSTEM_SPEC.md');
    const missing = result.find((a) => a.path === '.planning/MISSING.md');
    assert.equal(found.exists, true);
    assert.equal(missing.exists, false);
  });

  it('AT-WKR-RPT-009: artifacts are sorted by path', () => {
    const artifact = makeArtifactStub({
      config: {
        workflow_kit: {
          phases: {
            planning: {
              artifacts: [
                { path: '.planning/Z_FILE.md', required: true, semantics: 'z' },
                { path: '.planning/A_FILE.md', required: true, semantics: 'a' },
                { path: '.planning/M_FILE.md', required: true, semantics: 'm' },
              ],
            },
          },
        },
        routing: { planning: { entry_role: 'dev' } },
      },
      files: {},
    });

    const result = extractWorkflowKitArtifacts(artifact);
    const paths = result.map((a) => a.path);
    assert.deepEqual(paths, ['.planning/A_FILE.md', '.planning/M_FILE.md', '.planning/Z_FILE.md']);
  });
});

describe('workflow-kit report CLI format integration', () => {
  let root;

  it('AT-WKR-RPT-006 + AT-WKR-RPT-007: text and markdown formats include Workflow Artifacts section', () => {
    root = createGovernedProjectWithWorkflowKit();

    // Export the governed project
    const exportResult = runCli(root, ['export', '--output', 'export.json']);
    assert.equal(exportResult.status, 0, `export failed: ${exportResult.stderr}`);

    // Text format
    const textResult = runCli(root, ['report', '--input', 'export.json', '--format', 'text']);
    assert.equal(textResult.status, 0, `text report failed: stderr=${textResult.stderr} stdout=${textResult.stdout.slice(0, 500)}`);
    const text = textResult.stdout;
    assert.ok(text.includes('Workflow Artifacts (planning phase):'), 'text should include section header');
    assert.ok(text.includes('.planning/SYSTEM_SPEC.md'), 'text should include artifact path');
    assert.ok(text.includes('required'), 'text should include required status');
    assert.ok(text.includes('system_spec'), 'text should include semantics');
    assert.ok(text.includes('pm (explicit)'), 'text should include owner with resolution');
    assert.ok(text.includes('exists'), 'text should include existence status');
    assert.ok(text.includes('.planning/PM_SIGNOFF.md'), 'text should include second artifact');
    assert.ok(text.includes('missing'), 'text should show missing status for absent file');
    assert.ok(text.includes('pm_signoff'), 'text should include pm_signoff semantics');

    // Markdown format
    const mdResult = runCli(root, ['report', '--input', 'export.json', '--format', 'markdown']);
    assert.equal(mdResult.status, 0, `markdown report failed: ${mdResult.stderr}`);
    const md = mdResult.stdout;
    assert.ok(md.includes('## Workflow Artifacts'), 'markdown should include section header');
    assert.ok(md.includes('Phase: `planning`'), 'markdown should include phase');
    assert.ok(md.includes('| Artifact |'), 'markdown should include table header');
    assert.ok(md.includes('`.planning/SYSTEM_SPEC.md`'), 'markdown should include artifact path');
    assert.ok(md.includes('**missing**'), 'markdown should bold missing artifacts');

    // JSON format — verify structured data
    const jsonResult = runCli(root, ['report', '--input', 'export.json', '--format', 'json']);
    assert.equal(jsonResult.status, 0, `json report failed: ${jsonResult.stderr}`);
    const report = JSON.parse(jsonResult.stdout);
    const wkArts = report.subject.run.workflow_kit_artifacts;
    assert.ok(Array.isArray(wkArts), 'JSON report should include workflow_kit_artifacts array');
    assert.equal(wkArts.length, 2);
    const pmSignoff = wkArts.find((a) => a.path === '.planning/PM_SIGNOFF.md');
    const systemSpec = wkArts.find((a) => a.path === '.planning/SYSTEM_SPEC.md');
    assert.ok(pmSignoff, 'should include PM_SIGNOFF.md');
    assert.ok(systemSpec, 'should include SYSTEM_SPEC.md');
    assert.equal(systemSpec.exists, true);
    assert.equal(pmSignoff.exists, false);
    // Verify sorted order
    assert.ok(wkArts[0].path < wkArts[1].path, 'artifacts should be sorted by path');

    rmSync(root, { recursive: true, force: true });
  });

  it('AT-WKR-RPT-005-format: empty artifacts phase omits section from text and markdown', () => {
    root = createGovernedProjectWithWorkflowKit();

    // Change state to qa phase (which has empty artifacts)
    writeJson(join(root, '.agentxchain', 'state.json'), {
      schema_version: '1.1',
      run_id: 'run_wkr_001',
      status: 'active',
      phase: 'qa',
      project_id: 'wkr-test',
      active_turns: {},
      retained_turns: {},
      turn_sequence: 1,
      budget_reservations: {},
      queued_phase_transition: null,
      queued_run_completion: null,
      budget_status: { spent_usd: 0, remaining_usd: null },
    });

    const exportResult = runCli(root, ['export', '--output', 'export.json']);
    assert.equal(exportResult.status, 0, `export failed: ${exportResult.stderr}`);

    const textResult = runCli(root, ['report', '--input', 'export.json', '--format', 'text']);
    assert.equal(textResult.status, 0, `text report failed: ${textResult.stderr}`);
    assert.ok(!textResult.stdout.includes('Workflow Artifacts'), 'text should omit section for empty artifacts');

    const mdResult = runCli(root, ['report', '--input', 'export.json', '--format', 'markdown']);
    assert.equal(mdResult.status, 0, `markdown report failed: ${mdResult.stderr}`);
    assert.ok(!mdResult.stdout.includes('## Workflow Artifacts'), 'markdown should omit section for empty artifacts');

    rmSync(root, { recursive: true, force: true });
  });
});
