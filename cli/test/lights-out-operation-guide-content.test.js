import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..', '..');

function read(relPath) {
  return readFileSync(join(REPO_ROOT, relPath), 'utf8');
}

const DOC_PATH = 'website-v2/docs/lights-out-operation.mdx';
const DOC = read(DOC_PATH);
const SIDEBARS = read('website-v2/sidebars.ts');
const SCHEDULING_DOC = read('website-v2/docs/lights-out-scheduling.mdx');
const SPEC = read('.planning/LIGHTS_OUT_OPERATION_GUIDE_SPEC.md');

describe('lights-out operation guide contract', () => {
  it('ships the dedicated guide and sidebar entry', () => {
    assert.ok(existsSync(join(REPO_ROOT, DOC_PATH)), 'lights-out operation guide must exist');
    assert.match(SIDEBARS, /'lights-out-operation'/);
  });

  it('states the repo-local boundary and sends multi-repo operators to the correct surface', () => {
    assert.match(DOC, /repo-local only/i);
    assert.match(DOC, /agentxchain\.json/);
    assert.match(DOC, /agentxchain multi/);
    assert.match(DOC, /Multi-Repo Coordination/);
  });

  it('includes concrete preflight commands and a bounded foreground proof run', () => {
    assert.match(DOC, /agentxchain doctor/);
    assert.match(DOC, /agentxchain connector check/);
    assert.match(DOC, /agentxchain status/);
    assert.match(DOC, /agentxchain run --continuous --vision \.planning\/VISION\.md --max-runs 1 --session-budget 5\.00/);
    assert.match(DOC, /run-continuous-mixed-proof\.mjs/);
    assert.match(DOC, /A `review_only` `api_proxy` QA role can validate and request completion, but it cannot create gate files/i);
  });

  it('documents the daemon-owned runbook path and observation commands', () => {
    assert.match(DOC, /continuous[\s\S]*vision_path[\s\S]*per_session_max_usd/);
    assert.match(DOC, /agentxchain schedule daemon --poll-seconds 60/);
    assert.match(DOC, /agentxchain schedule status/);
    assert.match(DOC, /agentxchain schedule list/);
    assert.match(DOC, /agentxchain events --follow/);
    assert.match(DOC, /owner_type: "schedule"/);
    assert.match(DOC, /session_continuation <previous_run_id> -> <next_run_id> \(<objective>\)/);
    assert.match(DOC, /`paused` is reserved for real blockers/i);
    assert.match(DOC, /end as `completed` or `idle_exit`/i);
  });

  it('documents recovery, priority injection, session-budget stop, and SIGINT semantics', () => {
    assert.match(DOC, /run the exact recovery command surfaced by the governed state/i);
    assert.match(DOC, /agentxchain unblock <id>/);
    assert.match(DOC, /reissue-turn --turn <id> --reason ghost/i);
    assert.match(DOC, /reissue-turn --turn <id> --reason stale/i);
    assert.match(DOC, /agentxchain reconcile-state --accept-operator-head/i);
    assert.match(DOC, /state_reconciled_operator_commits/i);
    // BUG-62 auto_safe_only continuous reconcile policy must live on the stable
    // operator page, not only in release notes: full-auto default, config key,
    // CLI flag, refusal event, and the three valid modes must be discoverable.
    assert.match(DOC, /reconcile_operator_commits/);
    assert.match(DOC, /auto_safe_only/);
    assert.match(DOC, /--reconcile-operator-commits/);
    assert.match(DOC, /operator_commit_reconcile_refused/);
    assert.match(DOC, /`disabled`/);
    assert.match(DOC, /`manual`/);
    assert.match(DOC, /agentxchain inject "Fix the broken release-note sidebar ordering" --priority p0/);
    assert.match(DOC, /priority_preempted/);
    assert.match(DOC, /session-budget exhaustion is a \*\*terminal stop\*\*, not a blocker/i);
    assert.match(DOC, /first `Ctrl\+C`: finish the current in-flight work, then stop/i);
    assert.match(DOC, /second `Ctrl\+C`: hard-abort/i);
  });
});

describe('lights-out operation guide spec alignment', () => {
  it('ships the standalone runbook spec with executable acceptance tests', () => {
    assert.match(SPEC, /\*\*Status:\*\*\s+Shipped/i);
    assert.match(SPEC, /AT-LIGHTSOUT-001/);
    assert.match(SPEC, /AT-LIGHTSOUT-006/);
  });

  it('keeps the scheduler page linked as the lower-level reference', () => {
    assert.match(SCHEDULING_DOC, /Lights-Out Operation/);
    assert.match(SCHEDULING_DOC, /scheduler contract and config surface/i);
  });
});
