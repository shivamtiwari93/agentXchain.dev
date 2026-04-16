/**
 * Dashboard docs contract verification.
 *
 * The dashboard section on /docs/cli must match the shipped dashboard command
 * and SPA surface. This test reads the docs plus runtime files directly so
 * docs drift fails fast in-repo.
 *
 * See: DASHBOARD_DOCS_CONTRACT_SPEC.md
 */

import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..', '..');

const CLI_DOCS = readFileSync(join(REPO_ROOT, 'website-v2', 'docs', 'cli.mdx'), 'utf8');
const CLI_BIN = readFileSync(join(REPO_ROOT, 'cli', 'bin', 'agentxchain.js'), 'utf8');
const DASHBOARD_COMMAND = readFileSync(join(REPO_ROOT, 'cli', 'src', 'commands', 'dashboard.js'), 'utf8');
const BRIDGE_SERVER = readFileSync(join(REPO_ROOT, 'cli', 'src', 'lib', 'dashboard', 'bridge-server.js'), 'utf8');
const STATE_READER = readFileSync(join(REPO_ROOT, 'cli', 'src', 'lib', 'dashboard', 'state-reader.js'), 'utf8');
const DASHBOARD_APP = readFileSync(join(REPO_ROOT, 'cli', 'dashboard', 'app.js'), 'utf8');
const DASHBOARD_INDEX = readFileSync(join(REPO_ROOT, 'cli', 'dashboard', 'index.html'), 'utf8');
const CLI_README = readFileSync(join(REPO_ROOT, 'cli', 'README.md'), 'utf8');
const ROOT_README = readFileSync(join(REPO_ROOT, 'README.md'), 'utf8');
const DASHBOARD_CONTINUITY_SPEC = readFileSync(join(REPO_ROOT, '.planning', 'DASHBOARD_CONTINUITY_SURFACE_SPEC.md'), 'utf8');
const CONTINUITY_ACTIONABILITY_SPEC = readFileSync(join(REPO_ROOT, '.planning', 'CONTINUITY_ACTIONABILITY_SPEC.md'), 'utf8');
const DASHBOARD_DAEMON_SPEC = readFileSync(join(REPO_ROOT, '.planning', 'DASHBOARD_DAEMON_SPEC.md'), 'utf8');
const RUNTIME_PARITY_SPEC = readFileSync(join(REPO_ROOT, '.planning', 'RUNTIME_BLOCKED_DASHBOARD_AUDIT_PARITY_SPEC.md'), 'utf8');
const COORDINATOR_ACTION_PARITY_SPEC = readFileSync(join(REPO_ROOT, '.planning', 'COORDINATOR_BLOCKED_ACTION_PARITY_SPEC.md'), 'utf8');
const COORDINATOR_NEXT_ACTION_REPO_STATUS_SPEC = readFileSync(join(REPO_ROOT, '.planning', 'COORDINATOR_NEXT_ACTION_REPO_STATUS_SPEC.md'), 'utf8');
const COORDINATOR_DASHBOARD_REPO_STATUS_SPEC = readFileSync(join(REPO_ROOT, '.planning', 'COORDINATOR_DASHBOARD_REPO_STATUS_SPEC.md'), 'utf8');
const COORDINATOR_DASHBOARD_TIMEOUT_REPO_STATUS_SPEC = readFileSync(join(REPO_ROOT, '.planning', 'COORDINATOR_DASHBOARD_TIMEOUT_REPO_STATUS_SPEC.md'), 'utf8');
const INITIATIVE_HIERARCHY_SPEC = readFileSync(join(REPO_ROOT, '.planning', 'INITIATIVE_VIEW_HIERARCHY_SPEC.md'), 'utf8');
const COORDINATOR_BLOCKER_PRESENTATION_SPEC = readFileSync(join(REPO_ROOT, '.planning', 'COORDINATOR_BLOCKER_PRESENTATION_SHARED_SPEC.md'), 'utf8');
const COORDINATOR_GATE_EVALUATION_PRESENTATION_SPEC = readFileSync(join(REPO_ROOT, '.planning', 'COORDINATOR_GATE_EVALUATION_PRESENTATION_SPEC.md'), 'utf8');
const LIVE_OBSERVER_SPEC = readFileSync(join(REPO_ROOT, '.planning', 'DASHBOARD_LIVE_OBSERVER_SPEC.md'), 'utf8');
const DASHBOARD_DOCS_SPEC = readFileSync(join(REPO_ROOT, '.planning', 'DASHBOARD_DOCS_CONTRACT_SPEC.md'), 'utf8');

