import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { mkdtempSync, writeFileSync, mkdirSync, existsSync, readFileSync } from 'node:fs';
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
import { validateGovernedWorkflowKit } from '../src/lib/governed-templates.js';
import { scaffoldGoverned } from '../src/commands/init.js';

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
    assert.equal(normalized.workflow_kit.phases.planning.artifacts[0].owned_by, null);
    assert.equal(normalized.workflow_kit.phases.qa, undefined);
  });

  it('preserves owned_by during workflow_kit normalization', () => {
    const raw = baseConfig({
      roles: {
        architect: {
          title: 'Architect',
          mandate: 'Define architecture.',
          write_authority: 'review_only',
          runtime: 'manual-architect',
        },
      },
      runtimes: {
        'manual-architect': { type: 'manual' },
      },
      routing: {
        architecture: {
          entry_role: 'architect',
          allowed_next_roles: ['architect'],
          exit_gate: 'architecture_review',
        },
      },
      gates: {
        architecture_review: {
          requires_files: ['.planning/ARCHITECTURE.md'],
        },
      },
      workflow_kit: {
        phases: {
          architecture: {
            artifacts: [
              { path: '.planning/ARCHITECTURE.md', owned_by: 'architect', required: true },
            ],
          },
        },
      },
    });

    const normalized = normalizeV4(raw);
    assert.equal(normalized.workflow_kit.phases.architecture.artifacts[0].owned_by, 'architect');
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

// --- Slice 3: Template Validate Integration ---

describe('validateGovernedWorkflowKit — template validate integration', () => {
  it('AT-WKC-030: explicit workflow_kit reflects declared artifacts in required_files', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'axc-wk-'));
    mkdirSync(join(tmp, '.planning'), { recursive: true });
    writeFileSync(join(tmp, '.planning/DESIGN_DOC.md'), '# Design\n\n## Architecture\n\nContent\n');
    writeFileSync(join(tmp, '.planning/SECURITY_REVIEW.md'), '# Security\n');

    const config = {
      workflow_kit: {
        _explicit: true,
        phases: {
          design: {
            artifacts: [
              { path: '.planning/DESIGN_DOC.md', semantics: 'section_check', semantics_config: { required_sections: ['## Architecture'] }, required: true },
              { path: '.planning/SECURITY_REVIEW.md', semantics: null, required: true },
            ],
          },
        },
      },
    };

    const result = validateGovernedWorkflowKit(tmp, config);
    assert.ok(result.required_files.includes('.planning/DESIGN_DOC.md'), 'should include DESIGN_DOC.md');
    assert.ok(result.required_files.includes('.planning/SECURITY_REVIEW.md'), 'should include SECURITY_REVIEW.md');
    // Should NOT include default base files when explicit workflow_kit is present
    assert.ok(!result.required_files.includes('.planning/PM_SIGNOFF.md'), 'should not include default PM_SIGNOFF.md');
  });

  it('AT-WKC-031: explicit workflow_kit generates structural_checks from semantics declarations', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'axc-wk-'));
    mkdirSync(join(tmp, '.planning'), { recursive: true });
    writeFileSync(join(tmp, '.planning/DESIGN_DOC.md'), '# Design\n\n## Architecture\n\nContent\n\n## Trade-offs\n\nMore\n');

    const config = {
      workflow_kit: {
        _explicit: true,
        phases: {
          design: {
            artifacts: [
              {
                path: '.planning/DESIGN_DOC.md',
                semantics: 'section_check',
                semantics_config: { required_sections: ['## Architecture', '## Trade-offs'] },
                required: true,
              },
            ],
          },
        },
      },
    };

    const result = validateGovernedWorkflowKit(tmp, config);
    assert.ok(result.ok, `Unexpected errors: ${result.errors.join(', ')}`);
    assert.ok(result.structural_checks.length >= 2, `Expected at least 2 structural checks, got ${result.structural_checks.length}`);
    const archCheck = result.structural_checks.find(c => c.description.includes('## Architecture'));
    assert.ok(archCheck, 'should have structural check for ## Architecture');
    assert.equal(archCheck.ok, true);
    const tradeoffsCheck = result.structural_checks.find(c => c.description.includes('## Trade-offs'));
    assert.ok(tradeoffsCheck, 'should have structural check for ## Trade-offs');
    assert.equal(tradeoffsCheck.ok, true);
  });

  it('AT-WKC-031b: section_check structural_checks fail when section missing', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'axc-wk-'));
    mkdirSync(join(tmp, '.planning'), { recursive: true });
    writeFileSync(join(tmp, '.planning/DESIGN_DOC.md'), '# Design\n\n## Architecture\n\nContent\n');

    const config = {
      workflow_kit: {
        _explicit: true,
        phases: {
          design: {
            artifacts: [
              {
                path: '.planning/DESIGN_DOC.md',
                semantics: 'section_check',
                semantics_config: { required_sections: ['## Architecture', '## Missing Section'] },
                required: true,
              },
            ],
          },
        },
      },
    };

    const result = validateGovernedWorkflowKit(tmp, config);
    assert.equal(result.ok, false);
    const failedCheck = result.structural_checks.find(c => c.description.includes('## Missing Section'));
    assert.ok(failedCheck, 'should have structural check for ## Missing Section');
    assert.equal(failedCheck.ok, false);
  });

  it('AT-WKC-032: without workflow_kit produces identical output to default behavior', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'axc-wk-'));
    mkdirSync(join(tmp, '.planning'), { recursive: true });
    writeFileSync(join(tmp, '.planning/PM_SIGNOFF.md'), 'Approved: YES\n');
    writeFileSync(join(tmp, '.planning/ROADMAP.md'), '# Roadmap\n\n## Phases\n\n| Phase |\n');
    writeFileSync(join(tmp, '.planning/SYSTEM_SPEC.md'), '# Spec\n\n## Purpose\n\nFoo\n\n## Interface\n\nBar\n\n## Acceptance Tests\n\nBaz\n');
    writeFileSync(join(tmp, '.planning/acceptance-matrix.md'), '| Req # | foo |\n');
    writeFileSync(join(tmp, '.planning/ship-verdict.md'), '## Verdict: YES\n');

    const resultNoWk = validateGovernedWorkflowKit(tmp, {});
    const resultUndefined = validateGovernedWorkflowKit(tmp);

    // Both should use the default base files
    assert.deepStrictEqual(resultNoWk.required_files, resultUndefined.required_files);
    assert.ok(resultNoWk.required_files.includes('.planning/PM_SIGNOFF.md'));
    assert.ok(resultNoWk.structural_checks.length > 0, 'should have hardcoded structural checks');
  });

  it('AT-WKC-032b: explicit empty workflow_kit opts out of default scaffold proof', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'axc-wk-'));
    mkdirSync(join(tmp, '.planning'), { recursive: true });

    const result = validateGovernedWorkflowKit(tmp, {
      workflow_kit: { _explicit: true, phases: {} },
    });

    assert.equal(result.ok, true, `Unexpected errors: ${result.errors.join(', ')}`);
    assert.deepEqual(result.required_files, [], 'explicit empty workflow_kit should not reintroduce default files');
    assert.deepEqual(result.structural_checks, [], 'explicit empty workflow_kit should not run default structural checks');
  });

  it('structural_checks for built-in semantics like pm_signoff in explicit workflow_kit', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'axc-wk-'));
    mkdirSync(join(tmp, '.planning'), { recursive: true });
    writeFileSync(join(tmp, '.planning/PM_SIGNOFF.md'), 'Approved: YES\n');

    const config = {
      workflow_kit: {
        _explicit: true,
        phases: {
          planning: {
            artifacts: [
              { path: '.planning/PM_SIGNOFF.md', semantics: 'pm_signoff', required: true },
            ],
          },
        },
      },
    };

    const result = validateGovernedWorkflowKit(tmp, config);
    assert.ok(result.ok, `Unexpected errors: ${result.errors.join(', ')}`);
    const pmCheck = result.structural_checks.find(c => c.file === '.planning/PM_SIGNOFF.md');
    assert.ok(pmCheck, 'should have structural check for PM_SIGNOFF.md');
    assert.equal(pmCheck.ok, true);
  });
});

