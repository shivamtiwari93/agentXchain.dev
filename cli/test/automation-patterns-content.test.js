import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..', '..');
const AUTOMATION_PATTERNS = readFileSync(resolve(ROOT, 'website-v2/docs/automation-patterns.mdx'), 'utf8');
const SIDEBARS = readFileSync(resolve(ROOT, 'website-v2/sidebars.ts'), 'utf8');
const README = readFileSync(resolve(ROOT, 'README.md'), 'utf8');
const CLI_README = readFileSync(resolve(ROOT, 'cli/README.md'), 'utf8');
const GETTING_STARTED = readFileSync(resolve(ROOT, 'website-v2/docs/getting-started.mdx'), 'utf8');
const QUICKSTART = readFileSync(resolve(ROOT, 'website-v2/docs/quickstart.mdx'), 'utf8');

describe('automation patterns docs surface', () => {
  it('ships the docs page and sidebar registration', () => {
    assert.ok(existsSync(resolve(ROOT, 'website-v2/docs/automation-patterns.mdx')));
    assert.ok(SIDEBARS.includes("'automation-patterns'"));
  });

  it('documents the full-local-cli pattern with exact command shapes', () => {
    assert.match(AUTOMATION_PATTERNS, /all automated turns, human gate approvals only/i);
    assert.match(AUTOMATION_PATTERNS, /init --governed --template full-local-cli/);
    assert.match(AUTOMATION_PATTERNS, /claude --print --dangerously-skip-permissions/);
    assert.match(AUTOMATION_PATTERNS, /codex --quiet --dangerously-bypass-approvals-and-sandbox \{prompt\}/);
  });

  it('documents the inject-then-resume steering path', () => {
    assert.match(AUTOMATION_PATTERNS, /agentxchain inject/);
    assert.match(AUTOMATION_PATTERNS, /agentxchain resume --role pm/);
    assert.match(AUTOMATION_PATTERNS, /agentxchain step --resume/);
  });

  it('is linked from the front-door docs surfaces', () => {
    assert.match(README, /automation-patterns/);
    assert.match(CLI_README, /automation-patterns/);
    assert.match(GETTING_STARTED, /Automation Patterns/);
    assert.match(QUICKSTART, /Automation Patterns/);
  });
});
