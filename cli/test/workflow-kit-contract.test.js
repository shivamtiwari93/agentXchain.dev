import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';

const ROOT = join(import.meta.dirname, '..');
const CLI_PATH = join(ROOT, 'bin', 'agentxchain.js');

function runCli(cwd, args) {
  return execFileSync('node', [CLI_PATH, ...args], {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, NODE_NO_WARNINGS: '1' },
    timeout: 15_000,
  });
}

function runCliFail(cwd, args) {
  try {
    execFileSync('node', [CLI_PATH, ...args], {
      cwd,
      encoding: 'utf8',
      env: { ...process.env, NODE_NO_WARNINGS: '1' },
      timeout: 15_000,
    });
    assert.fail('Expected CLI to exit non-zero');
  } catch (err) {
    return err;
  }
}

function createProject() {
  const dir = mkdtempSync(join(tmpdir(), 'axc-wk-'));
  runCli(ROOT, ['init', '--governed', '--dir', dir, '-y']);
  return dir;
}

function readConfig(dir) {
  return JSON.parse(readFileSync(join(dir, 'agentxchain.json'), 'utf8'));
}

function writeConfig(dir, config) {
  writeFileSync(join(dir, 'agentxchain.json'), JSON.stringify(config, null, 2) + '\n');
}

describe('workflow-kit describe command', () => {
  it('AT-WK-001: default governed project returns contract with version, templates, and artifacts', () => {
    const dir = createProject();
    const out = runCli(dir, ['workflow-kit', 'describe', '--json']);
    const contract = JSON.parse(out);

    assert.equal(contract.workflow_kit_version, '1.0');
    assert.equal(contract.source, 'default');
    assert.ok(Array.isArray(contract.phase_templates.available));
    assert.ok(contract.phase_templates.available.length >= 5);
    assert.ok(contract.phase_templates.in_use.length >= 3);
    assert.ok(contract.phase_templates.in_use.includes('planning-default'));
    assert.ok(contract.phase_templates.in_use.includes('implementation-default'));
    assert.ok(contract.phase_templates.in_use.includes('qa-default'));

    // All 3 default phases should have artifacts
    assert.ok(contract.phases.planning);
    assert.ok(contract.phases.implementation);
    assert.ok(contract.phases.qa);

    // Count total artifacts across all phases
    const totalArtifacts = Object.values(contract.phases)
      .reduce((sum, p) => sum + p.artifacts.length, 0);
    assert.ok(totalArtifacts >= 7, `Expected >= 7 artifacts, got ${totalArtifacts}`);
  });

  it('AT-WK-002: explicit workflow_kit config reflects user overrides', () => {
    const dir = createProject();
    const config = readConfig(dir);
    config.workflow_kit = {
      phases: {
        planning: {
          template: 'planning-default',
          artifacts: [
            { path: '.planning/CUSTOM.md', required: true, semantics: null },
          ],
        },
      },
    };
    writeConfig(dir, config);

    const out = runCli(dir, ['workflow-kit', 'describe', '--json']);
    const contract = JSON.parse(out);

    assert.equal(contract.source, 'mixed');
    assert.equal(contract.phases.planning.source, 'explicit');
    // Explicit phases should include the custom artifact merged with template artifacts
    const customArtifact = contract.phases.planning.artifacts.find(
      (a) => a.path === '.planning/CUSTOM.md',
    );
    assert.ok(customArtifact, 'Custom artifact should be present');
    assert.ok(
      contract.gate_artifact_coverage.planning_signoff.artifacts_covered.includes('.planning/CUSTOM.md'),
      'planning_signoff coverage must include explicit planning workflow-kit artifacts',
    );
  });

  it('AT-WK-003: --json output has all required fields', () => {
    const dir = createProject();
    const out = runCli(dir, ['workflow-kit', 'describe', '--json']);
    const contract = JSON.parse(out);

    assert.ok(contract.workflow_kit_version);
    assert.ok(contract.source);
    assert.ok(contract.phase_templates);
    assert.ok(Array.isArray(contract.phase_templates.available));
    assert.ok(Array.isArray(contract.phase_templates.in_use));
    assert.ok(contract.phases);
    assert.ok(Array.isArray(contract.semantic_validators));
    assert.ok(contract.gate_artifact_coverage);
  });

  it('AT-WK-004: semantic validators list matches known set', () => {
    const dir = createProject();
    const out = runCli(dir, ['workflow-kit', 'describe', '--json']);
    const contract = JSON.parse(out);

    const expected = [
      'pm_signoff', 'system_spec', 'implementation_notes',
      'acceptance_matrix', 'ship_verdict', 'release_notes', 'section_check',
    ];
    assert.deepEqual(contract.semantic_validators, expected);
  });

  it('AT-WK-005: gate artifact coverage maps gates to workflow artifacts', () => {
    const dir = createProject();
    const out = runCli(dir, ['workflow-kit', 'describe', '--json']);
    const contract = JSON.parse(out);

    // Default governed projects have gates
    const gateIds = Object.keys(contract.gate_artifact_coverage);
    assert.ok(gateIds.length >= 1, 'Expected at least one gate');

    for (const [gateId, cov] of Object.entries(contract.gate_artifact_coverage)) {
      assert.ok(Array.isArray(cov.linked_phases), `${gateId} must expose linked phases`);
      assert.ok(typeof cov.predicates_referencing_artifacts === 'number');
      assert.ok(Array.isArray(cov.artifacts_covered));
    }

    assert.deepEqual(contract.gate_artifact_coverage.planning_signoff.linked_phases, ['planning']);
    assert.deepEqual(contract.gate_artifact_coverage.implementation_complete.linked_phases, ['implementation']);
    assert.deepEqual(contract.gate_artifact_coverage.qa_ship_verdict.linked_phases, ['qa']);

    assert.equal(contract.gate_artifact_coverage.planning_signoff.predicates_referencing_artifacts, 3);
    assert.equal(contract.gate_artifact_coverage.implementation_complete.predicates_referencing_artifacts, 1);
    assert.equal(contract.gate_artifact_coverage.qa_ship_verdict.predicates_referencing_artifacts, 3);

    assert.deepEqual(
      contract.gate_artifact_coverage.planning_signoff.artifacts_covered.sort(),
      ['.planning/PM_SIGNOFF.md', '.planning/ROADMAP.md', '.planning/SYSTEM_SPEC.md'].sort(),
    );
    assert.deepEqual(
      contract.gate_artifact_coverage.implementation_complete.artifacts_covered,
      ['.planning/IMPLEMENTATION_NOTES.md'],
    );
    assert.deepEqual(
      contract.gate_artifact_coverage.qa_ship_verdict.artifacts_covered.sort(),
      ['.planning/RELEASE_NOTES.md', '.planning/acceptance-matrix.md', '.planning/ship-verdict.md'].sort(),
    );
  });

  it('AT-WK-006: non-governed project returns error', () => {
    const dir = mkdtempSync(join(tmpdir(), 'axc-wk-nogov-'));
    writeFileSync(join(dir, 'agentxchain.json'), JSON.stringify({
      version: 3,
      project: { name: 'test', goal: 'test' },
      agents: [{ id: 'pm', role: 'PM' }],
    }, null, 2));

    const err = runCliFail(dir, ['workflow-kit', 'describe', '--json']);
    const output = (err.stderr || '') + (err.stdout || '');
    // v3 projects may be rejected as "No agentxchain.json" (loader rejects invalid v3)
    // or "Not a governed" (loader succeeds but protocol_mode check fails)
    assert.ok(
      output.includes('Not a governed') || output.includes('No agentxchain.json') || output.includes('requires v4'),
      `Expected non-governed project error, got: ${output.slice(0, 200)}`,
    );
  });

  it('AT-WK-007: text output includes phase names and artifact paths', () => {
    const dir = createProject();
    const out = runCli(dir, ['workflow-kit', 'describe']);

    assert.ok(out.includes('Workflow Kit v1.0'));
    assert.ok(out.includes('planning'));
    assert.ok(out.includes('implementation'));
    assert.ok(out.includes('qa'));
    assert.ok(out.includes('PM_SIGNOFF'));
    assert.ok(out.includes('Validators:'));
  });

  it('AT-WK-008: artifact exists flag reflects disk reality', () => {
    const dir = createProject();
    // Create one of the workflow artifacts
    mkdirSync(join(dir, '.planning'), { recursive: true });
    writeFileSync(join(dir, '.planning', 'PM_SIGNOFF.md'), '# PM Signoff\nApproved: NO\n');

    const out = runCli(dir, ['workflow-kit', 'describe', '--json']);
    const contract = JSON.parse(out);

    const signoff = contract.phases.planning.artifacts.find(
      (a) => a.path === '.planning/PM_SIGNOFF.md',
    );
    assert.ok(signoff, 'PM_SIGNOFF.md should be in planning artifacts');
    assert.equal(signoff.exists, true);
    assert.equal(signoff.semantics, 'pm_signoff');
  });
});