// --- Slice 3: Scaffold (governed init) ---

describe('scaffoldGoverned — workflow_kit artifact scaffold', () => {
  it('AT-WKC-040: scaffolds declared workflow_kit artifacts with placeholder content', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'axc-wk-'));
    const workflowKit = {
      phases: {
        design: {
          artifacts: [
            {
              path: '.planning/DESIGN_DOC.md',
              semantics: 'section_check',
              semantics_config: { required_sections: ['## Architecture', '## Interfaces'] },
              required: true,
            },
            {
              path: '.planning/SECURITY_REVIEW.md',
              semantics: null,
              required: true,
            },
          ],
        },
      },
    };

    scaffoldGoverned(tmp, 'Test Project', 'test-project', 'generic', {}, workflowKit);

    // Custom artifacts should exist
    assert.ok(existsSync(join(tmp, '.planning/DESIGN_DOC.md')), 'DESIGN_DOC.md should be scaffolded');
    assert.ok(existsSync(join(tmp, '.planning/SECURITY_REVIEW.md')), 'SECURITY_REVIEW.md should be scaffolded');

    // section_check artifact should have required sections pre-filled
    const designContent = readFileSync(join(tmp, '.planning/DESIGN_DOC.md'), 'utf8');
    assert.ok(designContent.includes('## Architecture'), 'should contain ## Architecture');
    assert.ok(designContent.includes('## Interfaces'), 'should contain ## Interfaces');

    // No-semantics artifact should have generic placeholder
    const securityContent = readFileSync(join(tmp, '.planning/SECURITY_REVIEW.md'), 'utf8');
    assert.ok(securityContent.includes('Operator fills this in'), 'should have generic placeholder');
  });

  it('AT-WKC-041: without workflow_kit scaffolds default 5+ files unchanged', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'axc-wk-'));
    scaffoldGoverned(tmp, 'Default Project', 'default-project', 'generic', {});

    // Default files should exist
    assert.ok(existsSync(join(tmp, '.planning/PM_SIGNOFF.md')));
    assert.ok(existsSync(join(tmp, '.planning/ROADMAP.md')));
    assert.ok(existsSync(join(tmp, '.planning/SYSTEM_SPEC.md')));
    assert.ok(existsSync(join(tmp, '.planning/IMPLEMENTATION_NOTES.md')));
    assert.ok(existsSync(join(tmp, '.planning/acceptance-matrix.md')));
    assert.ok(existsSync(join(tmp, '.planning/ship-verdict.md')));
    assert.ok(existsSync(join(tmp, '.planning/RELEASE_NOTES.md')));

    // No custom artifacts should exist
    assert.ok(!existsSync(join(tmp, '.planning/DESIGN_DOC.md')), 'should not scaffold custom artifacts without workflow_kit');
  });

  it('AT-WKC-040b: does not re-scaffold default files via workflow_kit', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'axc-wk-'));
    const workflowKit = {
      phases: {
        planning: {
          artifacts: [
            { path: '.planning/PM_SIGNOFF.md', semantics: 'pm_signoff', required: true },
          ],
        },
        design: {
          artifacts: [
            { path: '.planning/CUSTOM.md', semantics: null, required: true },
          ],
        },
      },
    };

    scaffoldGoverned(tmp, 'Test', 'test', 'generic', {}, workflowKit);

    // Default PM_SIGNOFF.md should have the standard scaffold content, not the workflow_kit placeholder
    const pmContent = readFileSync(join(tmp, '.planning/PM_SIGNOFF.md'), 'utf8');
    assert.ok(pmContent.includes('Approved: NO'), 'PM_SIGNOFF.md should have standard scaffold content');
    assert.ok(!pmContent.includes('Operator fills this in'), 'PM_SIGNOFF.md should not have workflow_kit placeholder');

    // Custom artifact should be scaffolded
    assert.ok(existsSync(join(tmp, '.planning/CUSTOM.md')));
  });

  it('AT-WKC-040c: scaffolds artifacts in subdirectories', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'axc-wk-'));
    const workflowKit = {
      phases: {
        design: {
          artifacts: [
            { path: '.planning/reviews/design-review.md', semantics: null, required: true },
          ],
        },
      },
    };

    scaffoldGoverned(tmp, 'Test', 'test', 'generic', {}, workflowKit);

    assert.ok(existsSync(join(tmp, '.planning/reviews/design-review.md')), 'should create subdirectories as needed');
  });
});

