import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..', '..');

function read(relPath) {
  return readFileSync(join(REPO_ROOT, relPath), 'utf8');
}

const CLI_DOCS = read('website-v2/docs/cli.mdx');
const CLI_ENTRY = read('cli/bin/agentxchain.js');
const SPEC = read('.planning/RUN_SCHEDULE_SPEC.md');

describe('schedule command docs contract', () => {
  it('registers the schedule command family in the CLI entrypoint', () => {
    assert.match(CLI_ENTRY, /\.command\('schedule'\)/);
    assert.match(CLI_ENTRY, /\.command\('list'\)/);
    assert.match(CLI_ENTRY, /\.command\('run-due'\)/);
    assert.match(CLI_ENTRY, /\.command\('daemon'\)/);
    assert.match(CLI_ENTRY, /\.command\('status'\)/);
  });

  it('documents the schedule command and config contract in cli.mdx', () => {
    assert.match(CLI_DOCS, /### `schedule`/);
    assert.match(CLI_DOCS, /`every_minutes`/);
    assert.match(CLI_DOCS, /schedule run-due/);
    assert.match(CLI_DOCS, /schedule daemon/);
    assert.match(CLI_DOCS, /schedule status/);
    assert.match(CLI_DOCS, /trigger: "schedule"/);
  });

  it('documents the daemon health surface in cli.mdx', () => {
    assert.match(CLI_DOCS, /Daemon health/i);
    assert.match(CLI_DOCS, /schedule-daemon\.json/);
    assert.match(CLI_DOCS, /`running`/);
    assert.match(CLI_DOCS, /`stale`/);
    assert.match(CLI_DOCS, /`never_started`/);
  });

  it('documents the non-overlap and no-auto-recovery boundary explicitly', () => {
    assert.match(CLI_DOCS, /do \*\*not\*\* attach to an existing `active` or `paused` run/i);
    assert.match(CLI_DOCS, /do \*\*not\*\* auto-recover a `blocked` run/i);
  });
});

describe('run schedule spec alignment', () => {
  it('ships a standalone schedule spec with executable acceptance tests', () => {
    assert.match(SPEC, /## Purpose/);
    assert.match(SPEC, /## Interface/);
    assert.match(SPEC, /AT-SCHED-001/);
    assert.match(SPEC, /AT-SCHED-008/);
    assert.match(SPEC, /## Non-Scope/);
  });
});
