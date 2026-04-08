import { describe, it } from 'node:test';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..');
const PLANNING = join(ROOT, '.planning');
const GOVERNED_TEMPLATES_DIR = join(ROOT, 'cli', 'src', 'templates', 'governed');

const TEMPLATE_INIT_SPEC = readFileSync(join(PLANNING, 'TEMPLATE_INIT_IMPL_SPEC.md'), 'utf8');
const SDLC_SPEC = readFileSync(join(PLANNING, 'SDLC_TEMPLATE_SYSTEM_SPEC.md'), 'utf8');
const CLI_SPEC = readFileSync(join(PLANNING, 'CLI_SPEC.md'), 'utf8');
const ROADMAP = readFileSync(join(PLANNING, 'POST_V1_ROADMAP.md'), 'utf8');

// Canonical template IDs defined in the implementation spec
const CANONICAL_TEMPLATE_IDS = ['generic', 'api-service', 'cli-tool', 'library', 'web-app', 'enterprise-app'];

describe('Template spec consistency', () => {

  it('TEMPLATE_INIT_IMPL_SPEC lists all canonical template IDs', () => {
    for (const id of CANONICAL_TEMPLATE_IDS) {
      assert.ok(
        TEMPLATE_INIT_SPEC.includes(id),
        `TEMPLATE_INIT_IMPL_SPEC.md must mention template id "${id}"`
      );
      assert.ok(
        existsSync(join(GOVERNED_TEMPLATES_DIR, `${id}.json`)),
        `Governed template manifest ${id}.json must exist on disk`
      );
    }
  });

  it('SDLC_TEMPLATE_SYSTEM_SPEC lists all canonical template IDs', () => {
    for (const id of CANONICAL_TEMPLATE_IDS) {
      assert.ok(
        SDLC_SPEC.includes(id),
        `SDLC_TEMPLATE_SYSTEM_SPEC.md must mention template id "${id}"`
      );
    }
    assert.ok(SDLC_SPEC.includes('prompt_overrides'), 'SDLC spec must document prompt_overrides');
    assert.ok(SDLC_SPEC.includes('acceptance_hints'), 'SDLC spec must document acceptance_hints');
    assert.ok(!SDLC_SPEC.includes('"files": []'), 'SDLC spec must not retain the obsolete files[] manifest field');
    assert.ok(!SDLC_SPEC.includes('"prompts": []'), 'SDLC spec must not retain the obsolete prompts[] manifest field');
  });

  it('CLI_SPEC references the --template flag in init signature', () => {
    assert.ok(
      CLI_SPEC.includes('--template <id>'),
      'CLI_SPEC.md must document --template <id> in the init command signature'
    );
  });

  it('CLI_SPEC references template field in agentxchain.json', () => {
    assert.ok(
      CLI_SPEC.includes('"template"'),
      'CLI_SPEC.md must mention the "template" field being written to agentxchain.json'
    );
  });

  it('CLI_SPEC links to TEMPLATE_INIT_IMPL_SPEC', () => {
    assert.ok(
      CLI_SPEC.includes('TEMPLATE_INIT_IMPL_SPEC'),
      'CLI_SPEC.md must reference TEMPLATE_INIT_IMPL_SPEC.md for the full implementation contract'
    );
  });

  it('TEMPLATE_INIT_IMPL_SPEC records template choice in agentxchain.json, not state.json', () => {
    assert.ok(
      TEMPLATE_INIT_SPEC.includes('agentxchain.json'),
      'Template choice must be recorded in agentxchain.json'
    );
    assert.ok(
      TEMPLATE_INIT_SPEC.includes('not run state'),
      'Spec must explicitly state template is not run state'
    );
  });

  it('TEMPLATE_INIT_IMPL_SPEC documents failure for unknown template ID', () => {
    assert.ok(
      TEMPLATE_INIT_SPEC.includes('Unknown template'),
      'Spec must document the error message for unknown template IDs'
    );
    assert.ok(
      TEMPLATE_INIT_SPEC.includes('Exit code: 1'),
      'Spec must document exit code 1 for unknown template'
    );
  });

  it('TEMPLATE_INIT_IMPL_SPEC defines template manifest location', () => {
    assert.ok(
      TEMPLATE_INIT_SPEC.includes('templates/governed/'),
      'Spec must define the governed templates directory path'
    );
    assert.ok(TEMPLATE_INIT_SPEC.includes('prompt_overrides'));
    assert.ok(TEMPLATE_INIT_SPEC.includes('acceptance_hints'));
  });

  it('SDLC_TEMPLATE_SYSTEM_SPEC acceptance tests are numbered AT-SDLC-TEMPLATE-*', () => {
    const atMatches = SDLC_SPEC.match(/AT-SDLC-TEMPLATE-\d+/g);
    assert.ok(atMatches, 'SDLC spec must have AT-SDLC-TEMPLATE-* acceptance tests');
    assert.ok(atMatches.length >= 6, `Expected at least 6 acceptance tests, found ${atMatches.length}`);
  });

  it('TEMPLATE_INIT_IMPL_SPEC acceptance tests are numbered AT-TEMPLATE-INIT-*', () => {
    const atMatches = TEMPLATE_INIT_SPEC.match(/AT-TEMPLATE-INIT-\d+/g);
    assert.ok(atMatches, 'Implementation spec must have AT-TEMPLATE-INIT-* acceptance tests');
    assert.ok(atMatches.length >= 8, `Expected at least 8 acceptance tests, found ${atMatches.length}`);
  });

  it('both specs agree that generic is the default template', () => {
    assert.ok(
      SDLC_SPEC.includes('generic') && SDLC_SPEC.includes('default'),
      'SDLC spec must identify generic as the default'
    );
    assert.ok(
      TEMPLATE_INIT_SPEC.includes("templateId = 'generic'") || TEMPLATE_INIT_SPEC.includes('defaults to `generic`'),
      'Implementation spec must default to generic'
    );
  });

  it('roadmap names the future template annotation command', () => {
    assert.ok(
      ROADMAP.includes('agentxchain template set <id>'),
      'POST_V1_ROADMAP.md must name the post-init template annotation command'
    );
  });
});