// --- Charter enforcement: owned_by validation ---

describe('validateWorkflowKitConfig — owned_by (charter enforcement)', () => {
  const roles = {
    dev: { title: 'Dev', mandate: 'Build', write_authority: 'authoritative', runtime: 'r1' },
    security_reviewer: { title: 'Security', mandate: 'Review security', write_authority: 'review_only', runtime: 'r1' },
    architect: { title: 'Architect', mandate: 'Design', write_authority: 'review_only', runtime: 'r1' },
  };

  it('AT-CHARTER-001: valid owned_by referencing existing role passes', () => {
    const result = validateWorkflowKitConfig({
      phases: {
        planning: {
          artifacts: [
            { path: '.planning/SECURITY_REVIEW.md', owned_by: 'security_reviewer', required: true },
          ],
        },
      },
    }, { planning: {} }, roles);
    assert.equal(result.ok, true, `Unexpected errors: ${result.errors.join(', ')}`);
  });

  it('AT-CHARTER-002: owned_by referencing nonexistent role fails', () => {
    const result = validateWorkflowKitConfig({
      phases: {
        planning: {
          artifacts: [
            { path: '.planning/REVIEW.md', owned_by: 'nonexistent_role', required: true },
          ],
        },
      },
    }, { planning: {} }, roles);
    assert.equal(result.ok, false);
    assert.ok(result.errors.some(e => e.includes('nonexistent_role') && e.includes('does not reference a defined role')));
  });

  it('AT-CHARTER-003: owned_by with invalid format fails', () => {
    const result = validateWorkflowKitConfig({
      phases: {
        planning: {
          artifacts: [
            { path: '.planning/REVIEW.md', owned_by: 'Invalid Role!', required: true },
          ],
        },
      },
    }, { planning: {} }, roles);
    assert.equal(result.ok, false);
    assert.ok(result.errors.some(e => e.includes('Invalid Role!') && e.includes('not a valid role ID')));
  });

  it('AT-CHARTER-004: no owned_by passes (backward compatible)', () => {
    const result = validateWorkflowKitConfig({
      phases: {
        planning: {
          artifacts: [
            { path: '.planning/ROADMAP.md', required: true },
          ],
        },
      },
    }, { planning: {} }, roles);
    assert.equal(result.ok, true, `Unexpected errors: ${result.errors.join(', ')}`);
  });

  it('AT-CHARTER-005: multiple artifacts with different owned_by all validated', () => {
    const result = validateWorkflowKitConfig({
      phases: {
        planning: {
          artifacts: [
            { path: '.planning/ARCHITECTURE.md', owned_by: 'architect', required: true },
            { path: '.planning/SECURITY_REVIEW.md', owned_by: 'security_reviewer', required: true },
          ],
        },
      },
    }, { planning: {} }, roles);
    assert.equal(result.ok, true, `Unexpected errors: ${result.errors.join(', ')}`);
  });

  it('AT-CHARTER-005b: mixed valid and invalid owned_by reports errors', () => {
    const result = validateWorkflowKitConfig({
      phases: {
        planning: {
          artifacts: [
            { path: '.planning/ARCHITECTURE.md', owned_by: 'architect', required: true },
            { path: '.planning/REVIEW.md', owned_by: 'ghost_role', required: true },
          ],
        },
      },
    }, { planning: {} }, roles);
    assert.equal(result.ok, false);
    assert.ok(result.errors.some(e => e.includes('ghost_role')));
    assert.ok(!result.errors.some(e => e.includes('architect')));
  });

  it('AT-CHARTER-006: owned_by validation works without roles param', () => {
    // When roles is not provided, format validation still applies but role existence is not checked
    const result = validateWorkflowKitConfig({
      phases: {
        planning: {
          artifacts: [
            { path: '.planning/REVIEW.md', owned_by: 'any_role', required: true },
          ],
        },
      },
    }, { planning: {} });
    assert.equal(result.ok, true, 'Format-valid owned_by should pass without roles');
  });
});