function extractNavViews(html) {
  return Array.from(
    html.matchAll(/<a href="#([^"]+)"[^>]*>([^<]+)<\/a>/g),
    ([, id, label]) => ({ id, label }),
  );
}

function extractViewIds(appSource) {
  const match = appSource.match(/const VIEWS = \{([\s\S]*?)\n\};/);
  assert.ok(match, 'app.js must define a VIEWS registry');
  return Array.from(
    match[1].matchAll(/^\s{2}(?:'([^']+)'|([a-z][a-z-]*))\s*:/gm),
    ([, quoted, bare]) => quoted || bare,
  );
}

describe('Dashboard docs contract — command surface', () => {
  it('documents the real command and flags', () => {
    assert.ok(CLI_DOCS.includes('## Dashboard'), 'cli docs must have a dashboard section');
    assert.ok(CLI_DOCS.includes('agentxchain dashboard [options]'), 'cli docs must show the dashboard command');
    assert.ok(CLI_DOCS.includes('--port <port>'), 'cli docs must document --port');
    assert.ok(CLI_DOCS.includes('`3847`'), 'cli docs must document the real default port');
    assert.ok(CLI_DOCS.includes('--daemon'), 'cli docs must document --daemon');
    assert.ok(CLI_DOCS.includes('--no-open'), 'cli docs must document --no-open');
    assert.ok(!CLI_DOCS.includes('--host <addr>'), 'cli docs must not advertise unsupported --host');
  });

  it('matches the actual dashboard CLI implementation', () => {
    assert.ok(CLI_BIN.includes(".command('dashboard')"), 'CLI must register dashboard command');
    assert.ok(CLI_BIN.includes(".option('--port <port>'"), 'CLI must expose --port');
    assert.ok(CLI_BIN.includes(".option('--daemon'"), 'CLI must expose --daemon');
    assert.ok(CLI_BIN.includes(".option('--no-open'"), 'CLI must expose --no-open');
    assert.ok(!CLI_BIN.includes(".option('--host"), 'CLI must not expose a host flag');
    assert.ok(DASHBOARD_COMMAND.includes('const DEFAULT_PORT = 3847;'), 'dashboard command must default to 3847');
    assert.ok(DASHBOARD_COMMAND.includes('.agentxchain-dashboard.pid'), 'dashboard command must persist a PID file');
    assert.ok(DASHBOARD_COMMAND.includes('.agentxchain-dashboard.json'), 'dashboard command must persist session metadata');
  });

  it('documents the local-only gate-approval bridge contract', () => {
    assert.ok(CLI_DOCS.includes('127.0.0.1'), 'cli docs must state local-only binding');
    assert.ok(CLI_DOCS.includes('http://localhost:<port>'), 'cli docs must describe the printed local URL');
    assert.ok(CLI_DOCS.includes('approve-completion'), 'cli docs must mention repo completion approval');
    assert.ok(CLI_DOCS.includes('X-AgentXchain-Token'), 'cli docs must document the local mutation token boundary');
    assert.ok(CLI_DOCS.includes('/api/coordinator/blockers'), 'cli docs must document the coordinator blockers endpoint');
    assert.ok(CLI_DOCS.includes('/api/coordinator/repo-status'), 'cli docs must document the coordinator repo-status endpoint');
    assert.ok(CLI_DOCS.includes('/api/coordinator/ledger'), 'cli docs must document the coordinator ledger endpoint');
    assert.ok(CLI_DOCS.includes('/api/repo-decisions-summary'), 'cli docs must document the repo decision summary endpoint');
    assert.ok(CLI_DOCS.includes('/api/continuity'), 'cli docs must document the continuity endpoint');
    assert.ok(CLI_DOCS.includes('repo_run_id_mismatch'), 'cli docs must mention structured run identity drift blockers');
    assert.ok(CLI_DOCS.includes('SESSION_RECOVERY.md'), 'cli docs must mention the recovery report continuity surface');
    assert.ok(CLI_DOCS.includes('agentxchain restart'), 'cli docs must mention restart guidance in the dashboard surface');
    assert.ok(CLI_DOCS.includes('step --resume'), 'cli docs must document that blocked recovery remains CLI-only');
    assert.ok(BRIDGE_SERVER.includes("server.listen(port, '127.0.0.1'"), 'bridge server must bind to 127.0.0.1');
    assert.ok(BRIDGE_SERVER.includes('/api/actions/approve-gate'), 'bridge server must expose the approve-gate endpoint');
    assert.ok(BRIDGE_SERVER.includes('/api/coordinator/blockers'), 'bridge server must expose the coordinator blockers endpoint');
    assert.ok(BRIDGE_SERVER.includes('/api/coordinator/repo-status'), 'bridge server must expose the coordinator repo-status endpoint');
    assert.ok(BRIDGE_SERVER.includes('/api/workflow-kit-artifacts'), 'bridge server must expose the workflow-kit artifacts endpoint');
    assert.ok(STATE_READER.includes('/api/continuity'), 'dashboard state reader must expose the continuity endpoint');
    assert.ok(BRIDGE_SERVER.includes('X-AgentXchain-Token'), 'bridge server must validate the dashboard mutation token');
    assert.ok(BRIDGE_SERVER.includes('Dashboard WebSocket is read-only'), 'websocket must remain read-only');
  });

  it('keeps the live dashboard distinct from replay export and other artifact surfaces', () => {
    assert.ok(CLI_DOCS.includes('`agentxchain dashboard` is the live current repo/workspace dashboard'), 'cli docs must state dashboard is live-state');
    assert.ok(CLI_DOCS.includes('`agentxchain replay export <export.json>`'), 'cli docs must point artifact-backed dashboard users to replay export');
    assert.ok(CLI_DOCS.includes('`audit` inspects the live repo/workspace'), 'cli docs must keep audit distinct from dashboard');
    assert.ok(CLI_DOCS.includes('`report --input` renders a derived document from an existing verified artifact'), 'cli docs must keep report distinct from dashboard');
    assert.ok(CLI_DOCS.includes('`replay export` opens that existing artifact in the read-only dashboard'), 'cli docs must keep replay distinct from live dashboard');
    assert.ok(CLI_DOCS.includes('repo_ok_count') && CLI_DOCS.includes('repo_error_count'), 'cli docs must keep partial coordinator export-health visible');
    assert.ok(CLI_DOCS.includes('placeholder governed repo'), 'cli docs must describe replay placeholder child repos for failed nested exports');
    assert.ok(CLI_DOCS.includes('`dashboard` itself never reads the saved artifact'), 'cli docs must forbid treating live dashboard as artifact replay');
  });
});

