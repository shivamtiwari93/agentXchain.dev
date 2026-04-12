import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..', '..');

function read(relPath) {
  return readFileSync(join(REPO_ROOT, relPath), 'utf8');
}

const TUTORIAL = read('website-v2/docs/tutorial.mdx');
const FIRST_TURN = read('website-v2/docs/first-turn.mdx');
const TEMPLATES = read('website-v2/docs/templates.mdx');
const ADAPTERS = read('website-v2/docs/adapters.mdx');

describe('tutorial pages governed bootstrap contract (DEC-DOCS-CONFIG-SET-004)', () => {
  it('AT-TGB-001: tutorial.mdx scaffold includes --goal', () => {
    assert.match(TUTORIAL, /init --governed[\s\S]{0,120}--goal/, 'tutorial must show --goal in scaffold command');
  });

  it('AT-TGB-002: tutorial.mdx includes doctor after scaffold', () => {
    assert.match(TUTORIAL, /agentxchain doctor/, 'tutorial must include doctor readiness check');
  });

  it('AT-TGB-003: first-turn.mdx scaffold includes --goal', () => {
    assert.match(FIRST_TURN, /init --governed[\s\S]{0,120}--goal/, 'first-turn must show --goal in scaffold command');
  });

  it('AT-TGB-004: first-turn.mdx includes doctor after scaffold', () => {
    assert.match(FIRST_TURN, /agentxchain doctor/, 'first-turn must include doctor readiness check');
  });

  it('AT-TGB-005: templates.mdx primary scaffold examples include --goal', () => {
    const webAppMatch = TEMPLATES.match(/init --governed --template web-app[\s\S]{0,120}--goal/);
    assert.ok(webAppMatch, 'templates web-app example must show --goal');
    const enterpriseMatch = TEMPLATES.match(/init --governed --template enterprise-app[\s\S]{0,120}--goal/);
    assert.ok(enterpriseMatch, 'templates enterprise-app example must show --goal');
  });

  it('AT-TGB-006: adapters.mdx notes the governed bootstrap path for abbreviated examples', () => {
    assert.match(ADAPTERS, /Getting Started/, 'adapters must reference Getting Started for the full governed path');
  });
});
