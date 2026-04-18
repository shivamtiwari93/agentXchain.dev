import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..', '..');

const read = (rel) => readFileSync(join(REPO_ROOT, rel), 'utf8');

const DOC = read('website-v2/docs/recovery.mdx');
const MISSION_DOC = read('website-v2/docs/missions.mdx');
const MISSION_PLANS = read('cli/src/lib/mission-plans.js');
const MISSION_CMD = read('cli/src/commands/mission.js');
const PLAN_READER = read('cli/src/lib/dashboard/plan-reader.js');

describe('Recovery docs coordinator retry contract', () => {
  it('documents the targeted coordinator retry surface', () => {
    assert.match(DOC, /## Coordinator-Level Recovery/);
    assert.match(DOC, /### Targeted coordinator retry/);
    assert.match(DOC, /agentxchain mission plan launch latest --workstream <id> --retry/);
    assert.match(DOC, /failed` or `failed_acceptance`/);
  });

  it('documents the fail-closed coordinator retry guards from implementation', () => {
    assert.match(MISSION_PLANS, /is not in needs_attention state/);
    assert.match(MISSION_PLANS, /multiple retryable repo failures/);
    assert.match(MISSION_PLANS, /is no longer active/);
    assert.match(MISSION_PLANS, /dependent workstream/);

    for (const term of [
      'needs_attention',
      'Multiple repo failures exist in the same workstream',
      'The failed repo-local turn is no longer active',
      'A dependent workstream has already dispatched since the failed repo turn',
      '`conflicted`, `retrying`, `needs_human`',
    ]) {
      assert.ok(
        DOC.includes(term),
        `recovery docs must mention coordinator retry guard "${term}"`
      );
    }
  });

  it('documents the repo-local fallback path when coordinator retry is blocked', () => {
    for (const term of [
      '### Repo-local recovery fallback',
      'agentxchain status',
      'agentxchain doctor',
      'reissue-turn',
      'reject-turn',
      'step --resume',
      'mission plan launch --workstream <id>',
      'mission plan autopilot --continue-on-failure',
    ]) {
      assert.ok(
        DOC.includes(term),
        `recovery docs must mention fallback term "${term}"`
      );
    }
  });

  it('documents the unattended coordinator auto-retry surface truthfully', () => {
    assert.match(DOC, /### Coordinator autopilot auto-retry/);
    assert.match(DOC, /mission plan autopilot latest --auto-retry --max-retries 1/);
    assert.match(DOC, /same downstream-dispatch safety guard/i);
    assert.match(DOC, /per-session retry budget only/i);
    assert.match(DOC, /failure_stopped|plan_incomplete/);
  });

  it('documents dashboard visibility for retry metadata and cross-links to missions', () => {
    assert.match(PLAN_READER, /dispatch_mode:\s*lr\.dispatch_mode \|\| null/);
    assert.match(PLAN_READER, /repo_dispatches:/);
    assert.match(PLAN_READER, /is_retry: true, retry_of: rd\.retry_of/);
    assert.match(PLAN_READER, /retried_at: rd\.retried_at, retry_reason: rd\.retry_reason/);

    assert.match(DOC, /GET \/api\/plans/);
    assert.match(DOC, /repo_dispatches\[\]/);
    assert.match(DOC, /is_retry`, `retry_of`, `retried_at`, `retry_reason`/);
    assert.match(
      DOC,
      /\[Missions — Recovering a failed coordinator workstream\]\(\/docs\/missions#recovering-a-failed-coordinator-workstream\)/
    );
    assert.match(MISSION_DOC, /Recovering a failed coordinator workstream/);
  });

  it('documents projection-warning visibility and the operator sync path', () => {
    assert.match(MISSION_CMD, /coordinator_acceptance_projection_incomplete/);
    assert.match(MISSION_CMD, /reconciliation_required:/);
    assert.match(MISSION_CMD, /coordinator_retry_projection_warning/);

    assert.match(DOC, /reconciliation_required: true/);
    assert.match(DOC, /coordinator_acceptance_projection_incomplete/);
    assert.match(DOC, /agentxchain events --type coordinator_retry_projection_warning/);
    assert.match(DOC, /agentxchain mission plan show latest --json/);
    assert.match(DOC, /repo-local retry already succeeded/i);
  });

  it('documents the shipped unattended coordinator auto-retry surface without inventing broader semantics', () => {
    assert.match(MISSION_CMD, /--retry requires --workstream <id>/);
    assert.match(MISSION_CMD, /--max-retries must be >= 1 when --auto-retry is set/);
    assert.match(DOC, /--auto-retry/);
    assert.match(DOC, /does not invent broader cross-repo rollback semantics/i);
  });
});
