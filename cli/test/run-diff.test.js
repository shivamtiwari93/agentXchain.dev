import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI_BIN = join(__dirname, '..', 'bin', 'agentxchain.js');
const REPO_ROOT = join(__dirname, '..', '..');

function makeTmpDir() {
  const dir = join(tmpdir(), `run-diff-test-${randomBytes(6).toString('hex')}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function scaffoldProject(root) {
  mkdirSync(join(root, '.agentxchain'), { recursive: true });
  writeFileSync(join(root, 'agentxchain.json'), JSON.stringify({
    schema_version: '1.0',
    protocol_mode: 'governed',
    project: { id: 'test-proj', name: 'Test Project' },
    template: 'generic',
  }));
}

function writeRunHistory(root, entries) {
  const lines = entries.map((entry) => JSON.stringify(entry)).join('\n') + '\n';
  writeFileSync(join(root, '.agentxchain', 'run-history.jsonl'), lines);
}

function makeEntry(overrides = {}) {
  return {
    run_id: 'run_alpha_1234567890',
    status: 'completed',
    template: 'generic',
    total_turns: 2,
    decisions_count: 1,
    total_cost_usd: 0.05,
    budget_limit_usd: 1.5,
    duration_ms: 30_000,
    phases_completed: ['planning'],
    roles_used: ['dev'],
    gate_results: { planning_signoff: 'passed' },
    connector_used: 'local-dev',
    model_used: 'claude-sonnet',
    provenance: { trigger: 'manual', created_by: 'operator' },
    retrospective: { headline: 'Planning completed cleanly' },
    inheritance_snapshot: { recent_decisions: [], recent_accepted_turns: [] },
    recorded_at: '2026-04-12T23:00:00.000Z',
    ...overrides,
  };
}

function writeExportArtifact(path, artifact) {
  writeFileSync(path, JSON.stringify(artifact, null, 2));
  return path;
}

function makeRunExportArtifact(path, overrides = {}) {
  return writeExportArtifact(path, {
    schema_version: '0.3',
    export_kind: 'agentxchain_run_export',
    exported_at: '2026-04-15T11:00:00.000Z',
    project: {
      id: 'test-proj',
      name: 'Test Project',
      goal: 'Ship a governed diff surface',
      ...overrides.project,
    },
    summary: {
      run_id: 'run_export_alpha',
      status: 'completed',
      phase: 'implementation',
      provenance: { trigger: 'manual' },
      active_turn_ids: [],
      retained_turn_ids: [],
      history_entries: 2,
      decision_entries: 1,
      hook_audit_entries: 0,
      notification_audit_entries: 0,
      dispatch_artifact_files: 1,
      staging_artifact_files: 0,
      dashboard_session: { status: 'not_running' },
      delegation_summary: { total_delegations_issued: 1, delegation_chains: [] },
      repo_decisions: {
        active_count: 1,
        overridden_count: 0,
        active: [{ id: 'DEC-001' }],
        overridden: [],
      },
      ...overrides.summary,
    },
    ...overrides.root,
  });
}

function makeCoordinatorExportArtifact(path, overrides = {}) {
  return writeExportArtifact(path, {
    schema_version: '0.3',
    export_kind: 'agentxchain_coordinator_export',
    exported_at: '2026-04-15T11:00:00.000Z',
    coordinator: {
      project_id: 'coord-test',
      project_name: 'Coordinator Test',
      ...overrides.coordinator,
    },
    summary: {
      super_run_id: 'srun_alpha',
      status: 'completed',
      phase: 'implementation',
      barrier_count: 1,
      history_entries: 2,
      decision_entries: 1,
      repo_run_statuses: {
        web: 'completed',
        api: 'completed',
      },
      aggregated_events: {
        total_events: 4,
        repos_with_events: ['api', 'web'],
        event_type_counts: {
          run_started: 2,
          turn_accepted: 1,
          run_completed: 1,
        },
      },
      ...overrides.summary,
    },
    repos: {
      web: {
        ok: true,
        path: './repos/web',
        export: {
          summary: {
            status: 'completed',
            run_id: 'run_web_001',
            phase: 'implementation',
          },
        },
      },
      api: {
        ok: true,
        path: './repos/api',
        export: {
          summary: {
            status: 'completed',
            run_id: 'run_api_001',
            phase: 'implementation',
          },
        },
      },
      ...overrides.repos,
    },
    ...overrides.root,
  });
}

describe('agentxchain diff', () => {
  it('AT-RD-001: text mode compares two run-history entries', () => {
    const root = makeTmpDir();
    try {
      scaffoldProject(root);
      writeRunHistory(root, [
        makeEntry(),
        makeEntry({
          run_id: 'run_beta_9876543210',
          status: 'blocked',
          total_turns: 4,
          decisions_count: 3,
          total_cost_usd: 0.08,
          duration_ms: 45_000,
          phases_completed: ['planning', 'implementation'],
          roles_used: ['dev', 'qa'],
          gate_results: { planning_signoff: 'passed', implementation_complete: 'pending' },
          blocked_reason: 'Missing API key',
          provenance: { trigger: 'continuation', parent_run_id: 'run_alpha_1234567890', created_by: 'operator' },
          retrospective: {
            headline: 'Blocked on external credential',
            next_operator_action: 'agentxchain resume --dir ./project',
          },
          inheritance_snapshot: { recent_decisions: [{ id: 'DEC-001' }], recent_accepted_turns: [] },
          recorded_at: '2026-04-12T23:10:00.000Z',
        }),
      ]);

      const result = spawnSync(process.execPath, [CLI_BIN, 'diff', 'run_alpha_1234567890', 'run_beta_9876543210', '--dir', root], {
        env: { ...process.env, NO_COLOR: '1' },
        encoding: 'utf8',
        timeout: 10_000,
      });

      assert.equal(result.status, 0, result.stderr);
      assert.match(result.stdout, /Run Diff/);
      assert.match(result.stdout, /Comparison Summary/);
      assert.match(result.stdout, /Outcome: regressed/);
      assert.match(result.stdout, /Risk: high/);
      assert.match(result.stdout, /status worsened to blocked/);
      assert.match(result.stdout, /Status: completed -> blocked/);
      assert.match(result.stdout, /Next action: — -> agentxchain resume --dir \.\/project/);
      assert.match(result.stdout, /Trigger: manual -> continuation/);
      assert.match(result.stdout, /Turns: 2 -> 4 \(\+2\)/);
      assert.match(result.stdout, /Phases added: implementation/);
      assert.match(result.stdout, /Roles added: qa/);
      assert.match(result.stdout, /implementation_complete: — -> pending/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('AT-RD-002: --json returns structured diff output', () => {
    const root = makeTmpDir();
    try {
      scaffoldProject(root);
      writeRunHistory(root, [
        makeEntry(),
        makeEntry({ run_id: 'run_beta_9876543210', total_turns: 5, roles_used: ['dev', 'qa'] }),
      ]);

      const result = spawnSync(process.execPath, [CLI_BIN, 'diff', 'run_alpha_1234567890', 'run_beta_9876543210', '--json', '--dir', root], {
        env: { ...process.env },
        encoding: 'utf8',
        timeout: 10_000,
      });

      assert.equal(result.status, 0, result.stderr);
      const payload = JSON.parse(result.stdout);
      assert.equal(payload.left.run_id, 'run_alpha_1234567890');
      assert.equal(payload.right.run_id, 'run_beta_9876543210');
      assert.equal(payload.numeric_changes.total_turns.delta, 3);
      assert.deepEqual(payload.list_changes.roles_used.added, ['qa']);
      assert.equal(payload.summary.outcome, 'changed');
      assert.equal(payload.summary.risk_level, 'low');
      assert.ok(Array.isArray(payload.summary.highlights));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('AT-RD-003: unique prefixes resolve', () => {
    const root = makeTmpDir();
    try {
      scaffoldProject(root);
      writeRunHistory(root, [
        makeEntry(),
        makeEntry({ run_id: 'run_beta_9876543210' }),
      ]);

      const result = spawnSync(process.execPath, [CLI_BIN, 'diff', 'run_alpha', 'run_beta', '--json', '--dir', root], {
        env: { ...process.env },
        encoding: 'utf8',
        timeout: 10_000,
      });

      assert.equal(result.status, 0, result.stderr);
      const payload = JSON.parse(result.stdout);
      assert.equal(payload.left.run_id, 'run_alpha_1234567890');
      assert.equal(payload.right.run_id, 'run_beta_9876543210');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('AT-RD-004: ambiguous prefixes fail closed', () => {
    const root = makeTmpDir();
    try {
      scaffoldProject(root);
      writeRunHistory(root, [
        makeEntry({ run_id: 'run_same_prefix_a' }),
        makeEntry({ run_id: 'run_same_prefix_b' }),
      ]);

      const result = spawnSync(process.execPath, [CLI_BIN, 'diff', 'run_same_prefix', 'run_same_prefix_b', '--dir', root], {
        env: { ...process.env, NO_COLOR: '1' },
        encoding: 'utf8',
        timeout: 10_000,
      });

      assert.equal(result.status, 1);
      assert.match(result.stderr, /ambiguous/);
      assert.match(result.stderr, /run_same_prefix_a/);
      assert.match(result.stderr, /run_same_prefix_b/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('AT-ED-001: text mode compares two run export artifacts', () => {
    const root = makeTmpDir();
    try {
      const leftPath = makeRunExportArtifact(join(root, 'left-run-export.json'));
      const rightPath = makeRunExportArtifact(join(root, 'right-run-export.json'), {
        summary: {
          run_id: 'run_export_beta',
          status: 'blocked',
          phase: 'qa',
          dashboard_session: { status: 'running' },
          decision_entries: 3,
          delegation_summary: { total_delegations_issued: 3, delegation_chains: [] },
          repo_decisions: {
            active_count: 2,
            overridden_count: 1,
            active: [{ id: 'DEC-001' }, { id: 'DEC-002' }],
            overridden: [{ id: 'DEC-OLD' }],
          },
        },
      });

      const result = spawnSync(process.execPath, [CLI_BIN, 'diff', leftPath, rightPath, '--export'], {
        env: { ...process.env, NO_COLOR: '1' },
        encoding: 'utf8',
        timeout: 10_000,
      });

      assert.equal(result.status, 0, result.stderr);
      assert.match(result.stdout, /Export Diff/);
      assert.match(result.stdout, /Comparison Summary/);
      assert.match(result.stdout, /Outcome: regressed/);
      assert.match(result.stdout, /Risk: high/);
      assert.match(result.stdout, /REG-/);
      assert.match(result.stdout, /Status: completed -> blocked/);
      assert.match(result.stdout, /Phase: implementation -> qa/);
      assert.match(result.stdout, /Decision entries: 1 -> 3 \(\+2\)/);
      assert.match(result.stdout, /Delegations: 1 -> 3 \(\+2\)/);
      assert.match(result.stdout, /Dashboard: not_running -> running/);
      assert.match(result.stdout, /Active repo decisions added: DEC-002/);
      assert.match(result.stdout, /Overridden repo decisions added: DEC-OLD/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('AT-ED-002: --json --export returns structured run export diff output', () => {
    const root = makeTmpDir();
    try {
      const leftPath = makeRunExportArtifact(join(root, 'left-run-export.json'));
      const rightPath = makeRunExportArtifact(join(root, 'right-run-export.json'), {
        summary: {
          run_id: 'run_export_beta',
          phase: 'qa',
          decision_entries: 4,
          repo_decisions: {
            active_count: 2,
            overridden_count: 0,
            active: [{ id: 'DEC-001' }, { id: 'DEC-002' }],
            overridden: [],
          },
        },
      });

      const result = spawnSync(process.execPath, [CLI_BIN, 'diff', leftPath, rightPath, '--export', '--json'], {
        env: { ...process.env },
        encoding: 'utf8',
        timeout: 10_000,
      });

      assert.equal(result.status, 0, result.stderr);
      const payload = JSON.parse(result.stdout);
      assert.equal(payload.comparison_mode, 'export');
      assert.equal(payload.subject_kind, 'run');
      assert.equal(payload.left.run_id, 'run_export_alpha');
      assert.equal(payload.right.run_id, 'run_export_beta');
      assert.equal(payload.scalar_changes.phase.right, 'qa');
      assert.equal(payload.numeric_changes.decision_entries.delta, 3);
      assert.deepEqual(payload.list_changes.active_repo_decision_ids.added, ['DEC-002']);
      assert.equal(payload.summary.outcome, 'changed');
      assert.equal(payload.summary.risk_level, 'low');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('AT-ED-003: export mode compares coordinator artifacts with repo and event deltas', () => {
    const root = makeTmpDir();
    try {
      const leftPath = makeCoordinatorExportArtifact(join(root, 'left-coordinator-export.json'));
      const rightPath = makeCoordinatorExportArtifact(join(root, 'right-coordinator-export.json'), {
        summary: {
          super_run_id: 'srun_beta',
          barrier_count: 2,
          repo_run_statuses: {
            web: 'completed',
            api: 'blocked',
          },
          aggregated_events: {
            total_events: 6,
            repos_with_events: ['api', 'web'],
            event_type_counts: {
              run_started: 2,
              turn_accepted: 2,
              run_completed: 1,
              run_blocked: 1,
            },
          },
        },
        repos: {
          web: { ok: true, path: './repos/web' },
          api: { ok: false, path: './repos/api' },
        },
      });

      const result = spawnSync(process.execPath, [CLI_BIN, 'diff', leftPath, rightPath, '--export'], {
        env: { ...process.env, NO_COLOR: '1' },
        encoding: 'utf8',
        timeout: 10_000,
      });

      assert.equal(result.status, 0, result.stderr);
      assert.match(result.stdout, /Export Diff/);
      assert.match(result.stdout, /Barriers: 1 -> 2 \(\+1\)/);
      assert.match(result.stdout, /Repo status changes/);
      assert.match(result.stdout, /api: completed -> blocked/);
      assert.match(result.stdout, /Repo export changes/);
      assert.match(result.stdout, /api: yes -> no/);
      assert.match(result.stdout, /Event type deltas/);
      assert.match(result.stdout, /turn_accepted: 1 -> 2 \(\+1\)/);
      assert.match(result.stdout, /run_blocked: — -> 1/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('AT-RD-006: blocked_reason with gate-action timeout renders timeout evidence in text output', () => {
    const root = makeTmpDir();
    try {
      scaffoldProject(root);
      writeRunHistory(root, [
        makeEntry(),
        makeEntry({
          run_id: 'run_beta_9876543210',
          status: 'blocked',
          blocked_reason: {
            category: 'gate_action_failed',
            detail: 'Gate action timed out for "phase_transition": npm test',
            gate_action: {
              timed_out: true,
              timeout_ms: 5000,
              action_label: 'npm test',
              exit_code: null,
            },
          },
        }),
      ]);

      const result = spawnSync(process.execPath, [CLI_BIN, 'diff', 'run_alpha', 'run_beta', '--dir', root], {
        env: { ...process.env, NO_COLOR: '1' },
        encoding: 'utf8',
        timeout: 10_000,
      });

      assert.equal(result.status, 0, result.stderr);
      assert.match(result.stdout, /Blocked reason/);
      assert.match(result.stdout, /gate_action_failed/);
      assert.match(result.stdout, /timed out after 5000ms/);
      assert.match(result.stdout, /npm test/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('AT-RD-007: blocked_reason with generic gate-action failure shows exit code', () => {
    const root = makeTmpDir();
    try {
      scaffoldProject(root);
      writeRunHistory(root, [
        makeEntry(),
        makeEntry({
          run_id: 'run_beta_9876543210',
          status: 'blocked',
          blocked_reason: {
            category: 'gate_action_failed',
            detail: 'Gate action failed for "phase_transition": npm test',
            gate_action: {
              timed_out: false,
              timeout_ms: 900000,
              action_label: 'npm test',
              exit_code: 1,
            },
          },
        }),
      ]);

      const result = spawnSync(process.execPath, [CLI_BIN, 'diff', 'run_alpha', 'run_beta', '--dir', root], {
        env: { ...process.env, NO_COLOR: '1' },
        encoding: 'utf8',
        timeout: 10_000,
      });

      assert.equal(result.status, 0, result.stderr);
      assert.match(result.stdout, /Blocked reason/);
      assert.match(result.stdout, /gate_action_failed: npm test failed \(exit 1\)/);
      assert.doesNotMatch(result.stdout, /timed out/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('AT-COORD-TERM-SUM-001: completed coordinator child status drift summarizes as changed without governance regressions', () => {
    const root = makeTmpDir();
    try {
      const leftPath = makeCoordinatorExportArtifact(join(root, 'left-coordinator-export.json'));
      const rightPath = makeCoordinatorExportArtifact(join(root, 'right-coordinator-export.json'), {
        summary: {
          repo_run_statuses: {
            web: 'completed',
            api: 'failed',
          },
        },
        repos: {
          api: {
            ok: true,
            path: './repos/api',
            export: {
              summary: {
                status: 'failed',
                run_id: 'run_api_001',
                phase: 'implementation',
              },
            },
          },
        },
      });

      const result = spawnSync(process.execPath, [CLI_BIN, 'diff', leftPath, rightPath, '--export'], {
        env: { ...process.env, NO_COLOR: '1' },
        encoding: 'utf8',
        timeout: 10_000,
      });

      assert.equal(result.status, 0, result.stderr);
      assert.match(result.stdout, /Comparison Summary/);
      assert.match(result.stdout, /Outcome: changed/);
      assert.match(result.stdout, /Risk: low/);
      assert.doesNotMatch(result.stdout, /Governance Regressions:/);
      assert.match(result.stdout, /Repo status changes/);
      assert.match(result.stdout, /api: completed -> failed/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('AT-COORD-TERM-SUM-002: completed coordinator child export drift keeps JSON summary changed and low-risk', () => {
    const root = makeTmpDir();
    try {
      const leftPath = makeCoordinatorExportArtifact(join(root, 'left-coordinator-export.json'));
      const rightPath = makeCoordinatorExportArtifact(join(root, 'right-coordinator-export.json'), {
        repos: {
          web: { ok: true, path: './repos/web' },
          api: { ok: false, path: './repos/api' },
        },
      });

      const result = spawnSync(process.execPath, [CLI_BIN, 'diff', leftPath, rightPath, '--export', '--json'], {
        env: { ...process.env },
        encoding: 'utf8',
        timeout: 10_000,
      });

      assert.equal(result.status, 0, result.stderr);
      const payload = JSON.parse(result.stdout);
      assert.equal(payload.subject_kind, 'coordinator');
      assert.equal(payload.repo_export_changes.some((entry) => entry.key === 'api' && entry.changed), true);
      assert.equal(payload.has_regressions, false);
      assert.equal(payload.summary.outcome, 'changed');
      assert.equal(payload.summary.risk_level, 'low');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('AT-ED-003B: export mode json keeps authority-first repo status truth and preserves coordinator linkage metadata', () => {
    const root = makeTmpDir();
    try {
      const leftPath = makeCoordinatorExportArtifact(join(root, 'left-coordinator-export.json'), {
        summary: {
          status: 'active',
          repo_run_statuses: {
            web: 'completed',
            api: 'linked',
          },
        },
        repos: {
          api: {
            ok: true,
            path: './repos/api',
            export: {
              summary: {
                status: 'active',
                run_id: 'run_api_001',
                phase: 'implementation',
              },
            },
          },
        },
      });
      const rightPath = makeCoordinatorExportArtifact(join(root, 'right-coordinator-export.json'), {
        summary: {
          status: 'active',
          repo_run_statuses: {
            web: 'completed',
            api: 'active',
          },
        },
        repos: {
          api: {
            ok: true,
            path: './repos/api',
            export: {
              summary: {
                status: 'active',
                run_id: 'run_api_001',
                phase: 'implementation',
              },
            },
          },
        },
      });

      const result = spawnSync(process.execPath, [CLI_BIN, 'diff', leftPath, rightPath, '--export', '--json'], {
        env: { ...process.env },
        encoding: 'utf8',
        timeout: 10_000,
      });

      assert.equal(result.status, 0, result.stderr);
      const payload = JSON.parse(result.stdout);
      assert.equal(payload.left.repo_statuses.api, 'active');
      assert.equal(payload.left.coordinator_repo_statuses.api, 'linked');
      assert.equal(payload.right.coordinator_repo_statuses.api, 'active');
      assert.equal(payload.repo_status_changes.some((entry) => entry.key === 'api' && entry.changed), false);
      assert.equal(payload.summary.outcome, 'unchanged');
      assert.equal(payload.summary.risk_level, 'none');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('AT-ED-004: mixed export kinds fail closed', () => {
    const root = makeTmpDir();
    try {
      const runExportPath = makeRunExportArtifact(join(root, 'run-export.json'));
      const coordinatorExportPath = makeCoordinatorExportArtifact(join(root, 'coordinator-export.json'));

      const result = spawnSync(process.execPath, [CLI_BIN, 'diff', runExportPath, coordinatorExportPath, '--export'], {
        env: { ...process.env, NO_COLOR: '1' },
        encoding: 'utf8',
        timeout: 10_000,
      });

      assert.equal(result.status, 1);
      assert.match(result.stderr, /Export kinds do not match/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('run diff docs contract', () => {
  const CLI_DOCS = readFileSync(join(REPO_ROOT, 'website-v2', 'docs', 'cli.mdx'), 'utf8');

  it('AT-RD-005 / AT-ED-005: cli docs map and section document diff truthfully', () => {
    assert.match(CLI_DOCS, /\| `diff` \| Observability \| Compare two recorded governed runs or export artifacts and summarize what changed \|/);
    assert.match(CLI_DOCS, /### `diff`/);
    assert.match(CLI_DOCS, /agentxchain diff <left_ref> <right_ref> \[--json\] \[--dir <path>\]/);
    assert.match(CLI_DOCS, /agentxchain diff <left_export\.json> <right_export\.json> --export \[--json\]/);
    assert.match(CLI_DOCS, /full run IDs or unique prefixes/i);
    assert.match(CLI_DOCS, /`--export` switches the command into artifact comparison mode/i);
    assert.match(CLI_DOCS, /ambiguous prefixes fail closed/i);
    assert.match(CLI_DOCS, /authority-first child repo-status/i);
    assert.match(CLI_DOCS, /authority-first child repo status/i);
    assert.match(CLI_DOCS, /summary\.repo_run_statuses[\s\S]*raw coordinator snapshot metadata only/i);
    assert.match(CLI_DOCS, /coordinator_repo_statuses/);
    assert.match(CLI_DOCS, /Comparison Summary/i);
    assert.match(CLI_DOCS, /Outcome: `unchanged \| improved \| changed \| regressed \| mixed`/);
    assert.match(CLI_DOCS, /Risk: `none \| low \| medium \| high`/);
    assert.match(CLI_DOCS, /child repo drift stays visible in the repo-change sections/i);
    assert.match(CLI_DOCS, /Comparison Summary` stays `changed` \/ `low` instead of `regressed`/i);
  });
});
