/**
 * Guard test: `agentxchain run` must be documented on public surfaces.
 *
 * The `run` command is the headline multi-turn governed execution command.
 * These guards ensure it stays visible in the README, CLI docs, and quickstart.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..', '..');
const read = (rel) => readFileSync(resolve(ROOT, rel), 'utf8');

const ROOT_README = read('README.md');
const CLI_DOCS = read('website-v2/docs/cli.mdx');
const QUICKSTART_DOCS = read('website-v2/docs/quickstart.mdx');

describe('run command documentation surface', () => {
  it('root README mentions agentxchain run', () => {
    assert.ok(ROOT_README.includes('agentxchain run'),
      'README.md must document the run command');
  });

  it('root README documents --auto-approve flag', () => {
    assert.ok(ROOT_README.includes('--auto-approve'),
      'README.md must document --auto-approve for CI/lights-out usage');
  });

  it('root README documents --dry-run flag', () => {
    assert.ok(ROOT_README.includes('--dry-run'),
      'README.md must document --dry-run for plan preview');
  });

  it('CLI docs page documents the run command', () => {
    assert.ok(CLI_DOCS.includes('agentxchain run'),
      'CLI docs must document the run command');
  });

  it('CLI docs page documents all run flags', () => {
    for (const flag of ['--role', '--max-turns', '--auto-approve', '--verbose', '--dry-run']) {
      assert.ok(CLI_DOCS.includes(flag),
        `CLI docs must document ${flag} flag for run command`);
    }
  });

  it('CLI docs explains terminal states', () => {
    for (const state of ['completed', 'blocked', 'max_turns_reached']) {
      assert.ok(CLI_DOCS.includes(state),
        `CLI docs must mention terminal state: ${state}`);
    }
  });

  it('root README explains terminal states', () => {
    for (const state of ['completed', 'blocked', 'max_turns_reached']) {
      assert.ok(ROOT_README.includes(state),
        `README must mention terminal state: ${state}`);
    }
  });

  it('quickstart documents run as the automated workflow', () => {
    assert.ok(QUICKSTART_DOCS.includes('agentxchain run'),
      'quickstart must teach the run command');
    assert.ok(QUICKSTART_DOCS.includes('--auto-approve'),
      'quickstart must mention --auto-approve for non-interactive execution');
    assert.ok(QUICKSTART_DOCS.includes('--max-turns'),
      'quickstart must mention --max-turns as a safety cap');
  });

  it('quickstart documents the shipped mixed-mode default and manual fallback', () => {
    for (const token of ['manual-pm', 'local-dev', 'api-qa', 'agentxchain step --role pm']) {
      assert.ok(QUICKSTART_DOCS.includes(token),
        `quickstart must document mixed-mode default/manual fallback token: ${token}`);
    }
  });
});
