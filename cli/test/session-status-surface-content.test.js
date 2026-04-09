import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..', '..');

const read = (rel) => readFileSync(join(REPO_ROOT, rel), 'utf8');

const README = read('README.md');
const CLI_DOC = read('website-v2/docs/cli.mdx');
const MULTI_SESSION_DOC = read('website-v2/docs/multi-session.mdx');
const SPEC = read('.planning/SESSION_STATUS_SURFACE_SPEC.md');

describe('session continuity status docs surface', () => {
  it('AT-SSC-004: README surfaces restart in the governed command list', () => {
    assert.match(README, /agentxchain restart/);
    assert.match(README, /session\.json/);
  });

  it('AT-SSC-004: CLI docs describe continuity output on status', () => {
    assert.match(CLI_DOC, /Continuity/);
    assert.match(CLI_DOC, /stale-checkpoint warning/i);
    assert.match(CLI_DOC, /top-level additive `continuity` object/);
  });

  it('AT-SSC-004: multi-session docs explain restart and recovery artifacts', () => {
    assert.match(MULTI_SESSION_DOC, /agentxchain restart/);
    assert.match(MULTI_SESSION_DOC, /SESSION_RECOVERY\.md/);
    assert.match(MULTI_SESSION_DOC, /session\.json/);
  });

  it('ships a standalone session status surface spec', () => {
    assert.match(SPEC, /\*\*Status:\*\*\s+shipped/i);
    assert.match(SPEC, /AT-SSC-001/);
    assert.match(SPEC, /AT-SSC-004/);
    assert.match(SPEC, /restart_recommended/);
  });
});
