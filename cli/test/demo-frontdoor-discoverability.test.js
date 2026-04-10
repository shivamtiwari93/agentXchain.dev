import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI_ROOT = join(__dirname, '..');
const REPO_ROOT = join(CLI_ROOT, '..');

const read = (rel) => readFileSync(join(REPO_ROOT, rel), 'utf8');

const ROOT_README = read('README.md');
const CLI_README = read('cli/README.md');
const QUICKSTART = read('website-v2/docs/quickstart.mdx');
const HOMEPAGE = read('website-v2/src/pages/index.tsx');
const SPEC = read('.planning/DEMO_FRONTDOOR_ADOPTION_SPEC.md');
const DEMO_CMD = 'npx --yes -p agentxchain@latest -c "agentxchain demo"';

describe('Demo front-door discoverability', () => {
  it('AT-DEMO-FD-001: root README exposes a Try It Now demo path', () => {
    assert.match(ROOT_README, /^## Try It Now$/m);
    assert.match(ROOT_README, new RegExp(DEMO_CMD.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    assert.match(ROOT_README, /No API keys, config edits, or manual turn authoring required/i);
  });

  it('AT-DEMO-FD-002: cli README exposes demo and lists it in governed commands', () => {
    assert.match(CLI_README, /^## Try It Now$/m);
    assert.match(CLI_README, new RegExp(DEMO_CMD.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    assert.match(CLI_README, /\| `demo` \| Run a temporary PM -> Dev -> QA governed lifecycle demo/i);
  });

  it('AT-DEMO-FD-003: quickstart adds Path 0 and keeps prerequisite claims honest', () => {
    assert.match(QUICKSTART, /^## Path 0: Demo$/m);
    assert.match(QUICKSTART, new RegExp(DEMO_CMD.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    assert.match(QUICKSTART, /\*\*git\*\*/);
    assert.match(QUICKSTART, /real runner interface/i);
    assert.match(QUICKSTART, /What it does \*\*not\*\* prove:/);
  });

  it('AT-DEMO-FD-004: homepage promotes demo first and keeps init as the next step', () => {
    assert.match(HOMEPAGE, /to="\/docs\/quickstart#path-0-demo"/);
    assert.match(HOMEPAGE, new RegExp(DEMO_CMD.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    assert.match(HOMEPAGE, />\s*npm install -g agentxchain\s*</);
    assert.match(HOMEPAGE, /See governance first, then scaffold your own repo/);
    assert.match(HOMEPAGE, /agentxchain init --governed/);
  });
});

describe('Demo front-door spec alignment', () => {
  it('ships a standalone spec with explicit acceptance tests', () => {
    assert.match(SPEC, /\*\*Status:\*\*\s+shipped/i);
    assert.match(SPEC, /AT-DEMO-FD-001/);
    assert.match(SPEC, /AT-DEMO-FD-004/);
    assert.match(SPEC, /Do not claim “zero prerequisites” or “Node\.js only”/);
  });
});
