import { strict as assert } from 'node:assert';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync, existsSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, it, beforeEach, afterEach } from 'node:test';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI_BIN = join(__dirname, '..', 'bin', 'agentxchain.js');

function createProject() {
  const dir = mkdtempSync(join(tmpdir(), 'axc-intake-s2-'));
  writeFileSync(join(dir, 'agentxchain.json'), JSON.stringify({
    project: 'test-intake-s2',
    protocol_mode: 'governed',
    version: '1.0',
  }, null, 2));
  mkdirSync(join(dir, '.agentxchain'), { recursive: true });
  return dir;
}

function runCli(args, cwd) {
  return spawnSync(process.execPath, [CLI_BIN, ...args], {
    cwd,
    encoding: 'utf8',
    timeout: 10000,
  });
}

/** Record an event and triage it, returning the triaged intent ID. */
function recordAndTriage(dir, template = 'cli-tool') {
  const recordResult = runCli([
    'intake', 'record',
    '--source', 'manual',
    '--signal', `{"desc":"s2 test ${Date.now()}"}`,
    '--evidence', '{"type":"text","value":"test evidence"}',
    '--json',
  ], dir);
  const intentId = JSON.parse(recordResult.stdout).intent.intent_id;

  runCli([
    'intake', 'triage',
    '--intent', intentId,
    '--priority', 'p1',
    '--template', template,
    '--charter', 'Fix the release pipeline',
    '--acceptance', 'tarball installs cleanly,postflight passes',
    '--json',
  ], dir);

  return intentId;
}

/** Record, triage, and approve an intent. */
function recordTriageAndApprove(dir, template = 'cli-tool') {
  const intentId = recordAndTriage(dir, template);

  runCli([
    'intake', 'approve',
    '--intent', intentId,
    '--json',
  ], dir);

  return intentId;
}

describe('intake approve', () => {
  let dir;
  beforeEach(() => { dir = createProject(); });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  // AT-V3S2-001
  it('transitions a triaged intent to approved with history entry', () => {
    const intentId = recordAndTriage(dir);

    const result = runCli([
      'intake', 'approve',
      '--intent', intentId,
      '--json',
    ], dir);

    assert.equal(result.status, 0, `exit ${result.status}: ${result.stderr}`);
    const out = JSON.parse(result.stdout);
    assert.equal(out.ok, true);
    assert.equal(out.intent.status, 'approved');
    assert.equal(out.intent.approved_by, 'operator');

    // History should have 3 entries: detected, triaged, approved
    assert.equal(out.intent.history.length, 3);
    const lastEntry = out.intent.history[2];
    assert.equal(lastEntry.from, 'triaged');
    assert.equal(lastEntry.to, 'approved');
    assert.equal(lastEntry.approver, 'operator');
  });

  // AT-V3S2-002
  it('rejects approval on a detected (non-triaged) intent', () => {
    const recordResult = runCli([
      'intake', 'record',
      '--source', 'manual',
      '--signal', '{"desc":"not triaged"}',
      '--evidence', '{"type":"text","value":"test"}',
      '--json',
    ], dir);
    const intentId = JSON.parse(recordResult.stdout).intent.intent_id;

    const result = runCli([
      'intake', 'approve',
      '--intent', intentId,
      '--json',
    ], dir);

    assert.equal(result.status, 1);
    const out = JSON.parse(result.stdout);
    assert.equal(out.ok, false);
    assert.ok(out.error.includes('cannot approve from status "detected"'));
  });

  // AT-V3S2-003
  it('returns exit 2 for non-existent intent', () => {
    const result = runCli([
      'intake', 'approve',
      '--intent', 'intent_0000000000000_0000',
      '--json',
    ], dir);

    assert.equal(result.status, 2);
    const out = JSON.parse(result.stdout);
    assert.ok(out.error.includes('not found'));
  });

  // AT-V3S2-004
  it('records approver from --approver option', () => {
    const intentId = recordAndTriage(dir);

    const result = runCli([
      'intake', 'approve',
      '--intent', intentId,
      '--approver', 'alice',
      '--reason', 'urgent fix needed',
      '--json',
    ], dir);

    assert.equal(result.status, 0);
    const out = JSON.parse(result.stdout);
    assert.equal(out.intent.approved_by, 'alice');
    const lastEntry = out.intent.history[2];
    assert.equal(lastEntry.approver, 'alice');
    assert.equal(lastEntry.reason, 'urgent fix needed');
  });

  // AT-V3S2-011 (approve JSON)
  it('returns structured JSON output', () => {
    const intentId = recordAndTriage(dir);

    const result = runCli([
      'intake', 'approve',
      '--intent', intentId,
      '--json',
    ], dir);

    assert.equal(result.status, 0);
    const out = JSON.parse(result.stdout);
    assert.equal(typeof out.ok, 'boolean');
    assert.equal(typeof out.intent, 'object');
    assert.equal(out.intent.status, 'approved');
  });

  it('supersedes a current-run phantom intent instead of approving it again', () => {
    const intentId = recordAndTriage(dir, 'api-service');
    mkdirSync(join(dir, '.planning'), { recursive: true });
    writeFileSync(join(dir, '.planning', 'api-contract.md'), '# Existing API contract\n');
    writeFileSync(join(dir, '.agentxchain', 'state.json'), JSON.stringify({
      run_id: 'run_phantom_approve_001',
      phase: 'implementation',
      status: 'active',
    }, null, 2));

    const result = runCli([
      'intake', 'approve',
      '--intent', intentId,
      '--json',
    ], dir);

    assert.equal(result.status, 0, `exit ${result.status}: ${result.stderr}`);
    const out = JSON.parse(result.stdout);
    assert.equal(out.ok, true);
    assert.equal(out.superseded, true);
    assert.equal(out.intent.status, 'superseded');
    assert.equal(out.intent.approved_run_id, 'run_phantom_approve_001');
    assert.match(out.intent.archived_reason, /superseded during approval/);
  });
});

