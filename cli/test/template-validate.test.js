import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import {
  cpSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

import {
  validateGovernedTemplateRegistry,
  validateProjectPlanningArtifacts,
  validateAcceptanceHintCompletion,
  validateGovernedWorkflowKit,
} from '../src/lib/governed-templates.js';
import { loadNormalizedConfig } from '../src/lib/normalized-config.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI_BIN = join(__dirname, '..', 'bin', 'agentxchain.js');
const REPO_ROOT = join(__dirname, '..', '..');
const GOVERNED_TEMPLATES_DIR = join(REPO_ROOT, 'cli', 'src', 'templates', 'governed');

function runCli(cwd, args) {
  return spawnSync(process.execPath, [CLI_BIN, ...args], {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, NO_COLOR: '1' },
    timeout: 15000,
  });
}

function initGovernedProject(templateId = 'generic') {
  const tempRoot = mkdtempSync(join(tmpdir(), 'axc-template-validate-'));
  const result = runCli(tempRoot, ['init', '--governed', '--template', templateId, '-y']);
  assert.equal(result.status, 0, result.stderr);

  return {
    tempRoot,
    projectDir: join(tempRoot, 'my-agentxchain-project'),
  };
}

function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, 'utf8'));
}

function loadGovernedConfig(projectDir) {
  const rawConfig = readJson(join(projectDir, 'agentxchain.json'));
  const normalized = loadNormalizedConfig(rawConfig, projectDir);
  assert.equal(normalized.ok, true, normalized.errors?.join('\n'));
  return normalized.normalized;
}

