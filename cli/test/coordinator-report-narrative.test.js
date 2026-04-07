import { strict as assert } from 'node:assert';
import { createHash } from 'node:crypto';
import { describe, it } from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildGovernanceReport, formatGovernanceReportText, formatGovernanceReportMarkdown } from '../src/lib/report.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Build a verified file entry with bytes, sha256, content_base64
// Use format 'json' for .json files, 'jsonl' for .jsonl files
function jsonFileEntry(data) {
  const raw = JSON.stringify(data, null, 2) + '\n';
  const buf = Buffer.from(raw, 'utf8');
  return {
    format: 'json',
    data,
    bytes: buf.length,
    sha256: createHash('sha256').update(buf).digest('hex'),
    content_base64: buf.toString('base64'),
  };
}

function jsonlFileEntry(dataArray) {
  const raw = dataArray.length > 0
    ? dataArray.map((e) => JSON.stringify(e)).join('\n') + '\n'
    : '';
  const buf = Buffer.from(raw, 'utf8');
  return {
    format: 'jsonl',
    data: dataArray,
    bytes: buf.length,
    sha256: createHash('sha256').update(buf).digest('hex'),
    content_base64: buf.toString('base64'),
  };
}

// Build a minimal valid run export for nested repo entries
function buildRepoExport(repoId, projectName, { historyEntries = [], decisionEntries = [] } = {}) {
  const projId = `${repoId}-proj`;
  const runId = `run_${repoId}_001`;
  const repoConfig = {
    schema_version: '1.0',
    template: 'governed',
    project: { id: projId, name: projectName, default_branch: 'main' },
    roles: { dev: { title: 'Dev', mandate: 'Build.', write_authority: 'authoritative', runtime: 'local' } },
    runtimes: { local: { type: 'local_cli', command: ['echo', 'ok'], prompt_transport: 'argv' } },
    routing: { implementation: { entry_role: 'dev', allowed_next_roles: ['dev'] } },
    gates: {},
    hooks: {},
  };
  const state = {
    schema_version: '1.1',
    project_id: projId,
    run_id: runId,
    status: 'completed',
    phase: 'implementation',
    active_turns: {},
    retained_turns: {},
    turn_sequence: historyEntries.length,
  };
  return {
    schema_version: '0.2',
    export_kind: 'agentxchain_run_export',
    exported_at: '2026-04-06T20:00:00.000Z',
    project_root: `/tmp/repos/${repoId}`,
    project: { id: projId, name: projectName, template: 'governed', schema_version: '1.0', protocol_mode: 'governed' },
    summary: {
      run_id: runId,
      status: 'completed',
      phase: 'implementation',
      active_turn_ids: [],
      retained_turn_ids: [],
      history_entries: historyEntries.length,
      decision_entries: decisionEntries.length,
      hook_audit_entries: 0,
      notification_audit_entries: 0,
      dispatch_artifact_files: 0,
      staging_artifact_files: 0,
      intake_present: false,
      coordinator_present: false,
    },
    state,
    config: repoConfig,
    files: {
      'agentxchain.json': jsonFileEntry(repoConfig),
      '.agentxchain/state.json': jsonFileEntry(state),
      ...(historyEntries.length > 0 ? { '.agentxchain/history.jsonl': jsonlFileEntry(historyEntries) } : {}),
      ...(decisionEntries.length > 0 ? { '.agentxchain/decision-ledger.jsonl': jsonlFileEntry(decisionEntries) } : {}),
    },
  };
}