describe('Dashboard docs contract — view surface', () => {
  const navViews = extractNavViews(DASHBOARD_INDEX);
  const viewIds = extractViewIds(DASHBOARD_APP);

  it('documents every shipped top-level dashboard view', () => {
    assert.equal(navViews.length, 13, 'dashboard nav must expose thirteen top-level views');
    for (const view of navViews) {
      assert.ok(viewIds.includes(view.id), `app.js must define view "${view.id}"`);
      assert.ok(
        CLI_DOCS.includes(`**${view.label}**`) || CLI_DOCS.includes(view.label),
        `cli docs must mention dashboard view "${view.label}"`
      );
    }
  });

  it('documents the coordinator and approval-specific surfaces truthfully', () => {
    assert.ok(CLI_DOCS.includes('Initiative'), 'cli docs must document coordinator initiative view');
    assert.ok(CLI_DOCS.includes('First-glance multi-repo coordinator summary'), 'cli docs must describe Initiative as a first-glance overview');
    assert.ok(CLI_DOCS.includes('full blocker diagnostics stay in the **Blockers** view'), 'cli docs must keep Initiative distinct from Blockers');
    assert.ok(CLI_DOCS.includes('Cross-Repo'), 'cli docs must document cross-repo view');
    assert.ok(CLI_DOCS.includes('Delegations'), 'cli docs must document delegation view');
    assert.ok(CLI_DOCS.includes('delegation_queue'), 'cli docs must describe live delegation queue visibility');
    assert.ok(CLI_DOCS.includes('delegation_review'), 'cli docs must describe pending delegation review visibility');
    assert.ok(CLI_DOCS.includes('delegations_issued'), 'cli docs must describe retained delegation history metadata');
    assert.ok(CLI_DOCS.includes('coordinator decision ledger'), 'cli docs must document coordinator decision visibility');
    assert.ok(CLI_DOCS.includes('compact carryover summary'), 'cli docs must document repo decision carryover visibility');
    assert.ok(CLI_DOCS.includes('approve-transition'), 'cli docs must mention approve-transition');
    assert.ok(CLI_DOCS.includes('approve-completion'), 'cli docs must mention approve-completion');
    assert.ok(CLI_DOCS.includes('agentxchain multi approve-gate'), 'cli docs must mention coordinator gate approval command');
    assert.ok(CLI_DOCS.includes('approve button'), 'cli docs must describe the dashboard approve action');
    assert.ok(CLI_DOCS.includes('Blockers'), 'cli docs must document coordinator blockers view');
    assert.ok(CLI_DOCS.includes('Artifacts'), 'cli docs must document workflow-kit artifacts view');
    assert.ok(CLI_DOCS.includes('Coordinator Timeouts'), 'cli docs must document coordinator timeout view');
    assert.ok(CLI_DOCS.includes('continuity panel'), 'cli docs must describe the timeline continuity panel');
    assert.ok(CLI_DOCS.includes('/api/coordinator/timeouts'), 'cli docs must document coordinator timeouts endpoint');
    assert.ok(CLI_DOCS.includes('/api/coordinator/hooks/audit'), 'cli docs must document coordinator hooks audit endpoint');
    assert.ok(CLI_DOCS.includes('/api/coordinator/hooks/annotations'), 'cli docs must document coordinator hooks annotations endpoint');
    assert.ok(CLI_DOCS.includes('coordinator hook audit'), 'cli docs must describe coordinator hook visibility in Hooks view');
    assert.ok(CLI_DOCS.includes('runtime guidance'), 'cli docs must describe blocked runtime guidance visibility');
    assert.ok(CLI_DOCS.includes('ordered next actions'), 'cli docs must describe blocked next-action ordering');
    assert.ok(CLI_DOCS.includes('pending_gate'), 'cli docs must describe pending_gate next-action parity');
    assert.ok(CLI_DOCS.includes('authority-first child repo status'), 'cli docs must describe authority-first coordinator repo rows');
    assert.ok(CLI_DOCS.includes('same authority-first child repo status contract'), 'cli docs must describe shared coordinator next-action ownership');
    assert.ok(CLI_DOCS.includes('coordinator linkage remains detail metadata'), 'cli docs must describe linked/initialized as metadata only');
    assert.ok(CLI_DOCS.includes('coordinator linkage/drift metadata'), 'cli docs must describe coordinator timeout drift metadata');
    assert.ok(CLI_DOCS.includes('multi resync'), 'cli docs must describe coordinator resync next-action parity');
  });

  it('does not advertise removed or unshipped dashboard views', () => {
    const staleViews = [
      'Run overview',
      'Objection tracker',
      'Phase graph',
      'File diff',
    ];

    for (const view of staleViews) {
      assert.ok(!CLI_DOCS.includes(view), `cli docs must not advertise stale dashboard view "${view}"`);
    }
  });

  it('describes turn detail as part of timeline, not a separate top-level view', () => {
    assert.ok(CLI_DOCS.includes('expandable turn-level hook evidence'), 'cli docs must describe timeline drill-down');
    assert.ok(!CLI_DOCS.includes('| **Turn detail** |'), 'turn detail must not be documented as a separate top-level view');
  });

  it('documents timeline turn timing surfaces', () => {
    assert.ok(CLI_DOCS.includes('elapsed time'), 'cli docs must describe active turn elapsed time in timeline');
    assert.ok(CLI_DOCS.includes('per-turn duration'), 'cli docs must describe per-turn duration for completed turns');
    assert.ok(CLI_DOCS.includes('acceptance timestamp'), 'cli docs must describe acceptance timestamp in timeline');
  });

  it('documents timeline coordinator hook evidence parity', () => {
    const timelineRow = CLI_DOCS.split('\n').find(l => l.includes('**Timeline**'));
    assert.ok(timelineRow, 'cli docs must have a Timeline row');
    assert.ok(timelineRow.includes('coordinator hook audit'), 'Timeline row must describe coordinator hook audit visibility');
    assert.ok(timelineRow.includes('coordinator hook annotations') || timelineRow.includes('/api/coordinator/hooks/annotations'), 'Timeline row must describe coordinator hook annotations visibility');
  });

  it('documents live observer freshness for timeline and cross-repo views', () => {
    const timelineRow = CLI_DOCS.split('\n').find(l => l.includes('**Timeline**'));
    const crossRepoRow = CLI_DOCS.split('\n').find(l => l.includes('**Cross-Repo**'));
    assert.ok(timelineRow?.includes('live freshness banner'), 'Timeline row must describe live freshness visibility');
    assert.ok(crossRepoRow?.includes('live freshness banner'), 'Cross-Repo row must describe live freshness visibility');
    assert.ok(CLI_DOCS.includes('live, stale, or disconnected'), 'cli docs must describe the freshness states');
    assert.ok(CLI_DOCS.includes('manual reload archaeology'), 'cli docs must describe the coordinator-event refresh behavior');
  });
});

