import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI_ROOT = join(__dirname, '..');
const REPO_ROOT = join(CLI_ROOT, '..');

const ROOT_README = readFileSync(join(REPO_ROOT, 'README.md'), 'utf8');
const CLI_README = readFileSync(join(CLI_ROOT, 'README.md'), 'utf8');
const QUICKSTART = readFileSync(
  join(REPO_ROOT, 'website-v2', 'docs', 'quickstart.mdx'),
  'utf8',
);
const MULTI_REPO = readFileSync(
  join(REPO_ROOT, 'website-v2', 'docs', 'multi-repo.mdx'),
  'utf8',
);

// Code-backed: read the shipped intake command surface from intake.js
const INTAKE_SRC = readFileSync(
  join(CLI_ROOT, 'src', 'lib', 'intake.js'),
  'utf8',
);
// Code-backed: read the shipped handoff artifact path from intake-handoff.js
const HANDOFF_SRC = readFileSync(
  join(CLI_ROOT, 'src', 'lib', 'intake-handoff.js'),
  'utf8',
);

describe('Intake handoff discoverability', () => {
  // Root README
  it('AT-HANDOFF-DISC-001: root README mentions intake command family', () => {
    assert.match(
      ROOT_README,
      /intake record/,
      'root README must mention intake record',
    );
    assert.match(
      ROOT_README,
      /intake handoff/,
      'root README must mention intake handoff',
    );
  });

  it('AT-HANDOFF-DISC-002: root README links to continuous-delivery-intake docs', () => {
    assert.match(
      ROOT_README,
      /continuous-delivery-intake/,
      'root README must link to continuous-delivery-intake deep-dive',
    );
  });

  // CLI README
  it('AT-HANDOFF-DISC-003: cli README command table includes intake and handoff', () => {
    assert.match(
      CLI_README,
      /intake.*handoff/s,
      'cli README must mention intake handoff in command table',
    );
    assert.match(
      CLI_README,
      /coordinator workstream/,
      'cli README must describe handoff as bridging to coordinator workstream',
    );
  });

  // Quickstart
  it('AT-HANDOFF-DISC-004: quickstart mentions intake and links to deep-dive', () => {
    assert.match(
      QUICKSTART,
      /intake/i,
      'quickstart must mention intake',
    );
    assert.match(
      QUICKSTART,
      /continuous-delivery-intake/,
      'quickstart must link to continuous-delivery-intake',
    );
  });

  it('AT-HANDOFF-DISC-005: quickstart mentions intake handoff for multi-repo', () => {
    assert.match(
      QUICKSTART,
      /intake handoff/,
      'quickstart must mention intake handoff as the multi-repo bridge',
    );
  });

  // Multi-repo docs
  it('AT-HANDOFF-DISC-006: multi-repo docs include intake handoff section', () => {
    assert.match(
      MULTI_REPO,
      /## Intake Handoff/,
      'multi-repo.mdx must have an Intake Handoff section',
    );
    assert.match(
      MULTI_REPO,
      /intake handoff/,
      'multi-repo.mdx must reference the intake handoff command',
    );
  });

  it('AT-HANDOFF-DISC-007: multi-repo docs describe handoff artifact location', () => {
    // Code-backed: the HANDOFF_DIR constant in intake-handoff.js
    assert.match(
      HANDOFF_SRC,
      /\.agentxchain\/multirepo\/handoffs/,
      'intake-handoff.js must define the handoff directory',
    );
    assert.match(
      MULTI_REPO,
      /\.agentxchain\/multirepo\/handoffs/,
      'multi-repo.mdx must document the handoff artifact location from implementation',
    );
  });

  it('AT-HANDOFF-DISC-008: multi-repo docs mention source repo authority', () => {
    assert.match(
      MULTI_REPO,
      /source repo retains authority|intake resolve/,
      'multi-repo.mdx must state that only intake resolve in the source repo can close the intent',
    );
  });

  // Code-backed: ensure the documented signal sources match implementation
  it('AT-HANDOFF-DISC-009: root README intake section lists shipped signal sources', () => {
    // intake.js exports VALID_SOURCES
    const sourcesMatch = INTAKE_SRC.match(/VALID_SOURCES\s*=\s*\[([^\]]+)\]/);
    assert.ok(sourcesMatch, 'intake.js must export VALID_SOURCES');
    const sources = sourcesMatch[1]
      .split(',')
      .map((s) => s.trim().replace(/['"]/g, ''))
      .filter(Boolean);
    // At least ci_failure should appear in the root README intake section
    assert.ok(
      sources.includes('ci_failure'),
      'shipped VALID_SOURCES must include ci_failure',
    );
    assert.match(
      ROOT_README,
      /delivery signal/i,
      'root README intake section must mention delivery signals',
    );
  });
});
