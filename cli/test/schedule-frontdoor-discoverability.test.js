import { strict as assert } from 'node:assert';
import { describe, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..', '..');

function read(relPath) {
  return readFileSync(join(REPO_ROOT, relPath), 'utf8');
}

const ROOT_README = read('README.md');
const CLI_README = read('cli/README.md');
const SPEC = read('.planning/SCHEDULE_FRONTDOOR_DISCOVERABILITY_SPEC.md');

describe('schedule front-door discoverability', () => {
  it('AT-SCHED-FD-001: both READMEs link to the Lights-Out Scheduling guide', () => {
    for (const [label, content] of [
      ['README.md', ROOT_README],
      ['cli/README.md', CLI_README],
    ]) {
      assert.match(
        content,
        /\[Lights-Out Scheduling\]\(https:\/\/agentxchain\.dev\/docs\/lights-out-scheduling\/\)/,
        `${label} must link to the scheduling guide`,
      );
    }
  });

  it('AT-SCHED-FD-002: root README surfaces the repo-local schedule command family', () => {
    assert.match(ROOT_README, /repo-local lights-out scheduling/i);
    assert.match(ROOT_README, /`schedule list`/);
    assert.match(ROOT_README, /`schedule run-due`/);
    assert.match(ROOT_README, /`schedule daemon`/);
    assert.match(ROOT_README, /`schedule status`/);
    assert.match(ROOT_README, /not coordinator-wide or hosted automation/i);
  });

  it('AT-SCHED-FD-003: CLI README includes the schedule family in the governed command matrix', () => {
    assert.match(CLI_README, /\| `schedule list\\\|run-due\\\|daemon\\\|status` \|/);
    assert.match(CLI_README, /repo-local lights-out scheduling/i);
    assert.match(CLI_README, /daemon heartbeat/i);
  });

  it('AT-SCHED-FD-004: the discoverability spec records the contract and truthfulness boundary', () => {
    assert.match(SPEC, /\*\*Status:\*\*\s+shipped/i);
    assert.match(SPEC, /AT-SCHED-FD-001/);
    assert.match(SPEC, /AT-SCHED-FD-004/);
    assert.match(SPEC, /repo-local/i);
    assert.match(SPEC, /does not imply hosted orchestration or coordinator fan-out/i);
  });
});
