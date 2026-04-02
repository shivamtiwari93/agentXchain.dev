/**
 * Docs content verification — dashboard operator documentation.
 *
 * These tests read the actual HTML docs files and assert that the dashboard
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
const CLI_DOCS = readFileSync(join(REPO_ROOT, 'website', 'docs', 'cli.html'), 'utf8');
const QUICKSTART_DOCS = readFileSync(join(REPO_ROOT, 'website', 'docs', 'quickstart.html'), 'utf8');
const CLI_README = readFileSync(join(REPO_ROOT, 'cli', 'README.md'), 'utf8');
const ROOT_README = readFileSync(join(REPO_ROOT, 'README.md'), 'utf8');

describe('Dashboard operator documentation — CLI docs page', () => {
  it('has a dashboard section', () => {
    assert.ok(CLI_DOCS.includes('id="dashboard"'), 'cli.html must have a #dashboard section');
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
    assert.ok(
      CLI_DOCS.includes('observation surface') || CLI_DOCS.includes('not a control plane'),
      'must clarify it is not a control plane'
    );
  });

  it('documents all five panels', () => {
    assert.ok(CLI_DOCS.includes('Run Timeline') || CLI_DOCS.includes('timeline'), 'must document timeline panel');
    assert.ok(CLI_DOCS.includes('Decision Ledger') || CLI_DOCS.includes('ledger'), 'must document ledger panel');
    assert.ok(CLI_DOCS.includes('Hook Audit') || CLI_DOCS.includes('hook audit'), 'must document hook audit panel');
    assert.ok(CLI_DOCS.includes('Blocked State') || CLI_DOCS.includes('blocked'), 'must document blocked panel');
    assert.ok(CLI_DOCS.includes('Gate Review') || CLI_DOCS.includes('gate review'), 'must document gate review panel');
  });

  it('documents which .agentxchain/ files power the dashboard', () => {
    assert.ok(CLI_DOCS.includes('state.json'), 'must mention state.json');
    assert.ok(CLI_DOCS.includes('history.jsonl'), 'must mention history.jsonl');
    assert.ok(CLI_DOCS.includes('decision-ledger.jsonl'), 'must mention decision-ledger.jsonl');
    assert.ok(CLI_DOCS.includes('hook-audit.jsonl'), 'must mention hook-audit.jsonl');
    assert.ok(CLI_DOCS.includes('hook-annotations.jsonl'), 'must mention hook-annotations.jsonl');
  });

  it('documents the API endpoints', () => {
    assert.ok(CLI_DOCS.includes('/api/state'), 'must document /api/state endpoint');
    assert.ok(CLI_DOCS.includes('/api/history'), 'must document /api/history endpoint');
    assert.ok(CLI_DOCS.includes('/api/ledger'), 'must document /api/ledger endpoint');
    assert.ok(CLI_DOCS.includes('/api/hooks/audit'), 'must document /api/hooks/audit endpoint');
    assert.ok(CLI_DOCS.includes('/api/hooks/annotations'), 'must document /api/hooks/annotations endpoint');
  });

  it('documents exact CLI commands operators see in the dashboard', () => {
    assert.ok(CLI_DOCS.includes('approve-transition'), 'must mention approve-transition');
    assert.ok(CLI_DOCS.includes('approve-completion'), 'must mention approve-completion');
  });

  it('documents what is NOT in v2.0', () => {
    assert.ok(
      CLI_DOCS.includes('does NOT do') || CLI_DOCS.includes('does not') || CLI_DOCS.includes('No write operations'),
      'must document v2.0 exclusions'
    );
    assert.ok(CLI_DOCS.includes('dispatch bundle'), 'must mention dispatch bundle exclusion');
    assert.ok(CLI_DOCS.includes('diff'), 'must mention git diff exclusion');
  });

  it('documents the data contract table', () => {
    assert.ok(CLI_DOCS.includes('<table>'), 'must have a data contract table');
    assert.ok(CLI_DOCS.includes('API endpoint') || CLI_DOCS.includes('Panels that use it'),
      'table must have descriptive headers');
  });
});

describe('Dashboard discoverability — other surfaces', () => {
  it('quickstart mentions dashboard for troubleshooting', () => {
    assert.ok(
      QUICKSTART_DOCS.includes('agentxchain dashboard'),
      'quickstart must mention the dashboard command'
    );
  });

  it('quickstart has a next-steps section pointing to dashboard docs', () => {
    assert.ok(
      QUICKSTART_DOCS.includes('dashboard docs') || QUICKSTART_DOCS.includes('#dashboard'),
      'quickstart must link to dashboard docs'
    );
  });

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