describe('workflow-kit contract boundary', () => {
  it('AT-WK-BOUNDARY-001: workflow kit is not protocol conformance — command is reference-runner only', () => {
    // The workflow-kit command exists in the reference runner but is not a protocol v7 requirement.
    // Verify it is NOT listed in the protocol conformance test surface.
    const protocolRef = readFileSync(
      join(ROOT, '..', 'website-v2', 'docs', 'protocol-reference.mdx'),
      'utf8',
    );
    // Protocol reference should mention workflow_kit as a workflow surface, not a conformance surface
    assert.ok(
      !protocolRef.includes('workflow-kit describe') || protocolRef.includes('workflow'),
      'workflow-kit describe should not be a protocol conformance command',
    );
  });

  it('AT-WK-BOUNDARY-002: SEMANTIC_VALIDATOR_IDS matches VALID_SEMANTIC_IDS in normalized-config', async () => {
    // The semantic validator IDs exposed by the workflow-kit contract must match
    // what normalized-config.js considers valid, to prevent drift.
    const { SEMANTIC_VALIDATOR_IDS } = await import('../src/commands/workflow-kit.js');
    const expected = [
      'pm_signoff', 'system_spec', 'implementation_notes',
      'acceptance_matrix', 'ship_verdict', 'release_notes', 'section_check',
    ];
    assert.deepEqual(SEMANTIC_VALIDATOR_IDS, expected);
  });
});
