import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  validateV4Config,
  validateWorkflowKitConfig,
  normalizeWorkflowKit,
  normalizeV4,
  loadNormalizedConfig,
} from '../src/lib/normalized-config.js';
import { evaluateArtifactSemantics } from '../src/lib/workflow-gate-semantics.js';

function baseConfig(overrides = {}) {
  return {
    schema_version: '1.0',
    project: { id: 'test', name: 'Test' },
    roles: { dev: { title: 'Dev', mandate: 'Build', write_authority: 'authoritative', runtime: 'r1' } },
    runtimes: { r1: { type: 'manual' } },
    ...overrides,
  };
}

// --- validateWorkflowKitConfig ---

describe('validateWorkflowKitConfig', () => {
  it('AT-WKC-001: accepts valid workflow_kit with custom phase artifacts', () => {
    const result = validateWorkflowKitConfig({
      phases: {
        planning: {
          artifacts: [
            { path: '.planning/PM_SIGNOFF.md', semantics: 'pm_signoff', required: true },
          ],
        },
        design: {
          artifacts: [
            { path: '.planning/DESIGN_DOC.md', semantics: 'section_check', semantics_config: { required_sections: ['## Architecture'] } },
          ],
        },
      },
    }, { planning: {}, design: {}, implementation: {} });
    assert.equal(result.ok, true, `Unexpected errors: ${result.errors.join(', ')}`);
  });

  it('AT-WKC-002: warns when workflow_kit phase is not in routing', () => {
    const result = validateWorkflowKitConfig({
      phases: {
        nonexistent: {
          artifacts: [
            { path: '.planning/FOO.md', semantics: null },
          ],
        },
      },
    }, { planning: {} });
    assert.equal(result.ok, true);
    assert.ok(result.warnings.some(w => w.includes('nonexistent') && w.includes('not in routing')));
  });

  it('AT-WKC-003: rejects artifact path containing ..', () => {
    const result = validateWorkflowKitConfig({
      phases: {
        planning: {
          artifacts: [
            { path: '../outside/secret.md', semantics: null },
          ],
        },
      },
    }, { planning: {} });
    assert.equal(result.ok, false);
    assert.ok(result.errors.some(e => e.includes('..')));
  });

  it('AT-WKC-004: rejects unknown semantics validator', () => {
    const result = validateWorkflowKitConfig({
      phases: {
        planning: {
          artifacts: [
            { path: '.planning/FOO.md', semantics: 'magic_validator' },
          ],
        },
      },
    }, { planning: {} });
    assert.equal(result.ok, false);
    assert.ok(result.errors.some(e => e.includes('magic_validator') && e.includes('unknown')));
  });

  it('AT-WKC-005: rejects section_check without required_sections', () => {
    const result = validateWorkflowKitConfig({
      phases: {
        planning: {
          artifacts: [
            { path: '.planning/FOO.md', semantics: 'section_check' },
          ],
        },
      },
    }, { planning: {} });
    assert.equal(result.ok, false);
    assert.ok(result.errors.some(e => e.includes('section_check') && e.includes('semantics_config')));
  });

  it('AT-WKC-005b: rejects section_check with empty required_sections', () => {
    const result = validateWorkflowKitConfig({
      phases: {
        planning: {
          artifacts: [
            { path: '.planning/FOO.md', semantics: 'section_check', semantics_config: { required_sections: [] } },
          ],
        },
      },
    }, { planning: {} });
    assert.equal(result.ok, false);
    assert.ok(result.errors.some(e => e.includes('non-empty')));
  });

  it('AT-WKC-006: rejects duplicate artifact paths in same phase', () => {
    const result = validateWorkflowKitConfig({
      phases: {
        planning: {
          artifacts: [
            { path: '.planning/FOO.md', semantics: null },
            { path: '.planning/FOO.md', semantics: null },
          ],
        },
      },
    }, { planning: {} });
    assert.equal(result.ok, false);
    assert.ok(result.errors.some(e => e.includes('duplicate')));
  });

  it('accepts empty workflow_kit as valid opt-out', () => {
    const result = validateWorkflowKitConfig({}, { planning: {} });
    assert.equal(result.ok, true);
  });

  it('rejects workflow_kit that is not an object', () => {
    const result = validateWorkflowKitConfig('bad', { planning: {} });
    assert.equal(result.ok, false);
    assert.ok(result.errors.some(e => e.includes('must be an object')));
  });
});