describe('Dashboard discoverability — front-door surfaces', () => {
  it('keeps dashboard discoverable in CLI and root readmes', () => {
    assert.ok(CLI_README.includes('dashboard'), 'cli/README.md must mention dashboard');
    assert.ok(ROOT_README.includes('agentxchain dashboard'), 'root README.md must mention dashboard command');
  });
});

describe('Dashboard continuity spec', () => {
  it('ships a durable spec for the dashboard continuity surface', () => {
    assert.match(DASHBOARD_CONTINUITY_SPEC, /Dashboard Continuity Surface Spec/);
    assert.match(DASHBOARD_CONTINUITY_SPEC, /AT-DASH-CONT-001/);
    assert.match(DASHBOARD_CONTINUITY_SPEC, /GET \/api\/continuity/);
    assert.match(DASHBOARD_CONTINUITY_SPEC, /Timeline view/);
  });

  it('ships a durable spec for continuity actionability', () => {
    assert.match(CONTINUITY_ACTIONABILITY_SPEC, /Continuity Actionability Spec/);
    assert.match(CONTINUITY_ACTIONABILITY_SPEC, /AT-CA-003/);
    assert.match(CONTINUITY_ACTIONABILITY_SPEC, /GET \/api\/continuity/);
    assert.match(CONTINUITY_ACTIONABILITY_SPEC, /recommended_command/);
  });

  it('ships a durable spec for dashboard daemon lifecycle', () => {
    assert.match(DASHBOARD_DAEMON_SPEC, /Dashboard Daemon Spec/);
    assert.match(DASHBOARD_DAEMON_SPEC, /AT-DASH-DAEMON-001/);
    assert.match(DASHBOARD_DAEMON_SPEC, /\.agentxchain-dashboard\.pid/);
    assert.match(DASHBOARD_DAEMON_SPEC, /agentxchain stop/);
  });

  it('ships a durable dashboard docs spec that matches the current live-vs-replay contract', () => {
    assert.match(DASHBOARD_DOCS_SPEC, /thirteen shipped dashboard views/);
    assert.match(DASHBOARD_DOCS_SPEC, /agentxchain replay export/);
    assert.match(DASHBOARD_DOCS_SPEC, /partial coordinator artifacts do not fabricate missing nested child exports/);
  });

  it('ships a durable spec for blocked runtime-guidance parity', () => {
    assert.match(RUNTIME_PARITY_SPEC, /Runtime Blocked Dashboard And Audit Parity Spec/);
    assert.match(RUNTIME_PARITY_SPEC, /AT-RBDAP-001/);
    assert.match(RUNTIME_PARITY_SPEC, /GET \/api\/state/);
    assert.match(RUNTIME_PARITY_SPEC, /Next Actions/);
  });

  it('ships a durable spec for coordinator blocked-action parity', () => {
    assert.match(COORDINATOR_ACTION_PARITY_SPEC, /Coordinator Blocked Action Parity Spec/);
    assert.match(COORDINATOR_ACTION_PARITY_SPEC, /AT-CBAP-001/);
    assert.match(COORDINATOR_ACTION_PARITY_SPEC, /GET \/api\/coordinator\/blockers/);
    assert.match(COORDINATOR_ACTION_PARITY_SPEC, /agentxchain multi resync/);
  });

  it('ships a durable spec for coordinator next-action repo-status ownership', () => {
    assert.match(COORDINATOR_NEXT_ACTION_REPO_STATUS_SPEC, /Coordinator Next Action Repo Status Spec/);
    assert.match(COORDINATOR_NEXT_ACTION_REPO_STATUS_SPEC, /AT-CNARS-001/);
    assert.match(COORDINATOR_NEXT_ACTION_REPO_STATUS_SPEC, /AT-CNARS-005/);
    assert.match(COORDINATOR_NEXT_ACTION_REPO_STATUS_SPEC, /buildCoordinatorRepoStatusEntries/);
    assert.match(COORDINATOR_NEXT_ACTION_REPO_STATUS_SPEC, /agentxchain multi resync/);
  });

  it('ships a durable spec for coordinator dashboard repo status truth', () => {
    assert.match(COORDINATOR_DASHBOARD_REPO_STATUS_SPEC, /Coordinator Dashboard Repo Status Spec/);
    assert.match(COORDINATOR_DASHBOARD_REPO_STATUS_SPEC, /AT-CDRS-001/);
    assert.match(COORDINATOR_DASHBOARD_REPO_STATUS_SPEC, /AT-CDRS-004/);
    assert.match(COORDINATOR_DASHBOARD_REPO_STATUS_SPEC, /GET \/api\/coordinator\/repo-status/);
    assert.match(COORDINATOR_DASHBOARD_REPO_STATUS_SPEC, /linked/);
    assert.match(COORDINATOR_DASHBOARD_REPO_STATUS_SPEC, /initialized/);
  });

  it('ships a durable spec for coordinator timeout repo status truth', () => {
    assert.match(COORDINATOR_DASHBOARD_TIMEOUT_REPO_STATUS_SPEC, /Coordinator Dashboard Timeout Repo Status Spec/);
    assert.match(COORDINATOR_DASHBOARD_TIMEOUT_REPO_STATUS_SPEC, /AT-CDTRS-001/);
    assert.match(COORDINATOR_DASHBOARD_TIMEOUT_REPO_STATUS_SPEC, /AT-CDTRS-004/);
    assert.match(COORDINATOR_DASHBOARD_TIMEOUT_REPO_STATUS_SPEC, /GET \/api\/coordinator\/timeouts/);
    assert.match(COORDINATOR_DASHBOARD_TIMEOUT_REPO_STATUS_SPEC, /expected run/);
  });

  it('ships a durable spec for initiative view hierarchy', () => {
    assert.match(INITIATIVE_HIERARCHY_SPEC, /Initiative View Hierarchy Spec/);
    assert.match(INITIATIVE_HIERARCHY_SPEC, /AT-IVH-001/);
    assert.match(INITIATIVE_HIERARCHY_SPEC, /AT-IVH-002/);
    assert.match(INITIATIVE_HIERARCHY_SPEC, /AT-IVH-003/);
    assert.match(INITIATIVE_HIERARCHY_SPEC, /AT-IVH-004/);
    assert.match(INITIATIVE_HIERARCHY_SPEC, /`Blockers` view|Blockers view/);
    assert.match(INITIATIVE_HIERARCHY_SPEC, /first-glance overview surface/);
  });

  it('ships a durable spec for shared coordinator blocker presentation', () => {
    assert.match(COORDINATOR_BLOCKER_PRESENTATION_SPEC, /Coordinator Blocker Presentation Shared Spec/);
    assert.match(COORDINATOR_BLOCKER_PRESENTATION_SPEC, /AT-CBPS-001/);
    assert.match(COORDINATOR_BLOCKER_PRESENTATION_SPEC, /AT-CBPS-002/);
    assert.match(COORDINATOR_BLOCKER_PRESENTATION_SPEC, /AT-CBPS-003/);
    assert.match(COORDINATOR_BLOCKER_PRESENTATION_SPEC, /coordinator-next-actions/);
    assert.match(COORDINATOR_BLOCKER_PRESENTATION_SPEC, /typed blocker detail rows are shared/i);
  });

  it('ships a durable spec for coordinator gate evaluation presentation', () => {
    assert.match(COORDINATOR_GATE_EVALUATION_PRESENTATION_SPEC, /Coordinator Gate Evaluation Presentation Spec/);
    assert.match(COORDINATOR_GATE_EVALUATION_PRESENTATION_SPEC, /AT-CGEP-001/);
    assert.match(COORDINATOR_GATE_EVALUATION_PRESENTATION_SPEC, /AT-CGEP-002/);
    assert.match(COORDINATOR_GATE_EVALUATION_PRESENTATION_SPEC, /AT-CGEP-003/);
    assert.match(COORDINATOR_GATE_EVALUATION_PRESENTATION_SPEC, /buildCoordinatorGateEvaluationPresentation/);
    assert.match(COORDINATOR_GATE_EVALUATION_PRESENTATION_SPEC, /pending-gate presentation remains owned/i);
  });

  it('keeps initiative hierarchy acceptance ids executable in dashboard view tests', () => {
    const dashboardViews = readFileSync(join(REPO_ROOT, 'cli', 'test', 'dashboard-views.test.js'), 'utf8');
    assert.match(dashboardViews, /AT-IVH-001 renders the existing placeholder when coordinator state is missing/);
    assert.match(dashboardViews, /AT-IVH-002 renders structured coordinator blockers as a summary with one primary action/);
    assert.match(dashboardViews, /AT-IVH-003 keeps full ordered blocker actions in the Blockers view instead of inlining them in Initiative/);
    assert.match(dashboardViews, /AT-IVH-004 points to Blockers when additional blocker or action detail exists/);
  });

  it('ships a durable spec for dashboard live observer freshness', () => {
    assert.match(LIVE_OBSERVER_SPEC, /Dashboard Live Observer Spec/);
    assert.match(LIVE_OBSERVER_SPEC, /AT-DLO-001/);
    assert.match(LIVE_OBSERVER_SPEC, /coordinator_event/);
    assert.match(LIVE_OBSERVER_SPEC, /Timeline/);
    assert.match(LIVE_OBSERVER_SPEC, /Cross-Repo/);
  });

  it('keeps AT-DASH-ACT ids unique and aligned across dashboard proof tests', () => {
    const dashboardBridge = readFileSync(join(REPO_ROOT, 'cli', 'test', 'dashboard-bridge.test.js'), 'utf8');
    const dashboardApp = readFileSync(join(REPO_ROOT, 'cli', 'test', 'dashboard-app.test.js'), 'utf8');
    const dashboardE2E = readFileSync(join(REPO_ROOT, 'cli', 'test', 'e2e-dashboard.test.js'), 'utf8');
    const ids = [dashboardBridge, dashboardApp, dashboardE2E]
      .flatMap((source) => [...source.matchAll(/it\('((AT-DASH-ACT-\d{3})(?:\/AT-DASH-ACT-\d{3})*):/g)])
      .flatMap((match) => match[1].split('/'));
    const seen = new Set();
    const duplicates = new Set();
    for (const id of ids) {
      if (seen.has(id)) duplicates.add(id);
      seen.add(id);
    }

    assert.deepEqual(
      [...duplicates],
      [],
      `duplicate AT-DASH-ACT ids across dashboard proof tests: ${[...duplicates].join(', ')}`,
    );
    assert.match(dashboardE2E, /AT-DASH-ACT-001\/AT-DASH-ACT-003: approves a pending repo gate through the authenticated bridge action/);
    assert.match(dashboardE2E, /AT-DASH-ACT-002\/AT-DASH-ACT-007: rejects action requests without the session token and keeps websocket read-only/);
    assert.match(dashboardBridge, /AT-DASH-ACT-009: POST \/api\/actions\/approve-gate returns normalized coordinator hook-block failure fields/);
    assert.match(dashboardBridge, /AT-DASH-ACT-010: POST \/api\/actions\/approve-gate returns normalized repo-local hook-block failure fields/);
    assert.match(dashboardBridge, /AT-DASH-ACT-011: POST \/api\/actions\/approve-gate returns repo-local success state and next actions/);
    assert.match(dashboardBridge, /AT-DASH-ACT-012: POST \/api\/actions\/approve-gate returns coordinator success state and next actions/);
    assert.match(dashboardApp, /AT-DASH-ACT-013: success formatting includes the first ordered next action/);
    assert.match(dashboardBridge, /AT-DASH-ACT-014: POST \/api\/actions\/approve-gate returns repo-local completion success with no next actions/);
    assert.match(dashboardBridge, /AT-DASH-ACT-015: POST \/api\/actions\/approve-gate returns coordinator completion success with no next actions even when repo snapshots drift/);
    assert.match(dashboardApp, /AT-DASH-ACT-016: error formatting includes recovery detail and first next action/);
  });
});
