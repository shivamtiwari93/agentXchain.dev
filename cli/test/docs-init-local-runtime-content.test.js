import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..', '..');
const read = (rel) => readFileSync(resolve(ROOT, rel), 'utf8');

describe('governed init local runtime docs contract', () => {
  const cliDocs = read('website-v2/docs/cli.mdx');
  const quickstartDocs = read('website-v2/docs/quickstart.mdx');
  const rootReadme = read('README.md');
  const cliReadme = read('cli/README.md');
  const cliEntry = read('cli/bin/agentxchain.js');

  it('CLI registers the governed init local runtime flags', () => {
    assert.match(cliEntry, /--dev-command <parts\.\.\.>/, 'CLI must register --dev-command');
    assert.match(cliEntry, /--dev-prompt-transport <mode>/, 'CLI must register --dev-prompt-transport');
  });

  it('CLI docs document the governed init local runtime flags', () => {
    assert.match(cliDocs, /`--dev-command <parts\.\.\.>`/, 'CLI docs must mention --dev-command');
    assert.match(cliDocs, /`--dev-prompt-transport <mode>`/, 'CLI docs must mention --dev-prompt-transport');
  });

  it('CLI docs document the prompt placeholder contract', () => {
    assert.match(cliDocs, /\{prompt\}/, 'CLI docs must mention the {prompt} placeholder');
    assert.match(cliDocs, /argv.*requires.*\{prompt\}|requires.*\{prompt\}.*argv/i,
      'CLI docs must explain that argv mode requires {prompt}');
    assert.match(cliDocs, /stdin.*must not include.*\{prompt\}|dispatch_bundle_only.*must not include.*\{prompt\}/i,
      'CLI docs must explain that non-argv modes must not include {prompt}');
  });

  it('quickstart documents the scaffold-time override path', () => {
    assert.match(quickstartDocs, /--dev-command/, 'quickstart must mention --dev-command');
    assert.match(quickstartDocs, /claude --print/, 'quickstart must state the default Claude command');
  });

  it('front-door READMEs mention the scaffold-time local runtime override', () => {
    assert.match(rootReadme, /--dev-command/, 'root README must mention --dev-command');
    assert.match(cliReadme, /--dev-command/, 'CLI README must mention --dev-command');
  });
});
