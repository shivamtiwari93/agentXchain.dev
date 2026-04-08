import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..', '..');

function read(relPath) {
  return readFileSync(join(REPO_ROOT, relPath), 'utf8');
}

function loadManifest(templateId) {
  return JSON.parse(read(`cli/src/templates/governed/${templateId}.json`));
}

const TEMPLATE_IDS = ['generic', 'api-service', 'cli-tool', 'library', 'web-app'];
const TEMPLATES_SPEC = read('.planning/TEMPLATES_DOC_PAGE_SPEC.md');
const TEMPLATES_DOC_SOURCE = read('website-v2/docs/templates.mdx');
const QUICKSTART_DOC_SOURCE = read('website-v2/docs/quickstart.mdx');
const CLI_DOC_SOURCE = read('website-v2/docs/cli.mdx');
const SIDEBARS = read('website-v2/sidebars.ts');
const CLI_BIN_SOURCE = read('cli/bin/agentxchain.js');
const TEMPLATE_LIST_SOURCE = read('cli/src/commands/template-list.js');
const TEMPLATE_SET_SOURCE = read('cli/src/commands/template-set.js');
const STATUS_SOURCE = read('cli/src/commands/status.js');
const GOVERNED_TEMPLATE_SOURCE = read('cli/src/lib/governed-templates.js');