// --- normalizeWorkflowKit ---

describe('normalizeWorkflowKit', () => {
  it('AT-WKC-010: absent workflow_kit produces default artifacts for standard phases', () => {
    const result = normalizeWorkflowKit(undefined, ['planning', 'implementation', 'qa']);
    assert.ok(result.phases.planning);
    assert.ok(result.phases.implementation);
    assert.ok(result.phases.qa);
    assert.equal(result.phases.planning.artifacts.length, 3);
    assert.equal(result.phases.implementation.artifacts.length, 1);
    assert.equal(result.phases.qa.artifacts.length, 3);
  });

  it('AT-WKC-011: empty workflow_kit produces no per-phase artifacts', () => {
    const result = normalizeWorkflowKit({}, ['planning', 'implementation', 'qa']);
    assert.deepEqual(result.phases, {});
  });

  it('AT-WKC-012: partial workflow_kit only declares specified phases', () => {
    const result = normalizeWorkflowKit({
      phases: {
        planning: {
          artifacts: [{ path: '.planning/PM_SIGNOFF.md', semantics: 'pm_signoff' }],
        },
      },
    }, ['planning', 'implementation', 'qa']);
    assert.ok(result.phases.planning);
    assert.equal(result.phases.implementation, undefined);
    assert.equal(result.phases.qa, undefined);
  });

  it('defaults required to true when absent', () => {
    const result = normalizeWorkflowKit({
      phases: {
        planning: {
          artifacts: [{ path: '.planning/FOO.md', semantics: null }],
        },
      },
    }, ['planning']);
    assert.equal(result.phases.planning.artifacts[0].required, true);
  });

  it('preserves required: false', () => {
    const result = normalizeWorkflowKit({
      phases: {
        planning: {
          artifacts: [{ path: '.planning/FOO.md', semantics: null, required: false }],
        },
      },
    }, ['planning']);
    assert.equal(result.phases.planning.artifacts[0].required, false);
  });

  it('custom phases without default artifacts get no entries', () => {
    const result = normalizeWorkflowKit(undefined, ['planning', 'design', 'implementation', 'qa']);
    assert.ok(result.phases.planning);
    assert.equal(result.phases.design, undefined);
    assert.ok(result.phases.implementation);
    assert.ok(result.phases.qa);
  });
});

// --- normalizeV4 integration ---

describe('normalizeV4 workflow_kit integration', () => {
  it('attaches workflow_kit to normalized config', () => {
    const raw = baseConfig();
    const normalized = normalizeV4(raw);
    assert.ok(normalized.workflow_kit);
    assert.ok(normalized.workflow_kit.phases);
  });

  it('uses default artifacts when workflow_kit is absent', () => {
    const raw = baseConfig();
    const normalized = normalizeV4(raw);
    // No routing → defaults to planning/implementation/qa
    assert.ok(normalized.workflow_kit.phases.planning);
    assert.ok(normalized.workflow_kit.phases.qa);
  });

  it('uses explicit workflow_kit when provided', () => {
    const raw = baseConfig({
      workflow_kit: {
        phases: {
          planning: {
            artifacts: [{ path: '.planning/CUSTOM.md', semantics: null }],
          },
        },
      },
    });
    const normalized = normalizeV4(raw);
    assert.equal(normalized.workflow_kit.phases.planning.artifacts.length, 1);
    assert.equal(normalized.workflow_kit.phases.planning.artifacts[0].path, '.planning/CUSTOM.md');
    assert.equal(normalized.workflow_kit.phases.qa, undefined);
  });
});

