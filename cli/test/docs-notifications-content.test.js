import { strict as assert } from 'node:assert';
import { describe, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..', '..');

const read = (rel) => readFileSync(join(REPO_ROOT, rel), 'utf8');

const DOC_PATH = 'website-v2/docs/notifications.mdx';
const DOC = read(DOC_PATH);
const SIDEBARS = read('website-v2/sidebars.ts');
const NOTIFICATION_RUNNER_SRC = read('cli/src/lib/notification-runner.js');

const EVENT_NAMES = [];
for (const match of NOTIFICATION_RUNNER_SRC.matchAll(/'([a-z_]+)'/g)) {
  const value = match[1];
  if (
    ['run_blocked', 'operator_escalation_raised', 'escalation_resolved', 'phase_transition_pending', 'run_completion_pending', 'run_completed', 'approval_sla_reminder'].includes(value)
    && !EVENT_NAMES.includes(value)
  ) {
    EVENT_NAMES.push(value);
  }
}

describe('Notifications docs surface', () => {
  it('ships the Docusaurus page', () => {
    assert.ok(existsSync(join(REPO_ROOT, DOC_PATH)), 'notifications docs page must exist');
  });

  it('is wired into the sidebar', () => {
    assert.match(SIDEBARS, /'notifications'/, 'sidebars.ts must include notifications page');
  });

  it('has correct frontmatter', () => {
    assert.match(DOC, /title:\s*Notifications/);
    assert.match(DOC, /description:/);
  });
});

describe('Notifications docs contract', () => {
  it('documents every shipped notification event from code', () => {
    for (const eventName of EVENT_NAMES) {
      assert.ok(DOC.includes(eventName), `notifications docs must mention event "${eventName}"`);
    }
  });

  it('documents the top-level notifications config surface', () => {
    assert.ok(DOC.includes('"notifications"'));
    assert.ok(DOC.includes('"webhooks"'));
    assert.ok(DOC.includes('"timeout_ms"'));
  });

  it('documents audit evidence and export verification', () => {
    assert.ok(DOC.includes('.agentxchain/notification-audit.jsonl'));
    assert.ok(DOC.includes('notification_audit_entries'));
    assert.ok(DOC.includes('verify export'));
    assert.ok(DOC.includes('/api/notifications'));
    assert.ok(DOC.includes('Notifications'));
    assert.match(DOC, /live-only/i);
    assert.match(DOC, /replay mode/i);
    assert.match(DOC, /replay_mode:\s*true/i);
  });

  it('documents the human escalation projection attached to run_blocked notifications', () => {
    assert.ok(DOC.includes('human_escalation'));
    assert.ok(DOC.includes('.agentxchain/human-escalations.jsonl'));
    assert.ok(DOC.includes('HUMAN_TASKS.md'));
    assert.ok(DOC.includes('agentxchain unblock'));
  });

  it('states best-effort advisory delivery semantics', () => {
    assert.match(DOC, /best-effort/i);
    assert.match(DOC, /do not block/i);
    assert.match(DOC, /advisory/i);
  });

  it('documents the truthful lazy evaluation boundaries for approval SLA reminders', () => {
    assert.match(DOC, /GET \/api\/poll/);
    assert.match(DOC, /every 60 seconds while the tab is visible/i);
    assert.match(DOC, /agentxchain step/);
    assert.match(DOC, /agentxchain run/);
  });

  it('does not fabricate run_failed as a shipped notification event', () => {
    assert.ok(
      !DOC.match(/- `run_failed`/),
      'notifications docs must not claim run_failed is a shipped event'
    );
  });
});
