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
    assert.ok(CLI_DOCS.includes('--no-open'), 'cli docs must document --no-open');
    assert.ok(!CLI_DOCS.includes('--host <addr>'), 'cli docs must not advertise unsupported --host');
  });

  it('matches the actual dashboard CLI implementation', () => {
    assert.ok(CLI_BIN.includes(".command('dashboard')"), 'CLI must register dashboard command');
    assert.ok(CLI_BIN.includes(".option('--port <port>'"), 'CLI must expose --port');
    assert.ok(CLI_BIN.includes(".option('--no-open'"), 'CLI must expose --no-open');
    assert.ok(!CLI_BIN.includes(".option('--host"), 'CLI must not expose a host flag');
    assert.ok(DASHBOARD_COMMAND.includes('const DEFAULT_PORT = 3847;'), 'dashboard command must default to 3847');
  });

  it('documents the local-only gate-approval bridge contract', () => {
    assert.ok(CLI_DOCS.includes('127.0.0.1'), 'cli docs must state local-only binding');
    assert.ok(CLI_DOCS.includes('http://localhost:<port>'), 'cli docs must describe the printed local URL');
    assert.ok(CLI_DOCS.includes('approve-completion'), 'cli docs must mention repo completion approval');
    assert.ok(CLI_DOCS.includes('X-AgentXchain-Token'), 'cli docs must document the local mutation token boundary');
    assert.ok(CLI_DOCS.includes('/api/coordinator/blockers'), 'cli docs must document the coordinator blockers endpoint');
    assert.ok(CLI_DOCS.includes('/api/coordinator/ledger'), 'cli docs must document the coordinator ledger endpoint');
    assert.ok(CLI_DOCS.includes('/api/continuity'), 'cli docs must document the continuity endpoint');
    assert.ok(CLI_DOCS.includes('repo_run_id_mismatch'), 'cli docs must mention structured run identity drift blockers');
    assert.ok(CLI_DOCS.includes('SESSION_RECOVERY.md'), 'cli docs must mention the recovery report continuity surface');
    assert.ok(CLI_DOCS.includes('agentxchain restart'), 'cli docs must mention restart guidance in the dashboard surface');
    assert.ok(CLI_DOCS.includes('step --resume'), 'cli docs must document that blocked recovery remains CLI-only');
    assert.ok(BRIDGE_SERVER.includes("server.listen(port, '127.0.0.1'"), 'bridge server must bind to 127.0.0.1');
    assert.ok(BRIDGE_SERVER.includes('/api/actions/approve-gate'), 'bridge server must expose the approve-gate endpoint');
    assert.ok(BRIDGE_SERVER.includes('/api/coordinator/blockers'), 'bridge server must expose the coordinator blockers endpoint');
    assert.ok(BRIDGE_SERVER.includes('/api/workflow-kit-artifacts'), 'bridge server must expose the workflow-kit artifacts endpoint');
    assert.ok(STATE_READER.includes('/api/continuity'), 'dashboard state reader must expose the continuity endpoint');
    assert.ok(BRIDGE_SERVER.includes('X-AgentXchain-Token'), 'bridge server must validate the dashboard mutation token');
    assert.ok(BRIDGE_SERVER.includes('Dashboard WebSocket is read-only'), 'websocket must remain read-only');
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
    assert.ok(CLI_DOCS.includes('Cross-Repo'), 'cli docs must document cross-repo view');
    assert.ok(CLI_DOCS.includes('Delegations'), 'cli docs must document delegation view');
    assert.ok(CLI_DOCS.includes('delegation_queue'), 'cli docs must describe live delegation queue visibility');
    assert.ok(CLI_DOCS.includes('delegation_review'), 'cli docs must describe pending delegation review visibility');
    assert.ok(CLI_DOCS.includes('delegations_issued'), 'cli docs must describe retained delegation history metadata');
    assert.ok(CLI_DOCS.includes('coordinator decision ledger'), 'cli docs must document coordinator decision visibility');
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
});