describe('intake plan', () => {
  let dir;
  beforeEach(() => { dir = createProject(); });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  // AT-V3S2-005
  it('generates planning artifacts from cli-tool template and transitions to planned', () => {
    const intentId = recordTriageAndApprove(dir, 'cli-tool');

    const result = runCli([
      'intake', 'plan',
      '--intent', intentId,
      '--project-name', 'TestProject',
      '--json',
    ], dir);

    assert.equal(result.status, 0, `exit ${result.status}: ${result.stderr}`);
    const out = JSON.parse(result.stdout);
    assert.equal(out.ok, true);
    assert.equal(out.intent.status, 'planned');
    assert.equal(out.artifacts_generated.length, 3);

    // Verify files exist on disk
    assert.ok(existsSync(join(dir, '.planning', 'command-surface.md')));
    assert.ok(existsSync(join(dir, '.planning', 'platform-support.md')));
    assert.ok(existsSync(join(dir, '.planning', 'distribution-checklist.md')));

    // Verify template substitution
    const content = readFileSync(join(dir, '.planning', 'command-surface.md'), 'utf8');
    assert.ok(content.includes('TestProject'));

    // History should have 4 entries: detected, triaged, approved, planned
    assert.equal(out.intent.history.length, 4);
    const lastEntry = out.intent.history[3];
    assert.equal(lastEntry.from, 'approved');
    assert.equal(lastEntry.to, 'planned');
    assert.ok(Array.isArray(lastEntry.artifacts));
  });

  // AT-V3S2-006
  it('rejects planning on a triaged (non-approved) intent', () => {
    const intentId = recordAndTriage(dir);

    const result = runCli([
      'intake', 'plan',
      '--intent', intentId,
      '--json',
    ], dir);

    assert.equal(result.status, 1);
    const out = JSON.parse(result.stdout);
    assert.equal(out.ok, false);
    assert.ok(out.error.includes('cannot plan from status "triaged"'));
  });

  // AT-V3S2-007
  it('fails with conflict when planning artifacts already exist', () => {
    const intentId = recordTriageAndApprove(dir, 'cli-tool');

    // Pre-create a conflicting file
    mkdirSync(join(dir, '.planning'), { recursive: true });
    writeFileSync(join(dir, '.planning', 'command-surface.md'), 'existing content');

    const result = runCli([
      'intake', 'plan',
      '--intent', intentId,
      '--json',
    ], dir);

    assert.equal(result.status, 1);
    const out = JSON.parse(result.stdout);
    assert.equal(out.ok, false);
    assert.ok(out.error.includes('existing planning artifacts'));
    assert.ok(Array.isArray(out.conflicts));
    assert.ok(out.conflicts.includes('.planning/command-surface.md'));

    // Verify intent was NOT transitioned
    const statusResult = runCli(['intake', 'status', '--intent', intentId, '--json'], dir);
    const statusOut = JSON.parse(statusResult.stdout);
    assert.equal(statusOut.intent.status, 'approved');
  });

  // AT-V3S2-008
  it('overwrites existing artifacts with --force', () => {
    const intentId = recordTriageAndApprove(dir, 'cli-tool');

    // Pre-create a conflicting file
    mkdirSync(join(dir, '.planning'), { recursive: true });
    writeFileSync(join(dir, '.planning', 'command-surface.md'), 'old content');

    const result = runCli([
      'intake', 'plan',
      '--intent', intentId,
      '--force',
      '--project-name', 'ForcedProject',
      '--json',
    ], dir);

    assert.equal(result.status, 0);
    const out = JSON.parse(result.stdout);
    assert.equal(out.ok, true);
    assert.equal(out.intent.status, 'planned');

    // Verify file was overwritten
    const content = readFileSync(join(dir, '.planning', 'command-surface.md'), 'utf8');
    assert.ok(content.includes('ForcedProject'));
    assert.ok(!content.includes('old content'));
  });

  // AT-V3S2-009
  it('succeeds with zero artifacts on generic template', () => {
    const intentId = recordTriageAndApprove(dir, 'generic');

    const result = runCli([
      'intake', 'plan',
      '--intent', intentId,
      '--json',
    ], dir);

    assert.equal(result.status, 0);
    const out = JSON.parse(result.stdout);
    assert.equal(out.ok, true);
    assert.equal(out.intent.status, 'planned');
    assert.equal(out.artifacts_generated.length, 0);
    assert.deepEqual(out.intent.planning_artifacts, []);
  });

  // AT-V3S2-010
  it('records planning_artifacts array on the intent', () => {
    const intentId = recordTriageAndApprove(dir, 'api-service');

    const result = runCli([
      'intake', 'plan',
      '--intent', intentId,
      '--json',
    ], dir);

    assert.equal(result.status, 0);
    const out = JSON.parse(result.stdout);
    assert.ok(Array.isArray(out.intent.planning_artifacts));
    assert.equal(out.intent.planning_artifacts.length, 3);
    assert.ok(out.intent.planning_artifacts.includes('.planning/api-contract.md'));
    assert.ok(out.intent.planning_artifacts.includes('.planning/operational-readiness.md'));
    assert.ok(out.intent.planning_artifacts.includes('.planning/error-budget.md'));
  });

  it('generates planning artifacts from library template', () => {
    const intentId = recordTriageAndApprove(dir, 'library');

    const result = runCli([
      'intake', 'plan',
      '--intent', intentId,
      '--project-name', 'LibraryProject',
      '--json',
    ], dir);

    assert.equal(result.status, 0);
    const out = JSON.parse(result.stdout);
    assert.equal(out.ok, true);
    assert.equal(out.intent.status, 'planned');
    assert.equal(out.artifacts_generated.length, 3);
    assert.ok(out.intent.planning_artifacts.includes('.planning/public-api.md'));
    assert.ok(out.intent.planning_artifacts.includes('.planning/compatibility-policy.md'));
    assert.ok(out.intent.planning_artifacts.includes('.planning/release-adoption.md'));
    assert.ok(existsSync(join(dir, '.planning', 'public-api.md')));
    assert.ok(existsSync(join(dir, '.planning', 'compatibility-policy.md')));
    assert.ok(existsSync(join(dir, '.planning', 'release-adoption.md')));
    const content = readFileSync(join(dir, '.planning', 'public-api.md'), 'utf8');
    assert.ok(content.includes('LibraryProject'));
  });

  // AT-V3S2-011 (plan JSON)
  it('returns structured JSON output with artifact lists', () => {
    const intentId = recordTriageAndApprove(dir, 'web-app');

    const result = runCli([
      'intake', 'plan',
      '--intent', intentId,
      '--json',
    ], dir);

    assert.equal(result.status, 0);
    const out = JSON.parse(result.stdout);
    assert.equal(typeof out.ok, 'boolean');
    assert.equal(typeof out.intent, 'object');
    assert.ok(Array.isArray(out.artifacts_generated));
    assert.ok(Array.isArray(out.artifacts_skipped));
  });

  // AT-V3S2-012
  it('full pipeline: record -> triage -> approve -> plan', () => {
    // Record
    const recordResult = runCli([
      'intake', 'record',
      '--source', 'ci_failure',
      '--signal', '{"run_id":"999","workflow":"deploy"}',
      '--evidence', '{"type":"url","value":"https://example.com/runs/999"}',
      '--json',
    ], dir);
    assert.equal(recordResult.status, 0);
    const intentId = JSON.parse(recordResult.stdout).intent.intent_id;

    // Triage
    const triageResult = runCli([
      'intake', 'triage',
      '--intent', intentId,
      '--priority', 'p0',
      '--template', 'cli-tool',
      '--charter', 'Emergency deploy fix',
      '--acceptance', 'deploy succeeds,no rollback needed',
      '--json',
    ], dir);
    assert.equal(triageResult.status, 0);
    assert.equal(JSON.parse(triageResult.stdout).intent.status, 'triaged');

    // Approve
    const approveResult = runCli([
      'intake', 'approve',
      '--intent', intentId,
      '--approver', 'release-manager',
      '--reason', 'critical deploy failure',
      '--json',
    ], dir);
    assert.equal(approveResult.status, 0);
    assert.equal(JSON.parse(approveResult.stdout).intent.status, 'approved');

    // Plan
    const planResult = runCli([
      'intake', 'plan',
      '--intent', intentId,
      '--project-name', 'PipelineProject',
      '--json',
    ], dir);
    assert.equal(planResult.status, 0);
    const planOut = JSON.parse(planResult.stdout);
    assert.equal(planOut.intent.status, 'planned');
    assert.equal(planOut.artifacts_generated.length, 3);

    // Verify full history chain
    assert.equal(planOut.intent.history.length, 4);
    assert.equal(planOut.intent.history[0].to, 'detected');
    assert.equal(planOut.intent.history[1].to, 'triaged');
    assert.equal(planOut.intent.history[2].to, 'approved');
    assert.equal(planOut.intent.history[3].to, 'planned');

    // Verify artifacts on disk
    assert.ok(existsSync(join(dir, '.planning', 'command-surface.md')));
    const content = readFileSync(join(dir, '.planning', 'command-surface.md'), 'utf8');
    assert.ok(content.includes('PipelineProject'));
  });
});