// Build a realistic coordinator export fixture with multiple event types
function buildCoordinatorFixture(options = {}) {
  const now = '2026-04-06T20:00:00.000Z';
  const historyEvents = [
    {
      type: 'run_initialized',
      super_run_id: 'srun_test_001',
      project_id: 'multi-proj',
      repo_runs: {
        api: { run_id: 'run_api_001', initialized_by_coordinator: true },
        web: { run_id: 'run_web_001', initialized_by_coordinator: true },
      },
      timestamp: '2026-04-06T19:00:00.000Z',
    },
    {
      type: 'turn_dispatched',
      timestamp: '2026-04-06T19:01:00.000Z',
      super_run_id: 'srun_test_001',
      workstream_id: 'core',
      repo_id: 'api',
      repo_run_id: 'run_api_001',
      repo_turn_id: 'turn_api_001',
      role: 'dev',
      context_ref: 'ctx_core_api_abc123',
    },
    {
      type: 'acceptance_projection',
      timestamp: '2026-04-06T19:05:00.000Z',
      super_run_id: 'srun_test_001',
      projection_ref: 'proj_core_api_def456',
      workstream_id: 'core',
      repo_id: 'api',
      repo_run_id: 'run_api_001',
      repo_turn_id: 'turn_api_001',
      summary: 'Implemented auth middleware',
      files_changed: ['src/auth.ts'],
      decisions: [{ id: 'DEC-101' }],
      verification: { status: 'pass' },
    },
    {
      type: 'context_generated',
      timestamp: '2026-04-06T19:06:00.000Z',
      super_run_id: 'srun_test_001',
      context_ref: 'ctx_core_web_ghi789',
      workstream_id: 'core',
      target_repo_id: 'web',
      relevant_workstream_ids: ['core'],
      upstream_repo_ids: ['api'],
    },
    {
      type: 'state_resynced',
      timestamp: '2026-04-06T19:10:00.000Z',
      super_run_id: 'srun_test_001',
      resynced_repos: ['api'],
      barrier_changes: [
        {
          barrier_id: 'core_completion',
          previous_status: 'pending',
          new_status: 'partially_satisfied',
        },
      ],
    },
    {
      type: 'phase_transition_requested',
      timestamp: '2026-04-06T19:15:00.000Z',
      super_run_id: 'srun_test_001',
      gate: 'phase_transition:planning->implementation',
      from: 'planning',
      to: 'implementation',
      required_repos: ['api', 'web'],
    },
    {
      type: 'phase_transition_approved',
      timestamp: '2026-04-06T19:16:00.000Z',
      super_run_id: 'srun_test_001',
      gate: 'phase_transition:planning->implementation',
      from: 'planning',
      to: 'implementation',
    },
    {
      type: 'blocked_resolved',
      timestamp: '2026-04-06T19:20:00.000Z',
      super_run_id: 'srun_test_001',
      from: 'blocked',
      to: 'active',
      blocked_reason: 'hook violation',
    },
    {
      type: 'run_completion_requested',
      timestamp: '2026-04-06T19:25:00.000Z',
      super_run_id: 'srun_test_001',
      gate: 'initiative_ship',
      required_repos: ['api', 'web'],
    },
    {
      type: 'run_completed',
      timestamp: '2026-04-06T19:30:00.000Z',
      super_run_id: 'srun_test_001',
      gate: 'initiative_ship',
    },
    // unknown event type for fallback test
    {
      type: 'custom_audit_event',
      timestamp: '2026-04-06T19:31:00.000Z',
      detail: 'something custom',
    },
  ];

  const barriers = {
    core_completion: {
      workstream_id: 'core',
      type: 'all_repos_accepted',
      status: 'satisfied',
      required_repos: ['api', 'web'],
      satisfied_repos: ['api', 'web'],
      created_at: '2026-04-06T19:00:00.000Z',
    },
    deploy_gate: {
      workstream_id: 'deploy',
      type: 'shared_human_gate',
      status: 'pending',
      required_repos: ['api'],
      satisfied_repos: [],
      created_at: '2026-04-06T19:00:00.000Z',
    },
  };

  const coordConfig = {
    schema_version: '0.1',
    project: { id: 'multi-proj', name: 'Multi Project' },
    repo_order: ['api', 'web'],
    repos: {
      api: { path: './repos/api', default_branch: 'main', required: true },
      web: { path: './repos/web', default_branch: 'main', required: true },
    },
    workstream_order: ['core'],
    workstreams: {
      core: {
        phase: 'planning',
        repos: ['api', 'web'],
        entry_repo: 'api',
        depends_on: [],
        completion_barrier: 'all_repos_accepted',
      },
    },
    routing: { planning: { entry_workstream: 'core' }, implementation: { entry_workstream: 'core' } },
    gates: {},
    hooks: {},
  };

  const coordinatorDecisions = [
    {
      id: 'DEC-COORD-001',
      turn_id: 'turn_coord_001',
      role: 'pm',
      phase: 'planning',
      category: 'scope',
      statement: 'Dispatch to api before web for dependency ordering.',
    },
    {
      id: 'DEC-COORD-002',
      turn_id: 'turn_coord_002',
      role: 'dev',
      phase: 'implementation',
      category: 'architecture',
      statement: 'Use shared auth middleware across repos.',
    },
  ];

  const barrierLedgerEvents = [
    {
      type: 'barrier_transition',
      timestamp: '2026-04-06T19:10:00.000Z',
      barrier_id: 'core_completion',
      previous_status: 'pending',
      new_status: 'partially_satisfied',
      causation: {
        super_run_id: 'srun_test_001',
        workstream_id: 'core',
        barrier_type: 'all_repos_accepted',
        repo_id: 'api',
        trigger: 'resync',
      },
    },
    {
      type: 'barrier_transition',
      timestamp: '2026-04-06T19:20:00.000Z',
      barrier_id: 'core_completion',
      previous_status: 'partially_satisfied',
      new_status: 'satisfied',
      causation: {
        super_run_id: 'srun_test_001',
        workstream_id: 'core',
        barrier_type: 'all_repos_accepted',
        repo_id: 'web',
        trigger: 'resync',
      },
    },
    // non-transition entry that should be filtered out
    {
      type: 'barrier_audit',
      timestamp: '2026-04-06T19:15:00.000Z',
      detail: 'some audit event',
    },
  ];

  const stateData = {
    schema_version: '0.1',
    super_run_id: 'srun_test_001',
    status: 'completed',
    phase: 'implementation',
    created_at: '2026-04-06T18:59:00.000Z',
    updated_at: '2026-04-06T19:40:00.000Z',
    repo_runs: {
      api: { run_id: 'run_api_001', status: 'completed', phase: 'implementation', initialized_by_coordinator: true },
      web: { run_id: 'run_web_001', status: 'completed', phase: 'implementation', initialized_by_coordinator: true },
    },
    pending_gate: null,
  };

  const fixture = {
    schema_version: '0.2',
    export_kind: 'agentxchain_coordinator_export',
    exported_at: now,
    workspace_root: '/tmp/test-workspace',
    coordinator: {
      project_id: 'multi-proj',
      project_name: 'Multi Project',
      schema_version: '0.1',
      repo_count: 2,
      workstream_count: 1,
    },
    summary: {
      super_run_id: 'srun_test_001',
      status: 'completed',
      phase: 'implementation',
      repo_run_statuses: { api: 'completed', web: 'completed' },
      barrier_count: 2,
      history_entries: historyEvents.length,
      decision_entries: coordinatorDecisions.length,
    },
    config: coordConfig,
    files: {
      'agentxchain-multi.json': jsonFileEntry(coordConfig),
      '.agentxchain/multirepo/state.json': jsonFileEntry(stateData),
      '.agentxchain/multirepo/history.jsonl': jsonlFileEntry(historyEvents),
      '.agentxchain/multirepo/barriers.json': jsonFileEntry(barriers),
      '.agentxchain/multirepo/barrier-ledger.jsonl': jsonlFileEntry(barrierLedgerEvents),
      '.agentxchain/multirepo/decision-ledger.jsonl': jsonlFileEntry(coordinatorDecisions),
    },
    repos: {
      api: {
        ok: true,
        path: './repos/api',
        export: buildRepoExport('api', 'API', {
          historyEntries: [{
            turn_id: 'turn_api_001', role: 'dev', status: 'accepted',
            summary: 'Auth middleware', phase: 'implementation',
            accepted_sequence: 1, accepted_at: '2026-04-06T19:05:00.000Z',
            files_changed: ['src/auth.ts'], decisions: [{ id: 'DEC-101' }],
          }],
        }),
      },
      web: {
        ok: true,
        path: './repos/web',
        export: buildRepoExport('web', 'Web'),
      },
    },
  };

  if (options.summaryStatus) {
    fixture.summary.status = options.summaryStatus;
  }

  if (options.state) {
    fixture.files['.agentxchain/multirepo/state.json'] = jsonFileEntry({
      ...fixture.files['.agentxchain/multirepo/state.json'].data,
      ...options.state,
      repo_runs: options.state.repo_runs || fixture.files['.agentxchain/multirepo/state.json'].data.repo_runs,
    });
  }

  if (options.repos) {
    fixture.repos = options.repos;
  }

  return fixture;
}

