import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

export function createLegacyIntentRepo(prefix = 'axc-legacy-intents-') {
  const root = mkdtempSync(join(tmpdir(), prefix));

  mkdirSync(join(root, '.agentxchain', 'dispatch', 'turns'), { recursive: true });
  mkdirSync(join(root, '.agentxchain', 'intake', 'intents'), { recursive: true });
  mkdirSync(join(root, '.agentxchain', 'staging'), { recursive: true });
  mkdirSync(join(root, '.planning'), { recursive: true });

  writeFileSync(join(root, 'agentxchain.json'), JSON.stringify({
    schema_version: '1.0',
    protocol_mode: 'governed',
    template: 'generic',
    project: { id: 'legacy-intent-test', name: 'Legacy Intent Test', default_branch: 'main' },
    roles: {
      pm: { title: 'Product Manager', mandate: 'Plan.', write_authority: 'review_only', runtime: 'manual-pm' },
      dev: { title: 'Developer', mandate: 'Build.', write_authority: 'authoritative', runtime: 'manual-dev' },
      qa: { title: 'QA', mandate: 'Verify.', write_authority: 'review_only', runtime: 'manual-qa' },
      eng_director: { title: 'Engineering Director', mandate: 'Resolve deadlocks.', write_authority: 'review_only', runtime: 'manual-director' },
    },
    runtimes: {
      'manual-pm': { type: 'manual' },
      'manual-dev': { type: 'manual' },
      'manual-qa': { type: 'manual' },
      'manual-director': { type: 'manual' },
    },
    routing: {
      planning: { entry_role: 'pm', allowed_next_roles: ['pm', 'eng_director', 'human'], exit_gate: 'planning_signoff' },
      implementation: { entry_role: 'dev', allowed_next_roles: ['dev', 'qa', 'eng_director', 'human'], exit_gate: 'implementation_complete' },
      qa: { entry_role: 'qa', allowed_next_roles: ['dev', 'qa', 'eng_director', 'human'], exit_gate: 'qa_ship_verdict' },
    },
    gates: {
      planning_signoff: {
        requires_files: ['.planning/PM_SIGNOFF.md', '.planning/ROADMAP.md', '.planning/SYSTEM_SPEC.md'],
        requires_human_approval: true,
      },
      implementation_complete: {
        requires_files: ['.planning/IMPLEMENTATION_NOTES.md'],
        requires_verification_pass: true,
      },
      qa_ship_verdict: {
        requires_files: ['.planning/acceptance-matrix.md', '.planning/ship-verdict.md', '.planning/RELEASE_NOTES.md'],
        requires_human_approval: true,
      },
    },
  }, null, 2));

  writeFileSync(join(root, '.agentxchain', 'state.json'), JSON.stringify({
    schema_version: '1.0',
    protocol_version: '2.136.0',
    run_id: 'run_c8a4701ce0d4952d',
    project_id: 'legacy-intent-test',
    status: 'active',
    phase: 'implementation',
    accepted_integration_ref: null,
    active_turns: {},
    turn_sequence: 7,
    last_completed_turn_id: 'turn_prev_001',
    blocked_on: null,
    blocked_reason: null,
    escalation: null,
    phase_gate_status: {},
  }, null, 2));
  writeFileSync(join(root, '.agentxchain', 'history.jsonl'), '');
  writeFileSync(join(root, '.agentxchain', 'decision-ledger.jsonl'), '');
  writeFileSync(join(root, '.agentxchain', 'events.jsonl'), '');

  writeFileSync(join(root, '.planning', 'PM_SIGNOFF.md'), '# Existing signoff\n');
  writeFileSync(join(root, '.planning', 'ROADMAP.md'), '# Existing roadmap\n');
  writeFileSync(join(root, '.planning', 'SYSTEM_SPEC.md'), '# Existing spec\n');
  writeFileSync(join(root, '.planning', 'VISION.md'), '# Vision\n\n## Goals\n\n');

  return root;
}

export function seedLegacyIntent(root, intentId) {
  writeFileSync(join(root, '.agentxchain', 'intake', 'intents', `${intentId}.json`), JSON.stringify({
    intent_id: intentId,
    summary: `Legacy ${intentId}`,
    priority: 'p1',
    status: 'approved',
    approved_run_id: null,
    run_id: null,
    template: 'generic',
    charter: 'Legacy pre-BUG-34 intent with no run scope.',
    acceptance_contract: ['Should be archived before dispatch'],
    created_at: '2026-04-10T00:00:00.000Z',
    updated_at: '2026-04-10T00:00:00.000Z',
    history: [],
  }, null, 2));
}

export function seedContinuousSession(root, session) {
  writeFileSync(join(root, '.agentxchain', 'continuous-session.json'), JSON.stringify(session, null, 2));
}

export function readIntent(root, intentId) {
  return JSON.parse(readFileSync(join(root, '.agentxchain', 'intake', 'intents', `${intentId}.json`), 'utf8'));
}

export function readEvents(root) {
  const eventsPath = join(root, '.agentxchain', 'events.jsonl');
  if (!existsSync(eventsPath)) return [];
  return readFileSync(eventsPath, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}