// --- validateV4Config workflow_kit ---

describe('validateV4Config workflow_kit', () => {
  it('accepts config with valid workflow_kit', () => {
    const config = baseConfig({
      routing: { planning: { entry_role: 'dev' } },
      workflow_kit: {
        phases: {
          planning: {
            artifacts: [{ path: '.planning/PM_SIGNOFF.md', semantics: 'pm_signoff' }],
          },
        },
      },
    });
    const result = validateV4Config(config);
    assert.equal(result.ok, true, `Unexpected errors: ${result.errors.join(', ')}`);
  });

  it('rejects config with invalid workflow_kit artifact', () => {
    const config = baseConfig({
      routing: { planning: { entry_role: 'dev' } },
      workflow_kit: {
        phases: {
          planning: {
            artifacts: [{ path: '../escape.md', semantics: null }],
          },
        },
      },
    });
    const result = validateV4Config(config);
    assert.equal(result.ok, false);
    assert.ok(result.errors.some(e => e.includes('..')));
  });
});

// --- evaluateArtifactSemantics ---

describe('evaluateArtifactSemantics', () => {
  it('AT-WKC-024: section_check passes when all sections present', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'axc-wk-'));
    mkdirSync(join(tmp, '.planning'), { recursive: true });
    writeFileSync(join(tmp, '.planning/DESIGN.md'), '# Design\n\n## Architecture\n\nSome content\n\n## Interfaces\n\nMore content\n');
    const result = evaluateArtifactSemantics(tmp, {
      path: '.planning/DESIGN.md',
      semantics: 'section_check',
      semantics_config: { required_sections: ['## Architecture', '## Interfaces'] },
    });
    assert.ok(result);
    assert.equal(result.ok, true);
  });

  it('AT-WKC-025: section_check fails when section missing', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'axc-wk-'));
    mkdirSync(join(tmp, '.planning'), { recursive: true });
    writeFileSync(join(tmp, '.planning/DESIGN.md'), '# Design\n\n## Architecture\n\nSome content\n');
    const result = evaluateArtifactSemantics(tmp, {
      path: '.planning/DESIGN.md',
      semantics: 'section_check',
      semantics_config: { required_sections: ['## Architecture', '## Trade-offs'] },
    });
    assert.ok(result);
    assert.equal(result.ok, false);
    assert.ok(result.reason.includes('## Trade-offs'));
  });

  it('returns null for artifact without semantics', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'axc-wk-'));
    mkdirSync(join(tmp, '.planning'), { recursive: true });
    writeFileSync(join(tmp, '.planning/FOO.md'), 'content');
    const result = evaluateArtifactSemantics(tmp, {
      path: '.planning/FOO.md',
      semantics: null,
    });
    assert.equal(result, null);
  });

  it('returns null when file does not exist', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'axc-wk-'));
    const result = evaluateArtifactSemantics(tmp, {
      path: '.planning/MISSING.md',
      semantics: 'pm_signoff',
    });
    assert.equal(result, null);
  });

  it('evaluates pm_signoff via ID dispatch', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'axc-wk-'));
    mkdirSync(join(tmp, '.planning'), { recursive: true });
    writeFileSync(join(tmp, '.planning/PM_SIGNOFF.md'), 'Approved: YES\n');
    const result = evaluateArtifactSemantics(tmp, {
      path: '.planning/PM_SIGNOFF.md',
      semantics: 'pm_signoff',
    });
    assert.ok(result);
    assert.equal(result.ok, true);
  });

  it('evaluates pm_signoff failure via ID dispatch', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'axc-wk-'));
    mkdirSync(join(tmp, '.planning'), { recursive: true });
    writeFileSync(join(tmp, '.planning/PM_SIGNOFF.md'), 'Approved: NO\n');
    const result = evaluateArtifactSemantics(tmp, {
      path: '.planning/PM_SIGNOFF.md',
      semantics: 'pm_signoff',
    });
    assert.ok(result);
    assert.equal(result.ok, false);
  });
});