// AT-COORD-REPORT-001: 6+ event types in chronological order
describe('coordinator report narrative — coordinator_timeline', () => {
  it('AT-COORD-REPORT-001: includes all events in chronological order', () => {
    const fixture = buildCoordinatorFixture();
    const result = buildGovernanceReport(fixture, { input: 'test-fixture' });
    assert.ok(result.ok, 'report built successfully');
    const timeline = result.report.subject.coordinator_timeline;
    assert.ok(Array.isArray(timeline), 'coordinator_timeline is array');
    assert.ok(timeline.length >= 6, `expected >=6 events, got ${timeline.length}`);

    // Verify event type diversity
    const types = new Set(timeline.map((e) => e.type));
    assert.ok(types.has('run_initialized'));
    assert.ok(types.has('turn_dispatched'));
    assert.ok(types.has('acceptance_projection'));
    assert.ok(types.has('context_generated'));
    assert.ok(types.has('state_resynced'));
    assert.ok(types.has('phase_transition_requested'));
    assert.ok(types.has('phase_transition_approved'));
    assert.ok(types.has('run_completed'));

    // Chronological order preserved
    for (let i = 1; i < timeline.length; i++) {
      if (timeline[i].timestamp && timeline[i - 1].timestamp) {
        assert.ok(timeline[i].timestamp >= timeline[i - 1].timestamp, `event ${i} should be after event ${i - 1}`);
      }
    }
  });

  it('AT-COORD-ACT-005: completed coordinator emits no next actions', () => {
    const fixture = buildCoordinatorFixture();
    const result = buildGovernanceReport(fixture, { input: 'test-fixture' });

    assert.deepEqual(result.report.subject.run.next_actions, []);

    const text = formatGovernanceReportText(result.report);
    const md = formatGovernanceReportMarkdown(result.report);
    assert.ok(!text.includes('Next Actions:'), 'completed report must omit text next-actions section');
    assert.ok(!md.includes('## Next Actions'), 'completed report must omit markdown next-actions section');
  });

  it('AT-COORD-TIME-001/002: completed coordinator timing prefers history lifecycle timestamps', () => {
    const fixture = buildCoordinatorFixture();
    const result = buildGovernanceReport(fixture, { input: 'test-fixture' });
    const run = result.report.subject.run;

    assert.equal(run.created_at, '2026-04-06T19:00:00.000Z');
    assert.equal(run.completed_at, '2026-04-06T19:30:00.000Z');
    assert.equal(run.duration_seconds, 1800);
  });

  // AT-COORD-REPORT-002: each entry has type, timestamp, and non-empty summary
  it('AT-COORD-REPORT-002: every timeline entry has type, timestamp, and summary', () => {
    const fixture = buildCoordinatorFixture();
    const result = buildGovernanceReport(fixture, { input: 'test-fixture' });
    const timeline = result.report.subject.coordinator_timeline;
    for (const ev of timeline) {
      assert.ok(typeof ev.type === 'string' && ev.type.length > 0, `type must be non-empty string, got ${ev.type}`);
      assert.ok(typeof ev.timestamp === 'string' || ev.timestamp === null, 'timestamp must be string or null');
      assert.ok(typeof ev.summary === 'string' && ev.summary.length > 0, 'summary must be non-empty');
    }
  });

  // AT-COORD-REPORT-007: unknown event type renders with fallback
  it('AT-COORD-REPORT-007: unknown event type uses fallback summary', () => {
    const fixture = buildCoordinatorFixture();
    const result = buildGovernanceReport(fixture, { input: 'test-fixture' });
    const timeline = result.report.subject.coordinator_timeline;
    const unknown = timeline.find((e) => e.type === 'custom_audit_event');
    assert.ok(unknown, 'unknown event type present in timeline');
    assert.match(unknown.summary, /custom_audit_event/, 'fallback includes type name');
  });

  // Verify specific summary content for known event types
  it('generates correct human-readable summaries for each event type', () => {
    const fixture = buildCoordinatorFixture();
    const result = buildGovernanceReport(fixture, { input: 'test-fixture' });
    const timeline = result.report.subject.coordinator_timeline;

    const init = timeline.find((e) => e.type === 'run_initialized');
    assert.match(init.summary, /initialized with 2 repos/);

    const dispatch = timeline.find((e) => e.type === 'turn_dispatched');
    assert.match(dispatch.summary, /Dispatched turn to api/);
    assert.match(dispatch.summary, /\(dev\)/);

    const proj = timeline.find((e) => e.type === 'acceptance_projection');
    assert.match(proj.summary, /Projected acceptance from api/);
    assert.match(proj.summary, /Implemented auth middleware/);

    const ctx = timeline.find((e) => e.type === 'context_generated');
    assert.match(ctx.summary, /Generated cross-repo context for web/);
    assert.match(ctx.summary, /1 upstream repo/);

    const resync = timeline.find((e) => e.type === 'state_resynced');
    assert.match(resync.summary, /Resynced state for 1 repo/);
    assert.match(resync.summary, /1 barrier change/);

    const phaseReq = timeline.find((e) => e.type === 'phase_transition_requested');
    assert.match(phaseReq.summary, /planning/);
    assert.match(phaseReq.summary, /implementation/);

    const completed = timeline.find((e) => e.type === 'run_completed');
    assert.match(completed.summary, /Coordinator run completed/);

    const blocked = timeline.find((e) => e.type === 'blocked_resolved');
    assert.match(blocked.summary, /blocked.*active/i);
  });

  // Verify details are extracted for relevant events
  it('extracts event-specific details where present', () => {
    const fixture = buildCoordinatorFixture();
    const result = buildGovernanceReport(fixture, { input: 'test-fixture' });
    const timeline = result.report.subject.coordinator_timeline;

    const proj = timeline.find((e) => e.type === 'acceptance_projection');
    assert.ok(proj.details, 'acceptance_projection has details');
    assert.equal(proj.details.projection_ref, 'proj_core_api_def456');

    const resync = timeline.find((e) => e.type === 'state_resynced');
    assert.ok(resync.details, 'state_resynced has details');
    assert.ok(Array.isArray(resync.details.barrier_changes));
  });
});