describe('Templates docs surface', () => {
  it('ships the templates doc source and sidebar route', () => {
    assert.ok(existsSync(join(REPO_ROOT, 'website-v2', 'docs', 'templates.mdx')));
    assert.ok(SIDEBARS.includes("'templates'"), 'sidebars.ts must include the templates docs page');
  });

  it('documents the real template command surface', () => {
    for (const term of [
      'agentxchain init --governed --template <id>',
      'agentxchain template list',
      'agentxchain template list --json',
      'agentxchain template validate',
      'agentxchain template validate --json',
      'agentxchain template set <id> [--yes] [--dry-run]',
      'agentxchain status',
      'agentxchain status --json',
    ]) {
      assert.ok(TEMPLATES_DOC_SOURCE.includes(term), `templates docs must mention ${term}`);
    }
  });

  it('binds built-in template ids and planning artifacts to manifest truth', () => {
    for (const templateId of TEMPLATE_IDS) {
      assert.ok(TEMPLATES_DOC_SOURCE.includes(`\`${templateId}\``), `templates docs must mention template ${templateId}`);

      const manifest = loadManifest(templateId);
      for (const artifact of manifest.planning_artifacts || []) {
        assert.ok(
          TEMPLATES_DOC_SOURCE.includes(`\`${artifact.filename}\``),
          `templates docs must mention ${templateId} artifact ${artifact.filename}`
        );
      }
    }

    assert.ok(
      TEMPLATES_DOC_SOURCE.includes('No extra project-type files'),
      'templates docs must describe generic as adding no extra project-type files'
    );
  });

  it('describes additive template set semantics from the implementation', () => {
    assert.ok(TEMPLATE_SET_SOURCE.includes('config.template = templateId'));
    assert.ok(TEMPLATE_SET_SOURCE.includes('files_created'));
    assert.ok(TEMPLATE_SET_SOURCE.includes('prompts_appended'));
    assert.ok(TEMPLATE_SET_SOURCE.includes('acceptance_hints_status'));
    assert.ok(TEMPLATE_SET_SOURCE.includes('SYSTEM_SPEC_OVERLAY_SEPARATOR'));
    assert.ok(TEMPLATE_SET_SOURCE.includes("type: 'template_set'"));

    for (const term of [
      'scaffold intent',
      'agentxchain.json',
      'creates missing planning artifacts',
      'appends prompt guidance once',
      'appends acceptance hints once',
      'appends template-specific guidance to `SYSTEM_SPEC.md`',
      'decision-ledger.jsonl',
      'additive, not destructive',
      'overwrite existing planning docs',
      'delete old template files',
    ]) {
      assert.ok(TEMPLATES_DOC_SOURCE.includes(term), `templates docs must mention ${term}`);
    }
  });

  it('describes template list json shape honestly', () => {
    for (const term of [
      'display_name',
      'description',
      'workflow_kit',
      'planning artifact filenames',
      'roles with prompt overrides',
      'acceptance hints',
      'built-in registry',
      'current project template',
    ]) {
      assert.ok(TEMPLATES_DOC_SOURCE.includes(term), `templates docs must mention ${term}`);
    }

    for (const implementationTerm of [
      'display_name',
      'description',
      'planning_artifacts',
      'prompt_overrides',
      'acceptance_hints',
    ]) {
      assert.ok(
        TEMPLATE_LIST_SOURCE.includes(implementationTerm),
        `template-list implementation must expose ${implementationTerm}`
      );
    }
  });

  it('documents status visibility and binds it to the shipped status command', () => {
    assert.ok(STATUS_SOURCE.includes("template: config.template || 'generic'"));
    assert.ok(STATUS_SOURCE.includes("Template:')} ${config.template || 'generic'}"));
    assert.ok(TEMPLATES_DOC_SOURCE.includes('top-level `template`'));
    assert.ok(TEMPLATES_DOC_SOURCE.includes('`config.template`'));
  });

  it('does not fabricate template set flags or conflict semantics', () => {
    assert.ok(TEMPLATES_DOC_SOURCE.includes('--dry-run'), 'templates docs must mention the shipped --dry-run flag');
    assert.ok(TEMPLATES_DOC_SOURCE.includes('No changes written. Use without --dry-run to apply.'), 'templates docs must describe the dry-run no-write behavior');
    assert.ok(!TEMPLATES_DOC_SOURCE.includes('template set --force'), 'templates docs must not mention unshipped --force');
    assert.ok(!TEMPLATES_DOC_SOURCE.includes('conflict detection'), 'templates docs must not fabricate conflict detection');

    const templateSetSection = CLI_BIN_SOURCE.slice(
      CLI_BIN_SOURCE.indexOf(".command('template')"),
      CLI_BIN_SOURCE.indexOf(".command('multi')")
    );
    assert.ok(!templateSetSection.includes('--force'), 'template command surface must not expose --force');
  });

  it('keeps the spec aligned with the Docusaurus docs system and implementation sources', () => {
    for (const term of [
      '/docs/templates',
      'website-v2/docs/templates.mdx',
      'website-v2/build/docs/templates/index.html',
      'template list --json',
      'template validate --json',
      'WORKFLOW_KIT_VALIDATE_SPEC.md',
      'workflow_kit',
      'template set <id>',
      'status --json',
      'template_set',
      'template set --force',
    ]) {
      assert.ok(TEMPLATES_SPEC.includes(term), `templates spec must mention ${term}`);
    }

    assert.ok(!TEMPLATES_SPEC.includes('website/docs/templates.html'), 'templates spec must not point at retired static-site output');
  });

  it('keeps built-in template ids registered in source and manifests', () => {
    for (const templateId of TEMPLATE_IDS) {
      assert.ok(
        GOVERNED_TEMPLATE_SOURCE.includes(`'${templateId}'`),
        `governed template registry must include ${templateId}`
      );
      assert.ok(
        existsSync(join(REPO_ROOT, 'cli', 'src', 'templates', 'governed', `${templateId}.json`)),
        `manifest file for ${templateId} must exist`
      );
    }
  });

  it('is wired into the operator docs flow from quickstart and CLI docs', () => {
    assert.ok(QUICKSTART_DOC_SOURCE.includes('/docs/templates'), 'quickstart docs must link to /docs/templates');
    assert.ok(CLI_DOC_SOURCE.includes('/docs/templates'), 'cli docs must link to /docs/templates');
  });

  it('documents system_spec_overlay as part of template set behavior', () => {
    assert.ok(
      TEMPLATES_DOC_SOURCE.includes('system_spec_overlay'),
      'templates docs must mention system_spec_overlay'
    );
    assert.ok(
      TEMPLATES_DOC_SOURCE.includes('Template-Specific Guidance'),
      'templates docs must mention Template-Specific Guidance separator'
    );
    assert.ok(
      TEMPLATES_DOC_SOURCE.includes('Project-Type-Specific Guidance'),
      'templates docs must mention the prompt override separator'
    );
    assert.ok(
      TEMPLATES_DOC_SOURCE.includes('Template Guidance'),
      'templates docs must mention the acceptance-matrix guidance separator'
    );
  });

  it('documents workflow-kit proof as part of template validation', () => {
    for (const term of [
      'workflow kit',
      'Approved:',
      '## Phases',
      'SYSTEM_SPEC.md',
      '## Purpose',
      '## Interface',
      '## Acceptance Tests',
      '| Req # |',
      '## Verdict:',
      'workflow_kit',
    ]) {
      assert.ok(TEMPLATES_DOC_SOURCE.includes(term), `templates docs must mention ${term}`);
      assert.ok(CLI_DOC_SOURCE.includes(term), `cli docs must mention ${term}`);
    }
  });

  it('documents explicit workflow_kit custom artifact proof honestly', () => {
    for (const term of [
      'Explicit `workflow_kit` for custom phases',
      'section_check',
      'required_sections',
      'agentxchain init --governed --dir . -y',
      'workflow_kit: {}',
    ]) {
      assert.ok(TEMPLATES_DOC_SOURCE.includes(term), `templates docs must mention ${term}`);
    }

    for (const term of [
      'explicit `workflow_kit`',
      'operator-declared artifact proof',
      'workflow_kit: {}',
    ]) {
      assert.ok(TEMPLATES_SPEC.includes(term), `templates spec must mention ${term}`);
    }
  });
});