describe('Template spec — no drift from SDLC planning artifacts', () => {
  // Ensure the implementation spec mentions all template-specific planning artifacts
  // that the SDLC spec promised

  const API_SERVICE_ARTIFACTS = ['api-contract.md', 'operational-readiness.md', 'error-budget.md'];
  const CLI_TOOL_ARTIFACTS = ['command-surface.md', 'platform-support.md', 'distribution-checklist.md'];
  const LIBRARY_ARTIFACTS = ['public-api.md', 'compatibility-policy.md', 'release-adoption.md'];
  const WEB_APP_ARTIFACTS = ['user-flows.md', 'ui-acceptance.md', 'browser-support.md'];
  const ENTERPRISE_APP_ARTIFACTS = ['integration-boundaries.md', 'data-classification.md', 'risk-register.md'];

  for (const artifact of API_SERVICE_ARTIFACTS) {
    it(`api-service planning artifact "${artifact}" is mentioned in SDLC spec`, () => {
      assert.ok(SDLC_SPEC.includes(artifact), `SDLC spec must mention ${artifact}`);
    });
  }

  for (const artifact of CLI_TOOL_ARTIFACTS) {
    it(`cli-tool planning artifact "${artifact}" is mentioned in SDLC spec`, () => {
      assert.ok(SDLC_SPEC.includes(artifact), `SDLC spec must mention ${artifact}`);
    });
  }

  for (const artifact of LIBRARY_ARTIFACTS) {
    it(`library planning artifact "${artifact}" is mentioned in SDLC spec`, () => {
      assert.ok(SDLC_SPEC.includes(artifact), `SDLC spec must mention ${artifact}`);
    });
  }

  for (const artifact of WEB_APP_ARTIFACTS) {
    it(`web-app planning artifact "${artifact}" is mentioned in SDLC spec`, () => {
      assert.ok(SDLC_SPEC.includes(artifact), `SDLC spec must mention ${artifact}`);
    });
  }

  for (const artifact of ENTERPRISE_APP_ARTIFACTS) {
    it(`enterprise-app planning artifact "${artifact}" is mentioned in SDLC spec`, () => {
      assert.ok(SDLC_SPEC.includes(artifact), `SDLC spec must mention ${artifact}`);
    });
  }

  it('implementation spec mentions api-service artifacts in AT-TEMPLATE-INIT-002', () => {
    for (const artifact of API_SERVICE_ARTIFACTS) {
      assert.ok(
        TEMPLATE_INIT_SPEC.includes(artifact),
        `Implementation spec AT-TEMPLATE-INIT-002 must verify ${artifact}`
      );
    }
  });

  it('implementation spec mentions library artifacts in AT-TEMPLATE-INIT-002b', () => {
    for (const artifact of LIBRARY_ARTIFACTS) {
      assert.ok(
        TEMPLATE_INIT_SPEC.includes(artifact),
        `Implementation spec AT-TEMPLATE-INIT-002b must verify ${artifact}`
      );
    }
  });

  it('implementation spec mentions enterprise-app blueprint in AT-TEMPLATE-INIT-002c', () => {
    for (const term of ['enterprise-app', 'architect', 'security_reviewer', 'workflow_kit']) {
      assert.ok(
        TEMPLATE_INIT_SPEC.includes(term),
        `Implementation spec AT-TEMPLATE-INIT-002c must verify ${term}`
      );
    }
  });
});
