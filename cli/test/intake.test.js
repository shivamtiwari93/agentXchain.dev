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
  const dir = mkdtempSync(join(tmpdir(), 'axc-intake-'));
  writeFileSync(join(dir, 'agentxchain.json'), JSON.stringify({
    project: 'test-intake',
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

function readIntakeFiles(dir, subdir) {
  const path = join(dir, '.agentxchain', 'intake', subdir);
  if (!existsSync(path)) return [];
  return readdirSync(path)
    .filter(f => f.endsWith('.json') && !f.startsWith('.tmp-'))
    .map(f => JSON.parse(readFileSync(join(path, f), 'utf8')));
}

describe('intake record', () => {
  let dir;
  beforeEach(() => { dir = createProject(); });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  // AT-V3S1-001
  it('records a manual event and creates a detected intent', () => {
    const result = runCli([
      'intake', 'record',
      '--source', 'manual',
      '--signal', '{"description":"test signal"}',
      '--evidence', '{"type":"text","value":"test evidence"}',
      '--json',
    ], dir);

    assert.equal(result.status, 0, `exit ${result.status}: ${result.stderr}`);
    const out = JSON.parse(result.stdout);
    assert.equal(out.ok, true);
    assert.equal(out.deduplicated, false);
    assert.match(out.event.event_id, /^evt_\d+_[0-9a-f]{4}$/);
    assert.equal(out.event.source, 'manual');
    assert.match(out.intent.intent_id, /^intent_\d+_[0-9a-f]{4}$/);
    assert.equal(out.intent.status, 'detected');
    assert.equal(out.intent.event_id, out.event.event_id);

    // Verify files on disk
    const events = readIntakeFiles(dir, 'events');
    assert.equal(events.length, 1);
    const intents = readIntakeFiles(dir, 'intents');
    assert.equal(intents.length, 1);
  });

  // AT-V3S1-002
  it('deduplicates events with the same signal', () => {
    const args = [
      'intake', 'record',
      '--source', 'ci_failure',
      '--signal', '{"run_id":"123","workflow":"test"}',
      '--evidence', '{"type":"url","value":"https://example.com/run/123"}',
      '--json',
    ];

    const first = runCli(args, dir);
    assert.equal(first.status, 0);
    const firstOut = JSON.parse(first.stdout);
    assert.equal(firstOut.deduplicated, false);

    const second = runCli(args, dir);
    assert.equal(second.status, 0);
    const secondOut = JSON.parse(second.stdout);
    assert.equal(secondOut.deduplicated, true);
    assert.equal(secondOut.event.event_id, firstOut.event.event_id);

    // Only one event and one intent on disk
    const events = readIntakeFiles(dir, 'events');
    assert.equal(events.length, 1);
    const intents = readIntakeFiles(dir, 'intents');
    assert.equal(intents.length, 1);
  });

  // AT-V3S1-008
  it('rejects invalid source type', () => {
    const result = runCli([
      'intake', 'record',
      '--source', 'invalid_source',
      '--signal', '{"x":1}',
      '--evidence', '{"type":"text","value":"test"}',
      '--json',
    ], dir);

    assert.equal(result.status, 1);
    const out = JSON.parse(result.stdout);
    assert.equal(out.ok, false);
    assert.ok(out.error.includes('source must be one of'));
  });

  // AT-V3S1-010
  it('returns structured JSON output with --json', () => {
    const result = runCli([
      'intake', 'record',
      '--source', 'manual',
      '--signal', '{"desc":"json test"}',
      '--evidence', '{"type":"text","value":"test"}',
      '--json',
    ], dir);

    assert.equal(result.status, 0);
    const out = JSON.parse(result.stdout);
    assert.equal(typeof out.ok, 'boolean');
    assert.equal(typeof out.event, 'object');
    assert.equal(typeof out.intent, 'object');
    assert.equal(typeof out.deduplicated, 'boolean');
  });

  // AT-V3S1-011
  it('auto-creates intake directories on first record', () => {
    assert.equal(existsSync(join(dir, '.agentxchain', 'intake')), false);

    runCli([
      'intake', 'record',
      '--source', 'manual',
      '--signal', '{"desc":"auto-create"}',
      '--evidence', '{"type":"text","value":"test"}',
      '--json',
    ], dir);

    assert.equal(existsSync(join(dir, '.agentxchain', 'intake', 'events')), true);
    assert.equal(existsSync(join(dir, '.agentxchain', 'intake', 'intents')), true);
  });

  it('records event from a JSON file', () => {
    const eventFile = join(dir, 'test-event.json');
    writeFileSync(eventFile, JSON.stringify({
      source: 'git_ref_change',
      signal: { ref: 'refs/tags/v3.0.0', action: 'created' },
      evidence: [{ type: 'text', value: 'new tag pushed' }],
    }));

    const result = runCli(['intake', 'record', '--file', eventFile, '--json'], dir);
    assert.equal(result.status, 0);
    const out = JSON.parse(result.stdout);
    assert.equal(out.ok, true);
    assert.equal(out.event.source, 'git_ref_change');
  });

  it('rejects missing --signal with --source', () => {
    const result = runCli([
      'intake', 'record',
      '--source', 'manual',
      '--evidence', '{"type":"text","value":"test"}',
      '--json',
    ], dir);

    assert.equal(result.status, 1);
    const out = JSON.parse(result.stdout);
    assert.equal(out.ok, false);
    assert.ok(out.error.includes('--signal'));
  });

  it('exits 2 when no project found', () => {
    const emptyDir = mkdtempSync(join(tmpdir(), 'axc-no-proj-'));
    const result = runCli([
      'intake', 'record',
      '--source', 'manual',
      '--signal', '{"x":1}',
      '--evidence', '{"type":"text","value":"test"}',
      '--json',
    ], emptyDir);

    assert.equal(result.status, 2);
    rmSync(emptyDir, { recursive: true, force: true });
  });
});

describe('intake triage', () => {
  let dir;
  let intentId;

  beforeEach(() => {
    dir = createProject();
    // Record an event to get a detected intent
    const result = runCli([
      'intake', 'record',
      '--source', 'manual',
      '--signal', '{"desc":"triage test"}',
      '--evidence', '{"type":"text","value":"test evidence"}',
      '--json',
    ], dir);
    const out = JSON.parse(result.stdout);
    intentId = out.intent.intent_id;
  });

  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  // AT-V3S1-003
  it('transitions detected intent to triaged with valid fields', () => {
    const result = runCli([
      'intake', 'triage',
      '--intent', intentId,
      '--priority', 'p1',
      '--template', 'cli-tool',
      '--charter', 'Fix the release pipeline',
      '--acceptance', 'tarball installs cleanly,postflight passes',
      '--json',
    ], dir);

    assert.equal(result.status, 0, `exit ${result.status}: ${result.stderr}`);
    const out = JSON.parse(result.stdout);
    assert.equal(out.ok, true);
    assert.equal(out.intent.status, 'triaged');
    assert.equal(out.intent.priority, 'p1');
    assert.equal(out.intent.template, 'cli-tool');
    assert.equal(out.intent.charter, 'Fix the release pipeline');
    assert.deepEqual(out.intent.acceptance_contract, ['tarball installs cleanly', 'postflight passes']);
    assert.equal(out.intent.history.length, 2);
    assert.equal(out.intent.history[1].from, 'detected');
    assert.equal(out.intent.history[1].to, 'triaged');
  });

  // AT-V3S1-004
  it('rejects triage on non-detected intent', () => {
    // First triage it
    runCli([
      'intake', 'triage',
      '--intent', intentId,
      '--priority', 'p1',
      '--template', 'generic',
      '--charter', 'Test',
      '--acceptance', 'test',
      '--json',
    ], dir);

    // Try to triage again
    const result = runCli([
      'intake', 'triage',
      '--intent', intentId,
      '--priority', 'p2',
      '--template', 'generic',
      '--charter', 'Test again',
      '--acceptance', 'test',
      '--json',
    ], dir);

    assert.equal(result.status, 1);
    const out = JSON.parse(result.stdout);
    assert.equal(out.ok, false);
    assert.ok(out.error.includes('cannot triage from status'));
  });

  // AT-V3S1-005
  it('suppresses a detected intent', () => {
    const result = runCli([
      'intake', 'triage',
      '--intent', intentId,
      '--suppress',
      '--reason', 'not actionable',
      '--json',
    ], dir);

    assert.equal(result.status, 0);
    const out = JSON.parse(result.stdout);
    assert.equal(out.ok, true);
    assert.equal(out.intent.status, 'suppressed');
    assert.equal(out.intent.history[1].reason, 'not actionable');
  });

  // AT-V3S1-009
  it('rejects triage with missing required fields', () => {
    const result = runCli([
      'intake', 'triage',
      '--intent', intentId,
      '--priority', 'p1',
      // missing --template, --charter, --acceptance
      '--json',
    ], dir);

    assert.equal(result.status, 1);
    const out = JSON.parse(result.stdout);
    assert.equal(out.ok, false);
    assert.ok(out.error.includes('template'));
  });

  it('rejects unknown template id', () => {
    const result = runCli([
      'intake', 'triage',
      '--intent', intentId,
      '--priority', 'p1',
      '--template', 'nonexistent',
      '--charter', 'test',
      '--acceptance', 'test',
      '--json',
    ], dir);

    assert.equal(result.status, 1);
    const out = JSON.parse(result.stdout);
    assert.ok(out.error.includes('template must be one of'));
  });

  it('rejects suppress without --reason', () => {
    const result = runCli([
      'intake', 'triage',
      '--intent', intentId,
      '--suppress',
      '--json',
    ], dir);

    assert.equal(result.status, 1);
    const out = JSON.parse(result.stdout);
    assert.ok(out.error.includes('suppress requires --reason'));
  });

  it('rejects a triaged intent', () => {
    // First triage
    runCli([
      'intake', 'triage',
      '--intent', intentId,
      '--priority', 'p2',
      '--template', 'generic',
      '--charter', 'Test charter',
      '--acceptance', 'criterion',
      '--json',
    ], dir);

    // Then reject
    const result = runCli([
      'intake', 'triage',
      '--intent', intentId,
      '--reject',
      '--reason', 'scope too large',
      '--json',
    ], dir);

    assert.equal(result.status, 0);
    const out = JSON.parse(result.stdout);
    assert.equal(out.intent.status, 'rejected');
  });

  it('returns exit 2 for unknown intent', () => {
    const result = runCli([
      'intake', 'triage',
      '--intent', 'intent_0000000000000_0000',
      '--priority', 'p1',
      '--template', 'generic',
      '--charter', 'Test',
      '--acceptance', 'test',
      '--json',
    ], dir);

    assert.equal(result.status, 2);
    const out = JSON.parse(result.stdout);
    assert.ok(out.error.includes('not found'));
  });
});

describe('intake status', () => {
  let dir;

  beforeEach(() => { dir = createProject(); });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  // AT-V3S1-006
  it('shows aggregate counts matching actual files', () => {
    // Record two events
    runCli([
      'intake', 'record',
      '--source', 'manual',
      '--signal', '{"desc":"event 1"}',
      '--evidence', '{"type":"text","value":"e1"}',
      '--json',
    ], dir);

    runCli([
      'intake', 'record',
      '--source', 'ci_failure',
      '--signal', '{"run_id":"456"}',
      '--evidence', '{"type":"url","value":"https://example.com"}',
      '--json',
    ], dir);

    const result = runCli(['intake', 'status', '--json'], dir);
    assert.equal(result.status, 0);
    const out = JSON.parse(result.stdout);
    assert.equal(out.ok, true);
    assert.equal(out.summary.total_events, 2);
    assert.equal(out.summary.total_intents, 2);
    assert.equal(out.summary.by_status.detected, 2);
  });

  // AT-V3S1-007
  it('shows intent detail with history', () => {
    const recordResult = runCli([
      'intake', 'record',
      '--source', 'manual',
      '--signal', '{"desc":"detail test"}',
      '--evidence', '{"type":"text","value":"test"}',
      '--json',
    ], dir);
    const intentId = JSON.parse(recordResult.stdout).intent.intent_id;

    const result = runCli(['intake', 'status', '--intent', intentId, '--json'], dir);
    assert.equal(result.status, 0);
    const out = JSON.parse(result.stdout);
    assert.equal(out.ok, true);
    assert.equal(out.intent.intent_id, intentId);
    assert.ok(Array.isArray(out.intent.history));
    assert.equal(out.intent.history.length, 1);
    assert.equal(out.intent.history[0].to, 'detected');
    assert.ok(out.event); // linked event returned
    assert.equal(out.event.source, 'manual');
  });

  it('returns empty summary when no intake events exist', () => {
    const result = runCli(['intake', 'status', '--json'], dir);
    assert.equal(result.status, 0);
    const out = JSON.parse(result.stdout);
    assert.equal(out.summary.total_events, 0);
    assert.equal(out.summary.total_intents, 0);
  });

  it('returns exit 2 for unknown intent in detail mode', () => {
    const result = runCli(['intake', 'status', '--intent', 'intent_0000000000000_0000', '--json'], dir);
    assert.equal(result.status, 2);
    const out = JSON.parse(result.stdout);
    assert.ok(out.error.includes('not found'));
  });

  it('writes loop-state.json as a cache', () => {
    runCli([
      'intake', 'record',
      '--source', 'manual',
      '--signal', '{"desc":"loop state test"}',
      '--evidence', '{"type":"text","value":"test"}',
      '--json',
    ], dir);

    runCli(['intake', 'status', '--json'], dir);

    const loopState = JSON.parse(readFileSync(join(dir, '.agentxchain', 'intake', 'loop-state.json'), 'utf8'));
    assert.equal(loopState.schema_version, '1.0');
    assert.equal(typeof loopState.pending_events, 'number');
    assert.equal(typeof loopState.pending_intents, 'number');
  });
});