describe('template validate command', () => {
  it('AT-TEMPLATE-VALIDATE-001: validates the built-in registry in JSON mode', () => {
    const result = runCli(tmpdir(), ['template', 'validate', '--json']);
    assert.equal(result.status, 0, result.stderr);

    const payload = JSON.parse(result.stdout);
    assert.equal(payload.ok, true);
    assert.equal(payload.registry.ok, true);
    assert.deepEqual(payload.registry.registered_ids, ['generic', 'api-service', 'cli-tool', 'library', 'web-app']);
    assert.deepEqual(payload.registry.manifest_ids, ['api-service', 'cli-tool', 'generic', 'library', 'web-app']);
    assert.equal(payload.project.present, false);
  });

  it('AT-TEMPLATE-VALIDATE-002: reports a governed project template as valid', () => {
    const { tempRoot, projectDir } = initGovernedProject('library');
    try {
      const result = runCli(projectDir, ['template', 'validate', '--json']);
      assert.equal(result.status, 0, result.stderr);

      const payload = JSON.parse(result.stdout);
      assert.equal(payload.ok, true);
      assert.equal(payload.project.present, true);
      assert.equal(payload.project.template, 'library');
      assert.equal(payload.project.source, 'agentxchain.json');
      assert.equal(payload.project.ok, true);
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it('AT-TEMPLATE-VALIDATE-003: treats a missing template field as implicit generic', () => {
    const { tempRoot, projectDir } = initGovernedProject('generic');
    try {
      const configPath = join(projectDir, 'agentxchain.json');
      const config = readJson(configPath);
      delete config.template;
      writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n');

      const result = runCli(projectDir, ['template', 'validate', '--json']);
      assert.equal(result.status, 0, result.stderr);

      const payload = JSON.parse(result.stdout);
      assert.equal(payload.ok, true);
      assert.equal(payload.project.template, 'generic');
      assert.equal(payload.project.source, 'implicit_default');
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it('AT-TEMPLATE-VALIDATE-004: fails for an unknown configured project template', () => {
    const { tempRoot, projectDir } = initGovernedProject('generic');
    try {
      const configPath = join(projectDir, 'agentxchain.json');
      const config = readJson(configPath);
      config.template = 'future-template';
      writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n');

      const result = runCli(projectDir, ['template', 'validate']);
      assert.equal(result.status, 1);
      const output = result.stdout + result.stderr;
      assert.match(output, /future-template/);
      assert.match(output, /Unknown template/);
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });
});

describe('validate integration', () => {
  it('AT-TEMPLATE-VALIDATE-005: governed validate fails when the configured template is unknown', () => {
    const { tempRoot, projectDir } = initGovernedProject('generic');
    try {
      const configPath = join(projectDir, 'agentxchain.json');
      const config = readJson(configPath);
      config.template = 'future-template';
      writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n');

      const result = runCli(projectDir, ['validate', '--json']);
      assert.equal(result.status, 1);

      const payload = JSON.parse(result.stdout);
      assert.equal(payload.ok, false);
      assert.ok(payload.errors.some((error) => error.includes('future-template')));
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });
});

describe('planning artifact completeness validation', () => {
  it('AT-PLANNING-001: library project with all artifacts passes', () => {
    const { tempRoot, projectDir } = initGovernedProject('library');
    try {
      const result = validateProjectPlanningArtifacts(projectDir, 'library');
      assert.equal(result.ok, true);
      assert.equal(result.template, 'library');
      assert.deepEqual(result.expected, ['public-api.md', 'compatibility-policy.md', 'release-adoption.md']);
      assert.deepEqual(result.present, ['public-api.md', 'compatibility-policy.md', 'release-adoption.md']);
      assert.deepEqual(result.missing, []);
      assert.equal(result.errors.length, 0);
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it('AT-PLANNING-002: library project missing an artifact fails', () => {
    const { tempRoot, projectDir } = initGovernedProject('library');
    try {
      // Delete one planning artifact
      rmSync(join(projectDir, '.planning', 'public-api.md'));

      const result = validateProjectPlanningArtifacts(projectDir, 'library');
      assert.equal(result.ok, false);
      assert.deepEqual(result.missing, ['public-api.md']);
      assert.deepEqual(result.present, ['compatibility-policy.md', 'release-adoption.md']);
      assert.ok(result.errors.some((e) => e.includes('public-api.md')));
      assert.ok(result.errors.some((e) => e.includes('missing')));
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it('AT-PLANNING-003: generic project passes trivially (no artifacts)', () => {
    const { tempRoot, projectDir } = initGovernedProject('generic');
    try {
      const result = validateProjectPlanningArtifacts(projectDir, 'generic');
      assert.equal(result.ok, true);
      assert.deepEqual(result.expected, []);
      assert.deepEqual(result.present, []);
      assert.deepEqual(result.missing, []);
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it('AT-PLANNING-004: implicit generic (no template key) passes', () => {
    const { tempRoot, projectDir } = initGovernedProject('generic');
    try {
      const result = validateProjectPlanningArtifacts(projectDir, undefined);
      assert.equal(result.ok, true);
      assert.equal(result.template, 'generic');
      assert.deepEqual(result.expected, []);
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it('AT-PLANNING-005: template validate --json includes planning_artifacts', () => {
    const { tempRoot, projectDir } = initGovernedProject('library');
    try {
      const result = runCli(projectDir, ['template', 'validate', '--json']);
      assert.equal(result.status, 0, result.stderr);

      const payload = JSON.parse(result.stdout);
      assert.ok(payload.planning_artifacts, 'planning_artifacts key must be present');
      assert.equal(payload.planning_artifacts.ok, true);
      assert.equal(payload.planning_artifacts.template, 'library');
      assert.deepEqual(payload.planning_artifacts.expected, ['public-api.md', 'compatibility-policy.md', 'release-adoption.md']);
      assert.deepEqual(payload.planning_artifacts.missing, []);
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it('AT-PLANNING-006: template validate --json fails when artifact missing', () => {
    const { tempRoot, projectDir } = initGovernedProject('library');
    try {
      rmSync(join(projectDir, '.planning', 'compatibility-policy.md'));

      const result = runCli(projectDir, ['template', 'validate', '--json']);
      assert.equal(result.status, 1);

      const payload = JSON.parse(result.stdout);
      assert.equal(payload.ok, false);
      assert.equal(payload.planning_artifacts.ok, false);
      assert.deepEqual(payload.planning_artifacts.missing, ['compatibility-policy.md']);
      assert.ok(payload.errors.some((e) => e.includes('compatibility-policy.md')));
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it('AT-PLANNING-007: governed validate fails when planning artifact missing', () => {
    const { tempRoot, projectDir } = initGovernedProject('library');
    try {
      rmSync(join(projectDir, '.planning', 'release-adoption.md'));

      const result = runCli(projectDir, ['validate', '--json']);
      assert.equal(result.status, 1);

      const payload = JSON.parse(result.stdout);
      assert.equal(payload.ok, false);
      assert.ok(payload.errors.some((e) => e.includes('release-adoption.md')));
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it('AT-PLANNING-008: no planning_artifacts when no project detected', () => {
    const result = runCli(tmpdir(), ['template', 'validate', '--json']);
    assert.equal(result.status, 0, result.stderr);

    const payload = JSON.parse(result.stdout);
    assert.equal(payload.planning_artifacts, null);
  });
});

describe('workflow kit validation', () => {
  it('AT-WORKFLOW-KIT-001: fresh governed init passes workflow kit validation', () => {
    const { tempRoot, projectDir } = initGovernedProject('library');
    try {
      const config = loadGovernedConfig(projectDir);
      const result = validateGovernedWorkflowKit(projectDir, config);
      assert.equal(result.ok, true);
      assert.deepEqual(result.required_files, [
        '.planning/PM_SIGNOFF.md',
        '.planning/ROADMAP.md',
        '.planning/SYSTEM_SPEC.md',
        '.planning/acceptance-matrix.md',
        '.planning/ship-verdict.md',
        '.planning/IMPLEMENTATION_NOTES.md',
        '.planning/RELEASE_NOTES.md',
      ]);
      assert.deepEqual(result.gate_required_files, [
        '.planning/PM_SIGNOFF.md',
        '.planning/ROADMAP.md',
        '.planning/SYSTEM_SPEC.md',
        '.planning/IMPLEMENTATION_NOTES.md',
        '.planning/acceptance-matrix.md',
        '.planning/ship-verdict.md',
        '.planning/RELEASE_NOTES.md',
      ]);
      assert.equal(result.present.length, 7);
      assert.deepEqual(result.missing, []);
      assert.equal(result.structural_checks.every((check) => check.ok), true);
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it('AT-WORKFLOW-KIT-002: missing ship-verdict fails template validate json', () => {
    const { tempRoot, projectDir } = initGovernedProject('library');
    try {
      rmSync(join(projectDir, '.planning', 'ship-verdict.md'));

      const result = runCli(projectDir, ['template', 'validate', '--json']);
      assert.equal(result.status, 1);

      const payload = JSON.parse(result.stdout);
      assert.ok(payload.workflow_kit, 'workflow_kit key must be present');
      assert.equal(payload.workflow_kit.ok, false);
      assert.deepEqual(payload.workflow_kit.missing, ['.planning/ship-verdict.md']);
      assert.ok(payload.errors.some((error) => error.includes('.planning/ship-verdict.md')));
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it('AT-WORKFLOW-KIT-003: missing Approved field fails workflow kit structural check', () => {
    const { tempRoot, projectDir } = initGovernedProject('library');
    try {
      writeFileSync(
        join(projectDir, '.planning', 'PM_SIGNOFF.md'),
        '# PM Signoff\n\nThis file no longer declares approval.\n'
      );

      const result = runCli(projectDir, ['template', 'validate', '--json']);
      assert.equal(result.status, 1);

      const payload = JSON.parse(result.stdout);
      const approvedFieldCheck = payload.workflow_kit.structural_checks.find(
        (check) => check.id === 'pm_signoff_approved_field'
      );
      assert.ok(approvedFieldCheck, 'pm_signoff_approved_field check must be present');
      assert.equal(approvedFieldCheck.ok, false);
      assert.ok(payload.errors.some((error) => error.includes('PM_SIGNOFF.md')));
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it('AT-WORKFLOW-KIT-004: governed validate reuses workflow kit validation errors', () => {
    const { tempRoot, projectDir } = initGovernedProject('library');
    try {
      writeFileSync(
        join(projectDir, '.planning', 'ROADMAP.md'),
        '# Roadmap\n\nThis file lost the phases section.\n'
      );

      const result = runCli(projectDir, ['validate', '--json']);
      assert.equal(result.status, 1);

      const payload = JSON.parse(result.stdout);
      assert.ok(
        payload.errors.some((error) => error.includes('ROADMAP.md') && error.includes('structural marker')),
        'governed validate must surface workflow kit structural errors'
      );
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });
});

describe('acceptance hint completion validation', () => {
  it('AT-HINT-001: library project with all hints checked → no warnings', () => {
    const { tempRoot, projectDir } = initGovernedProject('library');
    try {
      // Check all hints in acceptance-matrix.md
      const matrixPath = join(projectDir, '.planning', 'acceptance-matrix.md');
      let content = readFileSync(matrixPath, 'utf8');
      content = content.replace(/- \[ \]/g, '- [x]');
      writeFileSync(matrixPath, content);

      const result = validateAcceptanceHintCompletion(projectDir, 'library');
      assert.equal(result.total, 3);
      assert.equal(result.checked, 3);
      assert.equal(result.unchecked, 0);
      assert.deepEqual(result.unchecked_hints, []);
      assert.equal(result.warnings.length, 0);
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it('AT-HINT-002: library project with one hint unchecked → warning naming the hint', () => {
    const { tempRoot, projectDir } = initGovernedProject('library');
    try {
      // Check only the first two hints
      const matrixPath = join(projectDir, '.planning', 'acceptance-matrix.md');
      let content = readFileSync(matrixPath, 'utf8');
      // Check first two, leave third unchecked
      const lines = content.split('\n');
      let checkedCount = 0;
      for (let i = 0; i < lines.length; i++) {
        if (lines[i].startsWith('- [ ]') && checkedCount < 2) {
          lines[i] = lines[i].replace('- [ ]', '- [x]');
          checkedCount++;
        }
      }
      writeFileSync(matrixPath, lines.join('\n'));

      const result = validateAcceptanceHintCompletion(projectDir, 'library');
      assert.equal(result.total, 3);
      assert.equal(result.checked, 2);
      assert.equal(result.unchecked, 1);
      assert.equal(result.unchecked_hints.length, 1);
      assert.equal(result.warnings.length, 1);
      assert.match(result.warnings[0], /unchecked/i);
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it('AT-HINT-003: library project with missing acceptance-matrix.md → missing_file warning', () => {
    const { tempRoot, projectDir } = initGovernedProject('library');
    try {
      rmSync(join(projectDir, '.planning', 'acceptance-matrix.md'));

      const result = validateAcceptanceHintCompletion(projectDir, 'library');
      assert.equal(result.missing_file, true);
      assert.equal(result.total, 3);
      assert.equal(result.unchecked, 3);
      assert.equal(result.warnings.length, 1);
      assert.match(result.warnings[0], /not found/i);
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it('AT-HINT-004: library project with no Template Guidance section → missing_section warning', () => {
    const { tempRoot, projectDir } = initGovernedProject('library');
    try {
      // Overwrite acceptance-matrix.md without the Template Guidance section
      const matrixPath = join(projectDir, '.planning', 'acceptance-matrix.md');
      writeFileSync(matrixPath, '# Acceptance Matrix\n\nSome content without template guidance.\n');

      const result = validateAcceptanceHintCompletion(projectDir, 'library');
      assert.equal(result.missing_section, true);
      assert.equal(result.total, 3);
      assert.equal(result.unchecked, 3);
      assert.equal(result.warnings.length, 1);
      assert.match(result.warnings[0], /Template Guidance/);
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it('AT-HINT-005: generic template → trivially OK, zero warnings', () => {
    const { tempRoot, projectDir } = initGovernedProject('generic');
    try {
      const result = validateAcceptanceHintCompletion(projectDir, 'generic');
      assert.equal(result.total, 0);
      assert.equal(result.checked, 0);
      assert.equal(result.unchecked, 0);
      assert.equal(result.warnings.length, 0);
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it('AT-HINT-006: template validate --json includes acceptance_hints key', () => {
    const { tempRoot, projectDir } = initGovernedProject('library');
    try {
      const result = runCli(projectDir, ['template', 'validate', '--json']);
      assert.equal(result.status, 0, result.stderr);

      const payload = JSON.parse(result.stdout);
      assert.ok(payload.acceptance_hints, 'acceptance_hints key must be present');
      assert.equal(payload.acceptance_hints.template, 'library');
      assert.equal(payload.acceptance_hints.total, 3);
      assert.equal(typeof payload.acceptance_hints.checked, 'number');
      assert.equal(typeof payload.acceptance_hints.unchecked, 'number');
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it('AT-HINT-007: governed validate surfaces unchecked hints as warnings', () => {
    const { tempRoot, projectDir } = initGovernedProject('library');
    try {
      const result = runCli(projectDir, ['validate', '--json']);
      // validate may fail for other reasons (missing QA files etc.) but should contain hint warnings
      const payload = JSON.parse(result.stdout);
      // Library hints are unchecked by default after init
      assert.ok(payload.warnings.some((w) => w.includes('unchecked') || w.includes('Acceptance hint')),
        'should surface acceptance hint warnings');
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it('AT-HINT-008: hint text deleted from file treated as unchecked', () => {
    const { tempRoot, projectDir } = initGovernedProject('library');
    try {
      // Remove the Template Guidance content but keep the header
      const matrixPath = join(projectDir, '.planning', 'acceptance-matrix.md');
      writeFileSync(matrixPath, '# Acceptance Matrix\n\n## Template Guidance\n\n');

      const result = validateAcceptanceHintCompletion(projectDir, 'library');
      assert.equal(result.total, 3);
      assert.equal(result.checked, 0);
      assert.equal(result.unchecked, 3);
      assert.equal(result.warnings.length, 3);
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it('AT-HINT-009: no acceptance_hints when no project detected', () => {
    const result = runCli(tmpdir(), ['template', 'validate', '--json']);
    assert.equal(result.status, 0, result.stderr);

    const payload = JSON.parse(result.stdout);
    assert.equal(payload.acceptance_hints, null);
  });
});

describe('template registry drift detection', () => {
  it('AT-TEMPLATE-VALIDATE-006: fails when an unregistered manifest exists on disk', () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'axc-template-registry-'));
    const manifestDir = join(tempDir, 'governed');
    cpSync(GOVERNED_TEMPLATES_DIR, manifestDir, { recursive: true });
    writeFileSync(
      join(manifestDir, 'orphan-template.json'),
      JSON.stringify({
        id: 'orphan-template',
        display_name: 'Orphan Template',
        description: 'Should fail because it is not registered.',
        version: '1',
        protocol_compatibility: ['1.0'],
        planning_artifacts: [],
        prompt_overrides: {},
        acceptance_hints: [],
      }, null, 2) + '\n'
    );

    try {
      const result = validateGovernedTemplateRegistry({ manifestDir });
      assert.equal(result.ok, false);
      assert.ok(result.errors.some((error) => error.includes('orphan-template.json')));
      assert.deepEqual(
        readdirSync(manifestDir).filter((entry) => entry.endsWith('.json')).sort(),
        [
          'api-service.json',
          'cli-tool.json',
          'generic.json',
          'library.json',
          'orphan-template.json',
          'web-app.json',
        ]
      );
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