// AT-COORD-REPORT-005: barrier summary
describe('coordinator report narrative — barrier_summary', () => {
  it('AT-COORD-REPORT-005: includes barrier_id, status, and repo coverage', () => {
    const fixture = buildCoordinatorFixture();
    const result = buildGovernanceReport(fixture, { input: 'test-fixture' });
    const barriers = result.report.subject.barrier_summary;
    assert.ok(Array.isArray(barriers), 'barrier_summary is array');
    assert.equal(barriers.length, 2, 'two barriers in fixture');

    // Sorted alphabetically
    assert.equal(barriers[0].barrier_id, 'core_completion');
    assert.equal(barriers[1].barrier_id, 'deploy_gate');

    // core_completion: satisfied, 2/2
    assert.equal(barriers[0].status, 'satisfied');
    assert.equal(barriers[0].type, 'all_repos_accepted');
    assert.deepEqual(barriers[0].satisfied_repos, ['api', 'web']);
    assert.deepEqual(barriers[0].required_repos, ['api', 'web']);

    // deploy_gate: pending, 0/1
    assert.equal(barriers[1].status, 'pending');
    assert.equal(barriers[1].type, 'shared_human_gate');
    assert.deepEqual(barriers[1].satisfied_repos, []);
    assert.deepEqual(barriers[1].required_repos, ['api']);
  });
});

// AT-COORD-REPORT-003: text formatter includes Coordinator Timeline
describe('coordinator report narrative — text format', () => {
  it('AT-COORD-REPORT-003: text output includes Coordinator Timeline section', () => {
    const fixture = buildCoordinatorFixture();
    const result = buildGovernanceReport(fixture, { input: 'test-fixture' });
    const text = formatGovernanceReportText(result.report);

    assert.match(text, /Coordinator Timeline:/);
    assert.match(text, /\[run_initialized\]/);
    assert.match(text, /\[turn_dispatched\]/);
    assert.match(text, /\[acceptance_projection\]/);
    assert.match(text, /\[run_completed\]/);
    assert.match(text, /initialized with 2 repos/);
  });

  it('text output includes Barrier Summary section', () => {
    const fixture = buildCoordinatorFixture();
    const result = buildGovernanceReport(fixture, { input: 'test-fixture' });
    const text = formatGovernanceReportText(result.report);

    assert.match(text, /Barrier Summary:/);
    assert.match(text, /core_completion: satisfied/);
    assert.match(text, /deploy_gate: pending/);
    assert.match(text, /2\/2 repos satisfied/);
    assert.match(text, /0\/1 repos satisfied/);
  });

  it('AT-COORD-TIME-005: text output renders coordinator timing', () => {
    const fixture = buildCoordinatorFixture();
    const result = buildGovernanceReport(fixture, { input: 'test-fixture' });
    const text = formatGovernanceReportText(result.report);

    assert.match(text, /Started: 2026-04-06T19:00:00.000Z/);
    assert.match(text, /Completed: 2026-04-06T19:30:00.000Z/);
    assert.match(text, /Duration: 1800s/);
  });
});

