import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { existsSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI_BIN = join(__dirname, '..', 'bin', 'agentxchain.js');
const REPO_ROOT = join(__dirname, '..', '..');
const SPEC_PATH = join(REPO_ROOT, '.planning', 'GENERATE_PLANNING_COMMAND_SPEC.md');

function runCli(cwd, args) {
  return spawnSync(process.execPath, [CLI_BIN, ...args], {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, NO_COLOR: '1' },
    timeout: 20000,
  });
}

function initGovernedProject(template = 'generic') {
  const tempRoot = mkdtempSync(join(tmpdir(), 'axc-generate-planning-'));
  const result = runCli(tempRoot, ['init', '--governed', '--template', template, '--dir', 'repo', '-y']);
  assert.equal(result.status, 0, result.stderr);
  return {
    tempRoot,
    projectDir: join(tempRoot, 'repo'),
  };
}

function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, 'utf8'));
}

describe('generate planning command', () => {
  it('AT-GEN-PLAN-001: recreates missing baseline governed planning artifacts', () => {
    const { tempRoot, projectDir } = initGovernedProject('generic');
    try {
      unlinkSync(join(projectDir, '.planning', 'PM_SIGNOFF.md'));
      unlinkSync(join(projectDir, '.planning', 'RELEASE_NOTES.md'));

      const result = runCli(projectDir, ['generate', 'planning']);
      assert.equal(result.status, 0, result.stderr);
      assert.ok(existsSync(join(projectDir, '.planning', 'PM_SIGNOFF.md')));
      assert.ok(existsSync(join(projectDir, '.planning', 'RELEASE_NOTES.md')));
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it('AT-GEN-PLAN-002: recreates template-specific planning artifacts from the configured template', () => {
    const { tempRoot, projectDir } = initGovernedProject('api-service');
    try {
      unlinkSync(join(projectDir, '.planning', 'api-contract.md'));

      const result = runCli(projectDir, ['generate', 'planning']);
      assert.equal(result.status, 0, result.stderr);
      const recreated = readFileSync(join(projectDir, '.planning', 'api-contract.md'), 'utf8');
      assert.match(recreated, /^# API Contract — repo/m);
      assert.match(recreated, /## Endpoints/);
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it('AT-GEN-PLAN-003: recreates explicit workflow-kit artifact files', () => {
    const { tempRoot, projectDir } = initGovernedProject('enterprise-app');
    try {
      unlinkSync(join(projectDir, '.planning', 'ARCHITECTURE.md'));

      const result = runCli(projectDir, ['generate', 'planning']);
      assert.equal(result.status, 0, result.stderr);
      const recreated = readFileSync(join(projectDir, '.planning', 'ARCHITECTURE.md'), 'utf8');
      assert.match(recreated, /^# ARCHITECTURE/i);
      assert.match(recreated, /## Context/);
      assert.match(recreated, /## Proposed Design/);
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it('AT-GEN-PLAN-004: preserves existing planning artifacts by default', () => {
    const { tempRoot, projectDir } = initGovernedProject('generic');
    try {
      const customContent = '# PM Signoff\n\nApproved: MAYBE\n\nDo not overwrite.\n';
      writeFileSync(join(projectDir, '.planning', 'PM_SIGNOFF.md'), customContent);

      const result = runCli(projectDir, ['generate', 'planning']);
      assert.equal(result.status, 0, result.stderr);
      assert.equal(readFileSync(join(projectDir, '.planning', 'PM_SIGNOFF.md'), 'utf8'), customContent);
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it('AT-GEN-PLAN-005: force overwrites scaffold-owned planning artifacts', () => {
    const { tempRoot, projectDir } = initGovernedProject('generic');
    try {
      writeFileSync(join(projectDir, '.planning', 'PM_SIGNOFF.md'), '# overwritten\n');

      const result = runCli(projectDir, ['generate', 'planning', '--force']);
      assert.equal(result.status, 0, result.stderr);
      const content = readFileSync(join(projectDir, '.planning', 'PM_SIGNOFF.md'), 'utf8');
      assert.match(content, /Approved: NO/);
      assert.doesNotMatch(content, /# overwritten/);
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it('AT-GEN-PLAN-006: dry-run reports mutations without writing files', () => {
    const { tempRoot, projectDir } = initGovernedProject('generic');
    try {
      unlinkSync(join(projectDir, '.planning', 'PM_SIGNOFF.md'));

      const result = runCli(projectDir, ['generate', 'planning', '--dry-run']);
      assert.equal(result.status, 0, result.stderr);
      assert.match(result.stdout, /Would create/);
      assert.ok(!existsSync(join(projectDir, '.planning', 'PM_SIGNOFF.md')));
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it('AT-GEN-PLAN-007: json mode exposes created classification', () => {
    const { tempRoot, projectDir } = initGovernedProject('generic');
    try {
      unlinkSync(join(projectDir, '.planning', 'PM_SIGNOFF.md'));

      const result = runCli(projectDir, ['generate', 'planning', '--json']);
      assert.equal(result.status, 0, result.stderr);
      const payload = JSON.parse(result.stdout);
      assert.equal(payload.ok, true);
      assert.equal(payload.mode, 'planning');
      assert.ok(payload.created.includes('.planning/PM_SIGNOFF.md'));
      assert.equal(payload.force, false);
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it('AT-GEN-PLAN-008: rejects non-governed repos', () => {
    const tempRoot = mkdtempSync(join(tmpdir(), 'axc-generate-planning-legacy-'));
    try {
      writeFileSync(join(tempRoot, 'agentxchain.json'), JSON.stringify({ version: 3, project: 'Legacy', agents: {} }, null, 2));
      const result = runCli(tempRoot, ['generate', 'planning']);
      assert.equal(result.status, 1);
      assert.match(result.stdout + result.stderr, /governed repos/i);
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });
});

describe('generate planning spec', () => {
  it('ships a standalone spec with the acceptance matrix', () => {
    const spec = readFileSync(SPEC_PATH, 'utf8');
    assert.match(spec, /\*\*Status:\*\*\s+shipped/i);
    assert.match(spec, /AT-GEN-PLAN-001/);
    assert.match(spec, /AT-GEN-PLAN-008/);
    assert.match(spec, /agentxchain generate planning/);
  });
});
