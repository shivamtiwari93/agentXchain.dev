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
} from '../src/lib/governed-templates.js';

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