// AT-COORD-REPORT-004: markdown formatter includes ## Coordinator Timeline
describe('coordinator report narrative — markdown format', () => {
  it('AT-COORD-REPORT-004: markdown output includes Coordinator Timeline table', () => {
    const fixture = buildCoordinatorFixture();
    const result = buildGovernanceReport(fixture, { input: 'test-fixture' });
    const md = formatGovernanceReportMarkdown(result.report);

    assert.match(md, /## Coordinator Timeline/);
    assert.match(md, /\| # \| Type \| Time \| Summary \|/);
    assert.match(md, /`run_initialized`/);
    assert.match(md, /`acceptance_projection`/);
    assert.match(md, /`run_completed`/);
  });

  it('markdown output includes Barrier Summary table', () => {
    const fixture = buildCoordinatorFixture();
    const result = buildGovernanceReport(fixture, { input: 'test-fixture' });
    const md = formatGovernanceReportMarkdown(result.report);

    assert.match(md, /## Barrier Summary/);
    assert.match(md, /\| Barrier \| Workstream \| Type \| Status \| Satisfied \|/);
    assert.match(md, /`core_completion`/);
    assert.match(md, /`deploy_gate`/);
    assert.match(md, /2\/2 repos/);
    assert.match(md, /0\/1 repos/);
  });

  it('markdown output renders coordinator timing bullets', () => {
    const fixture = buildCoordinatorFixture();
    const result = buildGovernanceReport(fixture, { input: 'test-fixture' });
    const md = formatGovernanceReportMarkdown(result.report);

    assert.match(md, /- Started: `2026-04-06T19:00:00.000Z`/);
    assert.match(md, /- Completed: `2026-04-06T19:30:00.000Z`/);
    assert.match(md, /- Duration: `1800s`/);
  });
});

// AT-COORD-REPORT-006: empty history -> no timeline section
describe('coordinator report narrative — empty history', () => {
  it('AT-COORD-REPORT-006: empty history omits timeline section in text', () => {
    const fixture = buildCoordinatorFixture();
    // Replace history with a valid empty JSONL — must rebuild the entire file entry + update summary
    delete fixture.files['.agentxchain/multirepo/history.jsonl'];
    fixture.summary.history_entries = 0;
    const result = buildGovernanceReport(fixture, { input: 'test-fixture' });
    assert.ok(result.ok);

    const timeline = result.report.subject.coordinator_timeline;
    assert.equal(timeline.length, 0, 'empty timeline');

    const text = formatGovernanceReportText(result.report);
    assert.ok(!text.includes('Coordinator Timeline:'), 'no timeline section when empty');
  });

  it('empty barriers omits barrier section in markdown', () => {
    const fixture = buildCoordinatorFixture();
    fixture.files['.agentxchain/multirepo/barriers.json'] = jsonFileEntry({});
    fixture.summary.barrier_count = 0;
    const result = buildGovernanceReport(fixture, { input: 'test-fixture' });
    const md = formatGovernanceReportMarkdown(result.report);
    assert.ok(!md.includes('## Barrier Summary'), 'no barrier section when empty');
  });

  it('AT-COORD-TIME-003/004: active coordinator falls back to state created_at and leaves completion timing empty', () => {
    const fixture = buildCoordinatorFixture();
    fixture.summary.status = 'active';
    fixture.files['.agentxchain/multirepo/history.jsonl'] = jsonlFileEntry([
      { type: 'turn_dispatched', timestamp: '2026-04-06T19:01:00.000Z', repo_id: 'api', role: 'dev', workstream_id: 'core' },
    ]);
    fixture.summary.history_entries = 1;
    fixture.files['.agentxchain/multirepo/state.json'] = jsonFileEntry({
      ...fixture.files['.agentxchain/multirepo/state.json'].data,
      status: 'active',
      created_at: '2026-04-06T18:59:00.000Z',
      updated_at: '2026-04-06T19:12:00.000Z',
    });

    const result = buildGovernanceReport(fixture, { input: 'test-fixture' });
    const run = result.report.subject.run;

    assert.equal(run.created_at, '2026-04-06T18:59:00.000Z');
    assert.equal(run.completed_at, null);
    assert.equal(run.duration_seconds, null);
  });
});

describe('coordinator report narrative — next actions', () => {
  it('AT-COORD-ACT-001: blocked coordinator with pending gate recommends resume then approve-gate', () => {
    const fixture = buildCoordinatorFixture({
      summaryStatus: 'blocked',
      state: {
        status: 'blocked',
        blocked_reason: 'coordinator_hook_violation',
        pending_gate: {
          gate: 'initiative_ship',
          gate_type: 'run_completion',
          requested_at: '2026-04-06T19:25:00.000Z',
        },
      },
    });

    const result = buildGovernanceReport(fixture, { input: 'test-fixture' });
    const run = result.report.subject.run;

    assert.equal(run.blocked_reason, 'coordinator_hook_violation');
    assert.equal(run.pending_gate.gate, 'initiative_ship');
    assert.equal(run.next_actions.length, 2);
    assert.equal(run.next_actions[0].command, 'agentxchain multi resume');
    assert.match(run.next_actions[0].reason, /blocked/i);
    assert.equal(run.next_actions[1].command, 'agentxchain multi approve-gate');
    assert.match(run.next_actions[1].reason, /After resume/i);

    const text = formatGovernanceReportText(result.report);
    const md = formatGovernanceReportMarkdown(result.report);
    assert.match(text, /Blocked reason: coordinator_hook_violation/);
    assert.match(text, /Pending gate: initiative_ship \(run_completion\)/);
    assert.match(text, /Next Actions:/);
    assert.match(text, /agentxchain multi resume/);
    assert.match(text, /agentxchain multi approve-gate/);
    assert.match(md, /## Next Actions/);
    assert.match(md, /`agentxchain multi resume`/);
    assert.match(md, /`agentxchain multi approve-gate`/);
  });

  it('AT-COORD-ACT-002: paused coordinator with pending gate recommends only approve-gate', () => {
    const fixture = buildCoordinatorFixture({
      summaryStatus: 'paused',
      state: {
        status: 'paused',
        pending_gate: {
          gate: 'phase_transition:planning->implementation',
          gate_type: 'phase_transition',
          from: 'planning',
          to: 'implementation',
        },
      },
    });

    const result = buildGovernanceReport(fixture, { input: 'test-fixture' });
    const run = result.report.subject.run;

    assert.equal(run.blocked_reason, null);
    assert.equal(run.next_actions.length, 1);
    assert.equal(run.next_actions[0].command, 'agentxchain multi approve-gate');
    assert.match(run.next_actions[0].reason, /phase_transition/);
  });

  it('AT-COORD-ACT-003: active coordinator with no blockers recommends multi step', () => {
    const fixture = buildCoordinatorFixture({
      summaryStatus: 'active',
      state: {
        status: 'active',
      },
    });
    fixture.files['.agentxchain/multirepo/history.jsonl'] = jsonlFileEntry([
      { type: 'run_initialized', timestamp: '2026-04-06T19:00:00.000Z', repo_runs: {} },
      { type: 'turn_dispatched', timestamp: '2026-04-06T19:01:00.000Z', repo_id: 'api', role: 'dev', workstream_id: 'core' },
    ]);
    fixture.summary.history_entries = 2;

    const result = buildGovernanceReport(fixture, { input: 'test-fixture' });
    const run = result.report.subject.run;

    assert.equal(run.next_actions.length, 1);
    assert.equal(run.next_actions[0].command, 'agentxchain multi step');
    assert.match(run.next_actions[0].reason, /no blocked state or pending gate/i);
  });

  it('AT-COORD-ACT-004: child/coordinator status drift recommends multi resync', () => {
    const fixture = buildCoordinatorFixture({
      summaryStatus: 'active',
      state: {
        status: 'active',
        repo_runs: {
          api: { run_id: 'run_api_001', status: 'linked', phase: 'implementation', initialized_by_coordinator: true },
          web: { run_id: 'run_web_001', status: 'completed', phase: 'implementation', initialized_by_coordinator: true },
        },
      },
    });
    fixture.summary.repo_run_statuses = { api: 'linked', web: 'completed' };
    fixture.files['.agentxchain/multirepo/history.jsonl'] = jsonlFileEntry([
      { type: 'run_initialized', timestamp: '2026-04-06T19:00:00.000Z', repo_runs: {} },
      { type: 'state_resynced', timestamp: '2026-04-06T19:10:00.000Z', resynced_repos: ['api'], barrier_changes: [] },
    ]);
    fixture.summary.history_entries = 2;

    const result = buildGovernanceReport(fixture, { input: 'test-fixture' });
    assert.ok(result.ok, 'report must build from a verifier-valid drift fixture');
    const run = result.report.subject.run;

    assert.equal(run.next_actions.length, 1);
    assert.equal(run.next_actions[0].command, 'agentxchain multi resync');
    assert.match(run.next_actions[0].reason, /api/);
  });
});

// AT-BARRIER-LEDGER-001: all ledger entries extracted in chronological order
describe('coordinator report narrative — barrier_ledger_timeline', () => {
  it('AT-BARRIER-LEDGER-001: includes all barrier_transition entries in order', () => {
    const fixture = buildCoordinatorFixture();
    const result = buildGovernanceReport(fixture, { input: 'test-fixture' });
    assert.ok(result.ok, 'report built successfully');
    const ledger = result.report.subject.barrier_ledger_timeline;
    assert.ok(Array.isArray(ledger), 'barrier_ledger_timeline is array');
    assert.equal(ledger.length, 2, 'only barrier_transition entries (non-transition filtered out)');

    // Chronological order
    assert.equal(ledger[0].timestamp, '2026-04-06T19:10:00.000Z');
    assert.equal(ledger[1].timestamp, '2026-04-06T19:20:00.000Z');

    // Correct barrier_ids
    assert.equal(ledger[0].barrier_id, 'core_completion');
    assert.equal(ledger[1].barrier_id, 'core_completion');
  });

  // AT-BARRIER-LEDGER-002: each entry has required fields and non-empty summary
  it('AT-BARRIER-LEDGER-002: every entry has barrier_id, timestamps, statuses, and summary', () => {
    const fixture = buildCoordinatorFixture();
    const result = buildGovernanceReport(fixture, { input: 'test-fixture' });
    const ledger = result.report.subject.barrier_ledger_timeline;
    for (const entry of ledger) {
      assert.ok(typeof entry.barrier_id === 'string' && entry.barrier_id.length > 0);
      assert.ok(typeof entry.timestamp === 'string' || entry.timestamp === null);
      assert.ok(typeof entry.previous_status === 'string' && entry.previous_status.length > 0);
      assert.ok(typeof entry.new_status === 'string' && entry.new_status.length > 0);
      assert.ok(typeof entry.summary === 'string' && entry.summary.length > 0);
    }
  });

  it('generates correct human-readable summaries for transitions', () => {
    const fixture = buildCoordinatorFixture();
    const result = buildGovernanceReport(fixture, { input: 'test-fixture' });
    const ledger = result.report.subject.barrier_ledger_timeline;

    // pending → partially_satisfied
    assert.match(ledger[0].summary, /first repo satisfied/);
    assert.match(ledger[0].summary, /api/);

    // partially_satisfied → satisfied
    assert.match(ledger[1].summary, /all repos satisfied/);
    assert.match(ledger[1].summary, /web completed the set/);
  });

  it('extracts causation metadata (workstream_id, repo_id, trigger)', () => {
    const fixture = buildCoordinatorFixture();
    const result = buildGovernanceReport(fixture, { input: 'test-fixture' });
    const ledger = result.report.subject.barrier_ledger_timeline;

    assert.equal(ledger[0].workstream_id, 'core');
    assert.equal(ledger[0].repo_id, 'api');
    assert.equal(ledger[0].trigger, 'resync');

    assert.equal(ledger[1].repo_id, 'web');
  });

  // AT-BARRIER-LEDGER-006: non-transition entries filtered out
  it('AT-BARRIER-LEDGER-006: non-transition entries are filtered out', () => {
    const fixture = buildCoordinatorFixture();
    const result = buildGovernanceReport(fixture, { input: 'test-fixture' });
    const ledger = result.report.subject.barrier_ledger_timeline;
    const types = ledger.map((e) => e.barrier_id);
    assert.ok(!types.includes(undefined), 'no undefined barrier_ids');
    // The barrier_audit entry should not appear
    assert.equal(ledger.length, 2, 'only barrier_transition entries');
  });

  // AT-BARRIER-LEDGER-005: empty/absent ledger omits the section
  it('AT-BARRIER-LEDGER-005: empty ledger omits section in text', () => {
    const fixture = buildCoordinatorFixture();
    delete fixture.files['.agentxchain/multirepo/barrier-ledger.jsonl'];
    const result = buildGovernanceReport(fixture, { input: 'test-fixture' });
    assert.ok(result.ok);
    const ledger = result.report.subject.barrier_ledger_timeline;
    assert.equal(ledger.length, 0);

    const text = formatGovernanceReportText(result.report);
    assert.ok(!text.includes('Barrier Transitions:'), 'no barrier transitions section when empty');
  });

  it('empty ledger omits section in markdown', () => {
    const fixture = buildCoordinatorFixture();
    fixture.files['.agentxchain/multirepo/barrier-ledger.jsonl'] = jsonlFileEntry([]);
    const result = buildGovernanceReport(fixture, { input: 'test-fixture' });
    const md = formatGovernanceReportMarkdown(result.report);
    assert.ok(!md.includes('## Barrier Transitions'), 'no barrier transitions section when empty');
  });
});

// AT-BARRIER-LEDGER-003/004: text and markdown rendering
describe('coordinator report narrative — barrier ledger rendering', () => {
  it('AT-BARRIER-LEDGER-003: text output includes Barrier Transitions section', () => {
    const fixture = buildCoordinatorFixture();
    const result = buildGovernanceReport(fixture, { input: 'test-fixture' });
    const text = formatGovernanceReportText(result.report);

    assert.match(text, /Barrier Transitions:/);
    assert.match(text, /first repo satisfied.*api/);
    assert.match(text, /all repos satisfied.*web completed the set/);
    assert.match(text, /\[2026-04-06T19:10:00.000Z\]/);
    assert.match(text, /\[2026-04-06T19:20:00.000Z\]/);
  });

  it('AT-BARRIER-LEDGER-004: markdown output includes Barrier Transitions table', () => {
    const fixture = buildCoordinatorFixture();
    const result = buildGovernanceReport(fixture, { input: 'test-fixture' });
    const md = formatGovernanceReportMarkdown(result.report);

    assert.match(md, /## Barrier Transitions/);
    assert.match(md, /\| # \| Time \| Barrier \| From \| To \| Summary \|/);
    assert.match(md, /`core_completion`/);
    assert.match(md, /`pending`/);
    assert.match(md, /`partially_satisfied`/);
    assert.match(md, /`satisfied`/);
  });
});

// AT-COORD-DECISION-001: coordinator decisions extracted
describe('coordinator report narrative — decision_digest', () => {
  it('AT-COORD-DECISION-001: includes coordinator decisions with correct fields', () => {
    const fixture = buildCoordinatorFixture();
    const result = buildGovernanceReport(fixture, { input: 'test-fixture' });
    assert.ok(result.ok, 'report built successfully');
    const digest = result.report.subject.decision_digest;
    assert.ok(Array.isArray(digest), 'decision_digest is array');
    assert.equal(digest.length, 2, 'two coordinator decisions in fixture');

    assert.equal(digest[0].id, 'DEC-COORD-001');
    assert.equal(digest[0].role, 'pm');
    assert.equal(digest[0].phase, 'planning');
    assert.equal(digest[0].category, 'scope');
    assert.match(digest[0].statement, /Dispatch to api before web/);

    assert.equal(digest[1].id, 'DEC-COORD-002');
    assert.equal(digest[1].role, 'dev');
    assert.equal(digest[1].phase, 'implementation');
    assert.equal(digest[1].category, 'architecture');
    assert.match(digest[1].statement, /shared auth middleware/);
  });

  // AT-COORD-DECISION-002: every entry has id and statement
  it('AT-COORD-DECISION-002: every entry has id (string) and statement (string)', () => {
    const fixture = buildCoordinatorFixture();
    const result = buildGovernanceReport(fixture, { input: 'test-fixture' });
    const digest = result.report.subject.decision_digest;
    for (const d of digest) {
      assert.ok(typeof d.id === 'string' && d.id.length > 0, `id must be non-empty string, got ${d.id}`);
      assert.ok(typeof d.statement === 'string' && d.statement.length > 0, `statement must be non-empty string`);
    }
  });

  // AT-COORD-DECISION-006: entries without id are filtered out
  it('AT-COORD-DECISION-006: entries without id field are filtered out', () => {
    const fixture = buildCoordinatorFixture();
    // Add a governance event entry without an id field
    const currentData = fixture.files['.agentxchain/multirepo/decision-ledger.jsonl'].data;
    const withGovernanceEvent = [
      ...currentData,
      { decision: 'conflict_detected', timestamp: '2026-04-06T19:12:00.000Z', turn_id: 'turn_003' },
    ];
    fixture.files['.agentxchain/multirepo/decision-ledger.jsonl'] = jsonlFileEntry(withGovernanceEvent);
    fixture.summary.decision_entries = withGovernanceEvent.length;

    const result = buildGovernanceReport(fixture, { input: 'test-fixture' });
    assert.ok(result.ok);
    const digest = result.report.subject.decision_digest;
    assert.equal(digest.length, 2, 'governance event without id is filtered out');
    assert.ok(digest.every((d) => typeof d.id === 'string'));
  });

  // AT-COORD-DECISION-005: absent ledger omits section
  it('AT-COORD-DECISION-005: absent decision-ledger omits section in text', () => {
    const fixture = buildCoordinatorFixture();
    delete fixture.files['.agentxchain/multirepo/decision-ledger.jsonl'];
    fixture.summary.decision_entries = 0;
    const result = buildGovernanceReport(fixture, { input: 'test-fixture' });
    assert.ok(result.ok);
    const digest = result.report.subject.decision_digest;
    assert.equal(digest.length, 0);

    const text = formatGovernanceReportText(result.report);
    assert.ok(!text.includes('Coordinator Decisions:'), 'no coordinator decisions section when absent');
  });

  it('absent decision-ledger omits section in markdown', () => {
    const fixture = buildCoordinatorFixture();
    delete fixture.files['.agentxchain/multirepo/decision-ledger.jsonl'];
    fixture.summary.decision_entries = 0;
    const result = buildGovernanceReport(fixture, { input: 'test-fixture' });
    assert.ok(result.ok);
    const md = formatGovernanceReportMarkdown(result.report);
    assert.ok(!md.includes('## Coordinator Decisions'), 'no coordinator decisions section when absent');
  });
});

// AT-COORD-DECISION-003/004: text and markdown rendering
describe('coordinator report narrative — decision digest rendering', () => {
  it('AT-COORD-DECISION-003: text output includes Coordinator Decisions section', () => {
    const fixture = buildCoordinatorFixture();
    const result = buildGovernanceReport(fixture, { input: 'test-fixture' });
    const text = formatGovernanceReportText(result.report);

    assert.match(text, /Coordinator Decisions:/);
    assert.match(text, /DEC-COORD-001 \(pm, planning\): Dispatch to api before web/);
    assert.match(text, /DEC-COORD-002 \(dev, implementation\): Use shared auth middleware/);
  });

  it('AT-COORD-DECISION-004: markdown output includes Coordinator Decisions section', () => {
    const fixture = buildCoordinatorFixture();
    const result = buildGovernanceReport(fixture, { input: 'test-fixture' });
    const md = formatGovernanceReportMarkdown(result.report);

    assert.match(md, /## Coordinator Decisions/);
    assert.match(md, /\*\*DEC-COORD-001\*\*/);
    assert.match(md, /\(pm, planning phase\)/);
    assert.match(md, /Dispatch to api before web/);
    assert.match(md, /\*\*DEC-COORD-002\*\*/);
    assert.match(md, /\(dev, implementation phase\)/);
    assert.match(md, /shared auth middleware/);
  });
});

// Spec guard
describe('coordinator report narrative spec', () => {
  it('spec file exists and is current', () => {
    const specPath = join(__dirname, '..', '..', '.planning', 'COORDINATOR_REPORT_NARRATIVE_SPEC.md');
    const spec = readFileSync(specPath, 'utf8');
    assert.match(spec, /Coordinator Report Narrative/);
    assert.match(spec, /AT-COORD-REPORT-001/);
    assert.match(spec, /AT-COORD-REPORT-007/);
    assert.match(spec, /coordinator_timeline/);
    assert.match(spec, /barrier_summary/);
  });

  it('timing spec exists and is current', () => {
    const specPath = join(__dirname, '..', '..', '.planning', 'COORDINATOR_REPORT_TIMING_SPEC.md');
    const spec = readFileSync(specPath, 'utf8');
    assert.match(spec, /Coordinator Report Timing Spec/);
    assert.match(spec, /AT-COORD-TIME-001/);
    assert.match(spec, /AT-COORD-TIME-006/);
    assert.match(spec, /created_at/);
    assert.match(spec, /duration_seconds/);
  });

  // AT-BARRIER-LEDGER-007: barrier-ledger spec guard
  it('barrier-ledger narrative spec exists and is current', () => {
    const specPath = join(__dirname, '..', '..', '.planning', 'COORDINATOR_BARRIER_LEDGER_NARRATIVE_SPEC.md');
    const spec = readFileSync(specPath, 'utf8');
    assert.match(spec, /Barrier-Ledger Narrative/);
    assert.match(spec, /AT-BARRIER-LEDGER-001/);
    assert.match(spec, /AT-BARRIER-LEDGER-007/);
    assert.match(spec, /barrier_ledger_timeline/);
    assert.match(spec, /barrier_transition/);
  });

  // AT-COORD-DECISION-007: decision-digest spec guard
  it('decision-digest spec exists and is current', () => {
    const specPath = join(__dirname, '..', '..', '.planning', 'COORDINATOR_DECISION_DIGEST_SPEC.md');
    const spec = readFileSync(specPath, 'utf8');
    assert.match(spec, /Coordinator Decision Digest/);
    assert.match(spec, /AT-COORD-DECISION-001/);
    assert.match(spec, /AT-COORD-DECISION-007/);
    assert.match(spec, /decision_digest/);
    assert.match(spec, /decision-ledger\.jsonl/);
  });

  it('action-guidance spec exists and is current', () => {
    const specPath = join(__dirname, '..', '..', '.planning', 'COORDINATOR_REPORT_ACTIONS_SPEC.md');
    const spec = readFileSync(specPath, 'utf8');
    assert.match(spec, /Action Guidance Spec/);
    assert.match(spec, /AT-COORD-ACT-001/);
    assert.match(spec, /AT-COORD-ACT-006/);
    assert.match(spec, /blocked_reason/);
    assert.match(spec, /next_actions/);
  });
});

function textFileEntry(content) {
  const buf = Buffer.from(content, 'utf8');
  return {
    format: 'text',
    data: content,
    bytes: buf.length,
    sha256: createHash('sha256').update(buf).digest('hex'),
    content_base64: buf.toString('base64'),
  };
}

describe('coordinator report narrative — recovery_report rendering', () => {
  const RECOVERY_REPORT_CONTENT = `# Recovery Report

Coordinator entered blocked state.

**Blocked reason:** hook violation in api repo
**Blocked at:** 2026-04-06T19:18:00.000Z

## Trigger

Post-acceptance hook on api detected tampered barrier file.

## Impact

Web repo turn was in-flight and had to be abandoned. Api repo turn was accepted but barrier state was inconsistent.

## Mitigation

Operator manually restored barriers.json from the last known-good coordinator snapshot and verified child repo states matched.

## Owner

ops-team-lead

## Exit Condition

All child repos must be in completed or active state with no blocked children.
`;

  const RECOVERY_REPORT_NO_OPTIONAL = `# Recovery Report

**Blocked reason:** resync divergence
**Blocked at:** 2026-04-06T19:18:00.000Z

## Trigger

Ambiguous divergence during resync.

## Impact

Coordinator could not determine authoritative state.

## Mitigation

Operator re-ran multi resume after manual inspection.
`;

  // AT-RR-RENDER-001: no recovery report → recovery_report is null
  it('AT-RR-RENDER-001: absent recovery report produces null in report subject', () => {
    const fixture = buildCoordinatorFixture();
    const result = buildGovernanceReport(fixture, { input: 'test-fixture' });
    assert.ok(result.ok, 'report built successfully');
    assert.strictEqual(result.report.subject.recovery_report, null);
  });

  // AT-RR-RENDER-002: present recovery report extracts sections
  it('AT-RR-RENDER-002: present recovery report extracts all sections', () => {
    const fixture = buildCoordinatorFixture();
    fixture.files['.agentxchain/multirepo/RECOVERY_REPORT.md'] = textFileEntry(RECOVERY_REPORT_CONTENT);
    const result = buildGovernanceReport(fixture, { input: 'test-fixture' });
    assert.ok(result.ok, 'report built successfully');

    const rr = result.report.subject.recovery_report;
    assert.ok(rr, 'recovery_report is present');
    assert.strictEqual(rr.present, true);
    assert.match(rr.trigger, /tampered barrier file/);
    assert.match(rr.impact, /Web repo turn was in-flight/);
    assert.match(rr.mitigation, /restored barriers\.json/);
    assert.match(rr.owner, /ops-team-lead/);
    assert.match(rr.exit_condition, /no blocked children/);
  });

  // AT-RR-RENDER-003: text format includes Recovery Report section
  it('AT-RR-RENDER-003: text format renders recovery report section', () => {
    const fixture = buildCoordinatorFixture();
    fixture.files['.agentxchain/multirepo/RECOVERY_REPORT.md'] = textFileEntry(RECOVERY_REPORT_CONTENT);
    const result = buildGovernanceReport(fixture, { input: 'test-fixture' });
    const text = formatGovernanceReportText(result.report);
    assert.match(text, /Recovery Report:/);
    assert.match(text, /Trigger: Post-acceptance hook/);
    assert.match(text, /Impact: Web repo turn/);
    assert.match(text, /Mitigation: Operator manually restored/);
    assert.match(text, /Owner: ops-team-lead/);
    assert.match(text, /Exit Condition: All child repos/);
  });

  // AT-RR-RENDER-004: markdown format includes ## Recovery Report section
  it('AT-RR-RENDER-004: markdown format renders recovery report section', () => {
    const fixture = buildCoordinatorFixture();
    fixture.files['.agentxchain/multirepo/RECOVERY_REPORT.md'] = textFileEntry(RECOVERY_REPORT_CONTENT);
    const result = buildGovernanceReport(fixture, { input: 'test-fixture' });
    const md = formatGovernanceReportMarkdown(result.report);
    assert.match(md, /## Recovery Report/);
    assert.match(md, /\*\*Trigger:\*\* Post-acceptance hook/);
    assert.match(md, /\*\*Impact:\*\* Web repo turn/);
    assert.match(md, /\*\*Mitigation:\*\* Operator manually restored/);
    assert.match(md, /\*\*Owner:\*\* ops-team-lead/);
    assert.match(md, /\*\*Exit Condition:\*\* All child repos/);
  });

  // AT-RR-RENDER-005: missing optional sections render as n/a
  it('AT-RR-RENDER-005: missing optional sections render as n/a', () => {
    const fixture = buildCoordinatorFixture();
    fixture.files['.agentxchain/multirepo/RECOVERY_REPORT.md'] = textFileEntry(RECOVERY_REPORT_NO_OPTIONAL);
    const result = buildGovernanceReport(fixture, { input: 'test-fixture' });

    const rr = result.report.subject.recovery_report;
    assert.ok(rr, 'recovery_report present');
    assert.strictEqual(rr.owner, null);
    assert.strictEqual(rr.exit_condition, null);

    const text = formatGovernanceReportText(result.report);
    assert.match(text, /Owner: n\/a/);
    assert.match(text, /Exit Condition: n\/a/);

    const md = formatGovernanceReportMarkdown(result.report);
    assert.match(md, /\*\*Owner:\*\* n\/a/);
    assert.match(md, /\*\*Exit Condition:\*\* n\/a/);
  });

  // AT-RR-RENDER-001 complement: absent report means no Recovery Report section in text/md
  it('absent recovery report omits section from text and markdown', () => {
    const fixture = buildCoordinatorFixture();
    const result = buildGovernanceReport(fixture, { input: 'test-fixture' });
    const text = formatGovernanceReportText(result.report);
    const md = formatGovernanceReportMarkdown(result.report);
    assert.ok(!text.includes('Recovery Report:'), 'text must not include Recovery Report section');
    assert.ok(!md.includes('## Recovery Report'), 'markdown must not include Recovery Report section');
  });

  // AT-RR-RENDER-006: spec guard
  it('AT-RR-RENDER-006: recovery report rendering spec exists and is current', () => {
    const specPath = join(__dirname, '..', '..', '.planning', 'RECOVERY_REPORT_RENDERING_SPEC.md');
    const spec = readFileSync(specPath, 'utf8');
    assert.match(spec, /Recovery Report Rendering Spec/);
    assert.match(spec, /AT-RR-RENDER-001/);
    assert.match(spec, /AT-RR-RENDER-006/);
    assert.match(spec, /extractRecoveryReportSummary/);
    assert.match(spec, /RECOVERY_REPORT\.md/);
  });
});
