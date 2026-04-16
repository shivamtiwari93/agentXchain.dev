/**
 * Workflow-kit dashboard observation tests.
 *
 * Tests the server-side computed endpoint (readWorkflowKitArtifacts) and
 * the pure render component (artifacts panel). Covers acceptance tests
 * AT-WKDASH-001 through AT-WKDASH-011 from WORKFLOW_KIT_DASHBOARD_SPEC.md.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { readWorkflowKitArtifacts } from '../src/lib/dashboard/workflow-kit-artifacts.js';
import { render as renderArtifacts } from '../dashboard/components/artifacts.js';

const WORKFLOW_KIT_SPEC = new URL('../../.planning/WORKFLOW_KIT_DASHBOARD_SPEC.md', import.meta.url);

const BASE_CONFIG = {
  version: 3,
  project: 'test-project',
  agents: { pm: { name: 'PM', mandate: 'Plan' }, dev: { name: 'Dev', mandate: 'Build' } },
  roles: { pm: {}, dev: {} },
  routing: { planning: { entry_role: 'pm' }, implementation: { entry_role: 'dev' }, qa: { entry_role: 'pm' } },
};

const GOVERNED_BASE_CONFIG = {
  schema_version: '1.0',
  protocol_mode: 'governed',
  template: 'enterprise-app',
  project: {
    id: 'enterprise-test',
    name: 'Enterprise Test',
    default_branch: 'main',
  },
  roles: {
    pm: { title: 'PM', mandate: 'Plan', write_authority: 'review_only', runtime: 'manual-pm' },
    architect: { title: 'Architect', mandate: 'Design', write_authority: 'review_only', runtime: 'manual-architect' },
  },
  runtimes: {
    'manual-pm': { type: 'manual' },
    'manual-architect': { type: 'manual' },
  },
  routing: {
    planning: { entry_role: 'pm', allowed_next_roles: ['pm', 'architect', 'human'], exit_gate: 'planning_signoff' },
    architecture: { entry_role: 'architect', allowed_next_roles: ['architect', 'human'], exit_gate: 'architecture_review' },
  },
  gates: {
    planning_signoff: { requires_files: ['.planning/PM_SIGNOFF.md'] },
    architecture_review: { requires_files: ['.planning/ARCHITECTURE.md'] },
  },
  prompts: {
    pm: '# PM',
    architect: '# Architect',
  },
  rules: {
    challenge_required: true,
    max_turn_retries: 2,
    max_deadlock_cycles: 2,
  },
};

function makeTempWorkspace({ config, state, files = [] }) {
  const dir = mkdtempSync(join(tmpdir(), 'wk-dash-'));
  if (config) {
    writeFileSync(join(dir, 'agentxchain.json'), JSON.stringify({ ...BASE_CONFIG, ...config }, null, 2));
  }
  if (state) {
    const normalizedState = {
      schema_version: '1.1',
      run_id: 'run_001',
      project_id: 'test-project',
      status: 'active',
      phase: 'planning',
      active_turns: {},
      turn_sequence: 0,
      phase_gate_status: {},
      budget_reservations: {},
      budget_status: { spent_usd: 0, remaining_usd: 50 },
      ...state,
    };
    mkdirSync(join(dir, '.agentxchain'), { recursive: true });
    writeFileSync(join(dir, '.agentxchain', 'state.json'), JSON.stringify(normalizedState, null, 2));
  }
  for (const f of files) {
    const full = join(dir, f);
    mkdirSync(join(full, '..'), { recursive: true });
    writeFileSync(full, '# placeholder\n');
  }
  return dir;
}

// ── Server-side endpoint tests ────────────────────────────────────────────

describe('readWorkflowKitArtifacts', () => {
  // AT-WKDASH-009
  it('returns 404 when config missing', () => {
    const dir = mkdtempSync(join(tmpdir(), 'wk-dash-'));
    const result = readWorkflowKitArtifacts(dir);
    assert.equal(result.status, 404);
    assert.equal(result.body.code, 'config_missing');
  });

  it('returns 404 when state missing', () => {
    const dir = makeTempWorkspace({ config: {} });
    const result = readWorkflowKitArtifacts(dir);
    assert.equal(result.status, 404);
    assert.equal(result.body.code, 'state_missing');
  });

  it('returns artifacts null when no workflow_kit configured', () => {
    const dir = makeTempWorkspace({
      config: {},
      state: { schema_version: '1.1', run_id: 'run_001', status: 'active', phase: 'planning' },
    });
    const result = readWorkflowKitArtifacts(dir);
    assert.equal(result.status, 200);
    assert.equal(result.body.ok, true);
    assert.equal(result.body.artifacts, null);
  });

  it('returns empty array when phase has no artifacts', () => {
    const dir = makeTempWorkspace({
      config: {
        workflow_kit: { phases: { qa: { artifacts: [] } } },
      },
      state: { schema_version: '1.1', run_id: 'run_001', status: 'active', phase: 'planning' },
    });
    const result = readWorkflowKitArtifacts(dir);
    assert.equal(result.status, 200);
    assert.deepEqual(result.body.artifacts, []);
  });

  // AT-WKDASH-008
  it('returns correct shape with all fields', () => {
    const dir = makeTempWorkspace({
      config: {
        workflow_kit: {
          phases: {
            planning: {
              artifacts: [
                { path: '.planning/SYSTEM_SPEC.md', required: true, semantics: 'system_spec', owned_by: 'pm' },
                { path: '.planning/PM_SIGNOFF.md', required: true, semantics: 'pm_signoff' },
              ],
            },
          },
        },
      },
      state: { schema_version: '1.1', run_id: 'run_001', status: 'active', phase: 'planning' },
      files: ['.planning/SYSTEM_SPEC.md'],
    });
    const result = readWorkflowKitArtifacts(dir);
    assert.equal(result.status, 200);
    assert.equal(result.body.ok, true);
    assert.equal(result.body.phase, 'planning');
    assert.equal(result.body.artifacts.length, 2);

    const spec = result.body.artifacts.find((a) => a.path === '.planning/SYSTEM_SPEC.md');
    assert.ok(spec);
    assert.equal(spec.required, true);
    assert.equal(spec.semantics, 'system_spec');
    assert.equal(spec.owned_by, 'pm');
    assert.equal(spec.owner_resolution, 'explicit');
    assert.equal(spec.exists, true);

    const signoff = result.body.artifacts.find((a) => a.path === '.planning/PM_SIGNOFF.md');
    assert.ok(signoff);
    assert.equal(signoff.owned_by, 'pm'); // entry_role fallback
    assert.equal(signoff.owner_resolution, 'entry_role');
    assert.equal(signoff.exists, false);
  });

  it('accepts governed enterprise-app config via normalized project context', () => {
    const dir = makeTempWorkspace({
      config: {
        ...GOVERNED_BASE_CONFIG,
        workflow_kit: {
          phases: {
            architecture: {
              artifacts: [
                { path: '.planning/ARCHITECTURE.md', required: true, owned_by: 'architect' },
              ],
            },
          },
        },
      },
      state: { schema_version: '1.1', run_id: 'run_001', status: 'active', phase: 'architecture', active_turns: {} },
      files: ['.planning/ARCHITECTURE.md'],
    });
    const result = readWorkflowKitArtifacts(dir);
    assert.equal(result.status, 200);
    assert.equal(result.body.ok, true);
    assert.equal(result.body.phase, 'architecture');
    assert.deepEqual(result.body.artifacts, [
      {
        path: '.planning/ARCHITECTURE.md',
        required: true,
        semantics: null,
        owned_by: 'architect',
        owner_resolution: 'explicit',
        exists: true,
      },
    ]);
  });

  // AT-WKDASH-011
  it('sorts artifacts by path', () => {
    const dir = makeTempWorkspace({
      config: {
        workflow_kit: {
          phases: {
            planning: {
              artifacts: [
                { path: '.planning/Z_FILE.md' },
                { path: '.planning/A_FILE.md' },
                { path: '.planning/M_FILE.md' },
              ],
            },
          },
        },
      },
      state: { schema_version: '1.1', run_id: 'run_001', status: 'active', phase: 'planning' },
    });
    const result = readWorkflowKitArtifacts(dir);
    const paths = result.body.artifacts.map((a) => a.path);
    assert.deepEqual(paths, ['.planning/A_FILE.md', '.planning/M_FILE.md', '.planning/Z_FILE.md']);
  });
});

// ── Dashboard panel render tests ──────────────────────────────────────────

describe('Artifacts panel render', () => {
  // AT-WKDASH-005
  it('renders placeholder when no data available', () => {
    const html = renderArtifacts({ workflowKitArtifacts: null });
    assert.ok(html.includes('Workflow Artifacts'));
    assert.ok(html.includes('No workflow artifact data'));
  });

  it('renders placeholder on error response', () => {
    const html = renderArtifacts({ workflowKitArtifacts: { ok: false, code: 'state_missing', error: 'Run state not found.' } });
    assert.ok(html.includes('Run state not found'));
    assert.ok(html.includes('agentxchain init --governed'));
  });

  // AT-WKDASH-004
  it('renders placeholder when no workflow_kit configured (artifacts null)', () => {
    const html = renderArtifacts({ workflowKitArtifacts: { ok: true, phase: 'planning', artifacts: null } });
    assert.ok(html.includes('No'));
    assert.ok(html.includes('workflow_kit'));
    assert.ok(html.includes('agentxchain.json'));
  });

  it('renders placeholder when phase has no artifacts', () => {
    const html = renderArtifacts({ workflowKitArtifacts: { ok: true, phase: 'planning', artifacts: [] } });
    assert.ok(html.includes('planning'));
    assert.ok(html.includes('no workflow-kit artifacts'));
  });

  // AT-WKDASH-001
  it('renders artifact table with correct columns', () => {
    const html = renderArtifacts({
      workflowKitArtifacts: {
        ok: true,
        phase: 'planning',
        artifacts: [
          { path: '.planning/SYSTEM_SPEC.md', required: true, semantics: 'system_spec', owned_by: 'pm', owner_resolution: 'explicit', exists: true },
        ],
      },
    });
    assert.ok(html.includes('<table'));
    assert.ok(html.includes('Path'));
    assert.ok(html.includes('Required'));
    assert.ok(html.includes('Semantics'));
    assert.ok(html.includes('Owner'));
    assert.ok(html.includes('Resolution'));
    assert.ok(html.includes('Status'));
    assert.ok(html.includes('.planning/SYSTEM_SPEC.md'));
    assert.ok(html.includes('system_spec'));
  });

  // AT-WKDASH-002
  it('renders exists/missing status with correct indicators', () => {
    const html = renderArtifacts({
      workflowKitArtifacts: {
        ok: true,
        phase: 'planning',
        artifacts: [
          { path: 'a.md', required: true, semantics: null, owned_by: 'pm', owner_resolution: 'entry_role', exists: true },
          { path: 'b.md', required: true, semantics: null, owned_by: 'pm', owner_resolution: 'entry_role', exists: false },
        ],
      },
    });
    assert.ok(html.includes('✓ exists'));
    assert.ok(html.includes('✗ missing'));
  });

  // AT-WKDASH-003
  it('highlights missing required artifacts', () => {
    const html = renderArtifacts({
      workflowKitArtifacts: {
        ok: true,
        phase: 'planning',
        artifacts: [
          { path: 'required-missing.md', required: true, semantics: null, owned_by: 'pm', owner_resolution: 'entry_role', exists: false },
          { path: 'optional-missing.md', required: false, semantics: null, owned_by: 'pm', owner_resolution: 'entry_role', exists: false },
        ],
      },
    });
    // Missing required gets red border
    assert.ok(html.includes('border-left:3px solid var(--red)'));
    assert.ok(html.includes('missing required'));
  });

  // AT-WKDASH-006
  it('shows explicit vs entry_role owner resolution', () => {
    const html = renderArtifacts({
      workflowKitArtifacts: {
        ok: true,
        phase: 'planning',
        artifacts: [
          { path: 'a.md', required: true, semantics: null, owned_by: 'pm', owner_resolution: 'explicit', exists: true },
          { path: 'b.md', required: true, semantics: null, owned_by: 'dev', owner_resolution: 'entry_role', exists: true },
        ],
      },
    });
    assert.ok(html.includes('explicit'));
    assert.ok(html.includes('entry_role'));
  });

  // AT-WKDASH-007
  it('shows current phase indicator', () => {
    const html = renderArtifacts({
      workflowKitArtifacts: {
        ok: true,
        phase: 'implementation',
        artifacts: [
          { path: 'a.md', required: true, semantics: null, owned_by: 'dev', owner_resolution: 'entry_role', exists: true },
        ],
      },
    });
    assert.ok(html.includes('implementation'));
    assert.ok(html.includes('Phase:'));
  });

  it('escapes HTML in artifact paths', () => {
    const html = renderArtifacts({
      workflowKitArtifacts: {
        ok: true,
        phase: 'planning',
        artifacts: [
          { path: '<script>alert(1)</script>', required: true, semantics: null, owned_by: 'pm', owner_resolution: 'entry_role', exists: false },
        ],
      },
    });
    assert.ok(!html.includes('<script>alert(1)</script>'));
    assert.ok(html.includes('&lt;script&gt;'));
  });
});

// ── Dashboard structure tests ─────────────────────────────────────────────

describe('Dashboard artifacts integration', () => {
  // AT-WKDASH-010
  it('dashboard nav includes Artifacts tab', async () => {
    const { readFileSync } = await import('node:fs');
    const { join: pjoin, dirname } = await import('node:path');
    const { fileURLToPath } = await import('node:url');

    const __dirname = dirname(fileURLToPath(import.meta.url));
    const repoRoot = pjoin(__dirname, '..', '..');

    const indexHtml = readFileSync(pjoin(repoRoot, 'cli', 'dashboard', 'index.html'), 'utf8');
    const navLinks = Array.from(indexHtml.matchAll(/<a href="#([^"]+)"[^>]*>([^<]+)<\/a>/g));
    const artifactsLink = navLinks.find(([, id]) => id === 'artifacts');
    assert.ok(artifactsLink, 'nav must include #artifacts link');

    const appJs = readFileSync(pjoin(repoRoot, 'cli', 'dashboard', 'app.js'), 'utf8');
    assert.ok(appJs.includes("artifacts: {"), 'app.js VIEWS must include artifacts entry');
    assert.ok(appJs.includes("workflowKitArtifacts: '/api/workflow-kit-artifacts'"), 'app.js API_MAP must include workflowKitArtifacts');
  });

  it('owning spec names the Artifacts view without stale ordinal shell claims', async () => {
    const { readFileSync } = await import('node:fs');
    const specSource = readFileSync(WORKFLOW_KIT_SPEC, 'utf8');
    assert.match(specSource, /Dashboard nav item: `Artifacts`/);
    assert.doesNotMatch(specSource, /9th view|9 views total/);
  });
});
