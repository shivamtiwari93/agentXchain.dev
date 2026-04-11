import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { execSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';

const ROOT = resolve(import.meta.dirname, '..', '..');
const read = (rel) => readFileSync(resolve(ROOT, rel), 'utf8');
const CLI = resolve(ROOT, 'cli', 'bin', 'agentxchain.js');

const GETTING_STARTED = read('website-v2/docs/getting-started.mdx');
const QUICKSTART = read('website-v2/docs/quickstart.mdx');
const README = read('README.md');

describe('project goal front-door discoverability (AT-PGD-003 through AT-PGD-005)', () => {
  it('AT-PGD-003: getting-started.mdx mentions --goal or project.goal', () => {
    const hasGoal = /--goal/.test(GETTING_STARTED) || /project\.goal/.test(GETTING_STARTED);
    assert.ok(hasGoal, 'getting-started.mdx must mention --goal or project.goal for discoverability');
  });

  it('AT-PGD-004: quickstart.mdx mentions --goal or project.goal', () => {
    const hasGoal = /--goal/.test(QUICKSTART) || /project\.goal/.test(QUICKSTART);
    assert.ok(hasGoal, 'quickstart.mdx must mention --goal or project.goal for discoverability');
  });

  it('AT-PGD-005: README.md mentions --goal or project.goal', () => {
    const hasGoal = /--goal/.test(README) || /project\.goal/.test(README);
    assert.ok(hasGoal, 'README.md must mention --goal or project.goal for discoverability');
  });
});

describe('project goal init output discoverability (AT-PGD-001 and AT-PGD-002)', () => {
  it('AT-PGD-001: init --governed without --goal prints a --goal tip', () => {
    const tmp = mkdtempSync(resolve(tmpdir(), 'pgd-001-'));
    const out = execSync(
      `node "${CLI}" init --governed --dir "${tmp}" -y`,
      { encoding: 'utf8', timeout: 15000 }
    ).toString();
    assert.match(out, /--goal/, 'init output without --goal must print a --goal tip');
  });

  it('AT-PGD-002: init --governed --goal "..." does not print the --goal tip', () => {
    const tmp = mkdtempSync(resolve(tmpdir(), 'pgd-002-'));
    const out = execSync(
      `node "${CLI}" init --governed --goal "Test mission" --dir "${tmp}" -y`,
      { encoding: 'utf8', timeout: 15000 }
    ).toString();
    // The tip line contains "Add a project goal" — should not be present when goal is set
    assert.ok(
      !/Add a project goal/.test(out),
      'init output with --goal set must not print the --goal tip'
    );
  });
});
