import { strict as assert } from 'node:assert';
import { describe, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..', '..');

function read(relPath) {
  return readFileSync(join(REPO_ROOT, relPath), 'utf8');
}

const SIDEBAR = read('website-v2/sidebars.ts');
const AUTHORITY_MODEL = read('website-v2/docs/authority-model.mdx');
const RUNTIME_MATRIX = read('website-v2/docs/runtime-matrix.mdx');
const INTEGRATION_GUIDE = read('website-v2/docs/integration-guide.mdx');
const INTEGRATIONS_INDEX = read('website-v2/docs/integrations/index.mdx');
const CLAUDE_CODE = read('website-v2/docs/integrations/claude-code.mdx');
const CODEX = read('website-v2/docs/integrations/openai-codex-cli.mdx');
const CURSOR = read('website-v2/docs/integrations/cursor.mdx');
const VSCODE = read('website-v2/docs/integrations/vscode.mdx');
const WINDSURF = read('website-v2/docs/integrations/windsurf.mdx');
const OPENCLAW = read('website-v2/docs/integrations/openclaw.mdx');
const SPEC = read('.planning/AUTHORITY_MODEL_DOCS_SPEC.md');

describe('authority model docs contract', () => {
  it('publishes the authority-model page in the sidebar', () => {
    assert.match(SIDEBAR, /authority-model/);
  });

  it('documents all three authority axes', () => {
    assert.match(AUTHORITY_MODEL, /write_authority/);
    assert.match(AUTHORITY_MODEL, /runtime type/i);
    assert.match(AUTHORITY_MODEL, /sandbox\s*\/\s*approval mode|CLI sandbox/i);
  });

  it('documents the Claude Code and Codex local authority modes', () => {
    assert.match(AUTHORITY_MODEL, /dangerously-skip-permissions/);
    assert.match(AUTHORITY_MODEL, /dangerously-bypass-approvals-and-sandbox/);
  });

  it('calls out codex --full-auto as weaker than full authoritative unattended mode', () => {
    assert.match(AUTHORITY_MODEL, /--full-auto/);
    assert.match(AUTHORITY_MODEL, /not sufficient|not enough/i);
  });

  it('documents review_only + local_cli as invalid', () => {
    assert.match(AUTHORITY_MODEL, /review_only.*local_cli.*invalid|invalid.*review_only.*local_cli/is);
  });
});

describe('authority model cross-links', () => {
  for (const [name, content] of [
    ['runtime-matrix', RUNTIME_MATRIX],
    ['integration-guide', INTEGRATION_GUIDE],
    ['integrations-index', INTEGRATIONS_INDEX],
    ['claude-code', CLAUDE_CODE],
    ['openai-codex-cli', CODEX],
    ['cursor', CURSOR],
    ['vscode', VSCODE],
    ['windsurf', WINDSURF],
    ['openclaw', OPENCLAW],
  ]) {
    it(`${name} links to authority-model`, () => {
      assert.match(content, /\/docs\/authority-model|Authority Model/);
    });
  }
});

describe('local cli guide authority truth', () => {
  for (const [name, content] of [
    ['claude-code', CLAUDE_CODE],
    ['openai-codex-cli', CODEX],
    ['cursor', CURSOR],
    ['vscode', VSCODE],
    ['windsurf', WINDSURF],
    ['openclaw', OPENCLAW],
  ]) {
    it(`${name} uses write_authority in touched config examples`, () => {
      assert.match(content, /write_authority/);
      assert.doesNotMatch(content, /"authority":/);
    });
  }

  it('codex-family guides use the dangerous bypass flag instead of full-auto guidance', () => {
    for (const content of [CODEX, CURSOR, VSCODE, WINDSURF]) {
      assert.match(content, /dangerously-bypass-approvals-and-sandbox/);
      assert.doesNotMatch(content, /codex[^\n`]*--full-auto|approval-mode",\s*"full-auto"/);
    }
  });

  it('cursor guide keeps Cursor as editor-only, not a governed runtime', () => {
    assert.match(CURSOR, /editor, not the governed runtime/i);
    assert.match(CURSOR, /does not currently ship a native Cursor connector/i);
  });

  it('openclaw guide no longer shows review_only paired with local_cli', () => {
    const multiRoleSection = OPENCLAW.split('## Multi-role example')[1] || '';
    const exampleBlock = multiRoleSection.match(/```json[\s\S]*?```/)?.[0] || '';
    assert.match(exampleBlock, /"manual-review"/);
    assert.match(exampleBlock, /"reviewer":\s*\{[\s\S]*"runtime":\s*"manual-review"[\s\S]*"write_authority":\s*"review_only"/i);
    assert.match(OPENCLAW, /manual-review/);
  });
});

describe('authority model spec', () => {
  it('records purpose, behavior, and acceptance tests', () => {
    for (const section of [
      '## Purpose',
      '## Interface',
      '## Behavior',
      '## Error Cases',
      '## Acceptance Tests',
      '## Open Questions',
    ]) {
      assert.match(SPEC, new RegExp(section.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    }
  });
});
