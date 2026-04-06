import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..', '..');
const read = (rel) => readFileSync(resolve(ROOT, rel), 'utf8');

describe('multi-repo front-door discoverability', () => {
  const rootReadme = read('README.md');
  const cliReadme = read('cli/README.md');
  const landingPage = read('website-v2/src/pages/index.tsx');

  it('root README has a multi-repo quickstart section', () => {
    assert.match(rootReadme, /### Multi-repo coordination/,
      'root README must have a multi-repo coordination section');
  });

  it('root README links to the multi-repo quickstart docs', () => {
    assert.match(rootReadme, /multi-repo-cold-start/,
      'root README must link to the multi-repo quickstart anchor');
  });

  it('root README shows multi init command', () => {
    assert.match(rootReadme, /agentxchain multi init/,
      'root README multi-repo section must show the multi init command');
  });

  it('cli README has a multi-repo quickstart section', () => {
    assert.match(cliReadme, /### Multi-repo coordination/,
      'cli README must have a multi-repo coordination section');
  });

  it('cli README links to the multi-repo quickstart docs', () => {
    assert.match(cliReadme, /multi-repo-cold-start/,
      'cli README must link to the multi-repo quickstart anchor');
  });

  it('landing page links to multi-repo quickstart', () => {
    assert.match(landingPage, /multi-repo-cold-start/,
      'landing page must link to the multi-repo quickstart anchor');
  });
});
