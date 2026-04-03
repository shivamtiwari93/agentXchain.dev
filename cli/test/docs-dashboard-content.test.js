/**
 * Docs content verification — dashboard operator documentation.
 *
 * These tests read the Docusaurus source files and assert that the dashboard
 * documentation covers all operator-required surfaces per V2_DASHBOARD_SPEC.md
 * and DEC-DASH-SURFACE-001.
 */

import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..', '..');
const CLI_DOCS = readFileSync(join(REPO_ROOT, 'website-v2', 'docs', 'cli.mdx'), 'utf8');
const CLI_README = readFileSync(join(REPO_ROOT, 'cli', 'README.md'), 'utf8');
const ROOT_README = readFileSync(join(REPO_ROOT, 'README.md'), 'utf8');

describe('Dashboard operator documentation — CLI docs page', () => {
  it('has a dashboard section', () => {
    assert.ok(CLI_DOCS.includes('## Dashboard') || CLI_DOCS.includes('### `dashboard`'), 'cli docs must have a dashboard section');
  });

  it('documents the command syntax', () => {
    assert.ok(CLI_DOCS.includes('agentxchain dashboard'), 'must show the dashboard command');
    assert.ok(CLI_DOCS.includes('--port'), 'must document --port option');
    assert.ok(CLI_DOCS.includes('--no-open'), 'must document --no-open option');
  });

  it('documents localhost-only binding', () => {
    assert.ok(CLI_DOCS.includes('127.0.0.1'), 'must mention localhost binding');
  });

  it('documents read-only constraint', () => {
    assert.ok(
      CLI_DOCS.includes('read-only') || CLI_DOCS.includes('Read-only'),
      'must state read-only constraint'
    );
  });

  it('documents dashboard views', () => {
    assert.ok(CLI_DOCS.includes('timeline') || CLI_DOCS.includes('Timeline'), 'must document timeline');
    assert.ok(CLI_DOCS.includes('ledger') || CLI_DOCS.includes('Ledger'), 'must document ledger');
    assert.ok(CLI_DOCS.includes('Phase') || CLI_DOCS.includes('phase'), 'must document phase view');
  });

  it('documents the approval commands operators see', () => {
    assert.ok(CLI_DOCS.includes('approve-transition'), 'must mention approve-transition');
    assert.ok(CLI_DOCS.includes('approve-completion'), 'must mention approve-completion');
  });
});

describe('Dashboard discoverability — other surfaces', () => {
  it('cli/README.md mentions dashboard', () => {
    assert.ok(
      CLI_README.includes('dashboard'),
      'cli/README.md must mention the dashboard command'
    );
  });

  it('root README.md mentions dashboard', () => {
    assert.ok(
      ROOT_README.includes('dashboard'),
      'root README.md must mention the dashboard command'
    );
  });
});
