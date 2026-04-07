import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
  mkdirSync,
} from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

import {
  validateGovernedTemplateManifest,
  loadGovernedTemplate,
  buildSystemSpecContent,
  SYSTEM_SPEC_OVERLAY_SEPARATOR,
  VALID_GOVERNED_TEMPLATE_IDS,
} from '../src/lib/governed-templates.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI_BIN = join(__dirname, '..', 'bin', 'agentxchain.js');

function runCli(cwd, args) {
  return spawnSync(process.execPath, [CLI_BIN, ...args], {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, NO_COLOR: '1' },
    timeout: 15000,
  });
}

function initGovernedProject(templateId = 'generic') {
  const tempRoot = mkdtempSync(join(tmpdir(), 'axc-spec-overlay-'));
  const result = runCli(tempRoot, ['init', '--governed', '--template', templateId, '-y']);
  assert.equal(result.status, 0, `init failed: ${result.stderr}`);
  return join(tempRoot, 'my-agentxchain-project');
}

// ── AT-SPEC-OVERLAY-001: init with api-service produces API-specific SYSTEM_SPEC ──

describe('system_spec_overlay — init path', () => {
  it('AT-SPEC-OVERLAY-001: init --governed --template api-service produces API-specific SYSTEM_SPEC', () => {
    const projectDir = initGovernedProject('api-service');
    try {
      const spec = readFileSync(join(projectDir, '.planning', 'SYSTEM_SPEC.md'), 'utf8');
      // Must have required structural markers
      assert.match(spec, /^## Purpose$/m);
      assert.match(spec, /^## Interface$/m);
      assert.match(spec, /^## Acceptance Tests$/m);
      // Must have API-specific guidance (not generic placeholders)
      assert.match(spec, /API service/i, 'Purpose should mention API service');
      assert.match(spec, /endpoint/i, 'Interface should mention endpoints');
      assert.match(spec, /api-contract\.md/i, 'Should reference api-contract.md');
      // Must NOT have generic placeholder
      assert.doesNotMatch(spec, /Describe the problem this slice solves/);
    } finally {
      rmSync(join(projectDir, '..'), { recursive: true, force: true });
    }
  });

  it('AT-SPEC-OVERLAY-001b: init with cli-tool produces CLI-specific SYSTEM_SPEC', () => {
    const projectDir = initGovernedProject('cli-tool');
    try {
      const spec = readFileSync(join(projectDir, '.planning', 'SYSTEM_SPEC.md'), 'utf8');
      assert.match(spec, /^## Purpose$/m);
      assert.match(spec, /CLI tool/i, 'Purpose should mention CLI tool');
      assert.match(spec, /command-surface\.md/i, 'Should reference command-surface.md');
      assert.doesNotMatch(spec, /Describe the problem this slice solves/);
    } finally {
      rmSync(join(projectDir, '..'), { recursive: true, force: true });
    }
  });

  it('AT-SPEC-OVERLAY-001c: init with library produces library-specific SYSTEM_SPEC', () => {
    const projectDir = initGovernedProject('library');
    try {
      const spec = readFileSync(join(projectDir, '.planning', 'SYSTEM_SPEC.md'), 'utf8');
      assert.match(spec, /^## Purpose$/m);
      assert.match(spec, /library/i, 'Purpose should mention library');
      assert.match(spec, /public-api\.md/i, 'Should reference public-api.md');
      assert.doesNotMatch(spec, /Describe the problem this slice solves/);
    } finally {
      rmSync(join(projectDir, '..'), { recursive: true, force: true });
    }
  });

  it('AT-SPEC-OVERLAY-001d: init with web-app produces web-app-specific SYSTEM_SPEC', () => {
    const projectDir = initGovernedProject('web-app');
    try {
      const spec = readFileSync(join(projectDir, '.planning', 'SYSTEM_SPEC.md'), 'utf8');
      assert.match(spec, /^## Purpose$/m);
      assert.match(spec, /web application/i, 'Purpose should mention web application');
      assert.match(spec, /user-flows\.md/i, 'Should reference user-flows.md');
      assert.doesNotMatch(spec, /Describe the problem this slice solves/);
    } finally {
      rmSync(join(projectDir, '..'), { recursive: true, force: true });
    }
  });

  // ── AT-SPEC-OVERLAY-002: generic template produces baseline SYSTEM_SPEC ──

  it('AT-SPEC-OVERLAY-002: init --governed --template generic produces baseline SYSTEM_SPEC', () => {
    const projectDir = initGovernedProject('generic');
    try {
      const spec = readFileSync(join(projectDir, '.planning', 'SYSTEM_SPEC.md'), 'utf8');
      assert.match(spec, /^## Purpose$/m);
      assert.match(spec, /^## Interface$/m);
      assert.match(spec, /^## Acceptance Tests$/m);
      // Generic placeholders present
      assert.match(spec, /Describe the problem this slice solves/);
      assert.match(spec, /List the user-facing commands/);
    } finally {
      rmSync(join(projectDir, '..'), { recursive: true, force: true });
    }
  });
});

// ── AT-SPEC-OVERLAY-003/004/005: template set path ──

describe('system_spec_overlay — template set path', () => {
  it('AT-SPEC-OVERLAY-003: template set api-service appends Template-Specific Guidance', () => {
    const projectDir = initGovernedProject('generic');
    try {
      const result = runCli(projectDir, ['template', 'set', 'api-service', '-y']);
      assert.equal(result.status, 0, `template set failed: ${result.stderr}`);
      const spec = readFileSync(join(projectDir, '.planning', 'SYSTEM_SPEC.md'), 'utf8');
      assert.ok(spec.includes(SYSTEM_SPEC_OVERLAY_SEPARATOR), 'Should contain overlay separator');
      assert.match(spec, /API service/i, 'Should contain API-specific guidance');
      // Original generic content should still be present (not overwritten)
      assert.match(spec, /Describe the problem this slice solves/);
    } finally {
      rmSync(join(projectDir, '..'), { recursive: true, force: true });
    }
  });

  it('AT-SPEC-OVERLAY-004: template set is idempotent — no duplicate append', () => {
    const projectDir = initGovernedProject('generic');
    try {
      // First set
      runCli(projectDir, ['template', 'set', 'api-service', '-y']);
      const specAfterFirst = readFileSync(join(projectDir, '.planning', 'SYSTEM_SPEC.md'), 'utf8');
      const firstCount = specAfterFirst.split(SYSTEM_SPEC_OVERLAY_SEPARATOR).length - 1;
      assert.equal(firstCount, 1, 'Should have exactly one overlay separator');

      // Switch to a different template and back
      // (same-template is a no-op, so we switch to library first)
      runCli(projectDir, ['template', 'set', 'library', '-y']);
      const specAfterLibrary = readFileSync(join(projectDir, '.planning', 'SYSTEM_SPEC.md'), 'utf8');
      const secondCount = specAfterLibrary.split(SYSTEM_SPEC_OVERLAY_SEPARATOR).length - 1;
      assert.equal(secondCount, 1, 'Should still have exactly one overlay separator (skip on existing)');
    } finally {
      rmSync(join(projectDir, '..'), { recursive: true, force: true });
    }
  });

  it('AT-SPEC-OVERLAY-005: template set warns when SYSTEM_SPEC.md is missing', () => {
    const projectDir = initGovernedProject('generic');
    try {
      // Remove SYSTEM_SPEC.md
      rmSync(join(projectDir, '.planning', 'SYSTEM_SPEC.md'));
      const result = runCli(projectDir, ['template', 'set', 'api-service', '-y']);
      assert.equal(result.status, 0, 'Should not fail');
      assert.match(result.stdout, /SYSTEM_SPEC\.md not found|MISSING FILE/i,
        'Should warn about missing SYSTEM_SPEC.md');
    } finally {
      rmSync(join(projectDir, '..'), { recursive: true, force: true });
    }
  });
});

// ── AT-SPEC-OVERLAY-006/007: manifest validation ──

describe('system_spec_overlay — manifest validation', () => {
  it('AT-SPEC-OVERLAY-006: rejects system_spec_overlay with unknown keys', () => {
    const manifest = {
      id: 'test',
      display_name: 'Test',
      description: 'Test template',
      version: '1',
      protocol_compatibility: ['1.0'],
      planning_artifacts: [],
      system_spec_overlay: {
        purpose_guidance: 'valid',
        unknown_key: 'invalid',
      },
    };
    const result = validateGovernedTemplateManifest(manifest);
    assert.equal(result.ok, false);
    assert.ok(result.errors.some(e => e.includes('unknown key "unknown_key"')));
  });

  it('AT-SPEC-OVERLAY-007: rejects system_spec_overlay with empty-string values', () => {
    const manifest = {
      id: 'test',
      display_name: 'Test',
      description: 'Test template',
      version: '1',
      protocol_compatibility: ['1.0'],
      planning_artifacts: [],
      system_spec_overlay: {
        purpose_guidance: '',
      },
    };
    const result = validateGovernedTemplateManifest(manifest);
    assert.equal(result.ok, false);
    assert.ok(result.errors.some(e => e.includes('must be a non-empty string')));
  });

  it('AT-SPEC-OVERLAY-008: all non-generic templates have non-empty system_spec_overlay', () => {
    const nonGenericIds = VALID_GOVERNED_TEMPLATE_IDS.filter(id => id !== 'generic');
    for (const templateId of nonGenericIds) {
      const manifest = loadGovernedTemplate(templateId);
      assert.ok(manifest.system_spec_overlay, `${templateId} should have system_spec_overlay`);
      assert.ok(
        Object.keys(manifest.system_spec_overlay).length > 0,
        `${templateId} system_spec_overlay should be non-empty`
      );
      assert.ok(
        manifest.system_spec_overlay.purpose_guidance,
        `${templateId} should have purpose_guidance`
      );
      assert.ok(
        manifest.system_spec_overlay.interface_guidance,
        `${templateId} should have interface_guidance`
      );
      assert.ok(
        manifest.system_spec_overlay.acceptance_tests_guidance,
        `${templateId} should have acceptance_tests_guidance`
      );
    }
  });
});

// ── buildSystemSpecContent unit tests ──

describe('buildSystemSpecContent', () => {
  it('produces baseline content with no overlay', () => {
    const content = buildSystemSpecContent('TestProject', undefined);
    assert.match(content, /^# System Spec — TestProject$/m);
    assert.match(content, /^## Purpose$/m);
    assert.match(content, /^## Interface$/m);
    assert.match(content, /^## Acceptance Tests$/m);
    assert.match(content, /Describe the problem this slice solves/);
  });

  it('produces overlay content when provided', () => {
    const overlay = {
      purpose_guidance: 'Custom purpose text',
      interface_guidance: 'Custom interface text',
      acceptance_tests_guidance: '- [ ] Custom test',
    };
    const content = buildSystemSpecContent('TestProject', overlay);
    assert.match(content, /Custom purpose text/);
    assert.match(content, /Custom interface text/);
    assert.match(content, /Custom test/);
    assert.doesNotMatch(content, /Describe the problem this slice solves/);
  });

  it('preserves required section headers regardless of overlay', () => {
    const overlay = { purpose_guidance: 'x', interface_guidance: 'y', acceptance_tests_guidance: 'z' };
    const content = buildSystemSpecContent('P', overlay);
    assert.match(content, /^## Purpose$/m);
    assert.match(content, /^## Interface$/m);
    assert.match(content, /^## Behavior$/m);
    assert.match(content, /^## Error Cases$/m);
    assert.match(content, /^## Acceptance Tests$/m);
    assert.match(content, /^## Open Questions$/m);
  });
});

// ── Spec guard ──

describe('spec guard', () => {
  it('TEMPLATE_SYSTEM_SPEC_OVERLAY_SPEC.md exists', () => {
    const specPath = join(__dirname, '..', '..', '.planning', 'TEMPLATE_SYSTEM_SPEC_OVERLAY_SPEC.md');
    assert.ok(existsSync(specPath), 'Spec file must exist');
  });
});
