/**
 * E2E Hook Composition Test — Multi-Phase Hook Lifecycle
 *
 * Proves that hooks compose correctly across a full governed lifecycle:
 *   - Blocking hook on before_validation halts acceptance cleanly
 *   - Advisory hook on after_acceptance records annotations without blocking
 *   - Audit trail in hook-audit.jsonl captures all invocations
 *   - hook-annotations.jsonl records after_acceptance annotations only
 *   - history.jsonl is never mutated by hooks (only by orchestrator)
 *   - on_escalation fires for non-hook blocks, does NOT fire for hook-caused blocks
 *
 * See: .planning/PLUGIN_HOOK_SYSTEM_SPEC.md
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, cpSync, chmodSync } from 'fs';
import { join, dirname } from 'path';
import { tmpdir } from 'os';
import { randomBytes } from 'crypto';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';

import {
  initializeGovernedRun,
  assignGovernedTurn,
  acceptGovernedTurn,
  rejectGovernedTurn,
  approvePhaseTransition,
  approveRunCompletion,
  normalizeGovernedStateShape,
  getActiveTurn,
  markRunBlocked,
  STATE_PATH,
  HISTORY_PATH,
  LEDGER_PATH,
  STAGING_PATH,
  TALK_PATH,
} from '../src/lib/governed-state.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const EXAMPLE_DIR = join(__dirname, '..', '..', 'examples', 'governed-todo-app');

const HOOK_AUDIT_PATH = '.agentxchain/hook-audit.jsonl';
const HOOK_ANNOTATIONS_PATH = '.agentxchain/hook-annotations.jsonl';

// ── Helpers ──────────────────────────────────────────────────────────────────

function readJson(root, relPath) {
  const parsed = JSON.parse(readFileSync(join(root, relPath), 'utf8'));
  if (relPath === STATE_PATH || relPath.endsWith('state.json')) {
    const normalized = normalizeGovernedStateShape(parsed).state;
    Object.defineProperty(normalized, 'current_turn', {
      configurable: true,
      enumerable: false,
      get() {
        return getActiveTurn(normalized);
      },
    });
    return normalized;
  }
  return parsed;
}

function readJsonl(root, relPath) {
  const fullPath = join(root, relPath);
  if (!existsSync(fullPath)) return [];
  const content = readFileSync(fullPath, 'utf8').trim();
  if (!content) return [];
  return content.split('\n').map(line => JSON.parse(line));
}

function writeHookScript(root, name, script) {
  const hooksDir = join(root, '.hooks');
  mkdirSync(hooksDir, { recursive: true });
  const scriptPath = join(hooksDir, name);
  writeFileSync(scriptPath, script);
  chmodSync(scriptPath, 0o755);
  return scriptPath;
}

function makeConfigWithHooks(hooks) {
  return {
    schema_version: 4,
    protocol_mode: 'governed',
    project: { id: 'hook-composition-e2e', name: 'Hook Composition E2E', default_branch: 'main' },
    roles: {
      pm: { title: 'Product Manager', mandate: 'Protect user value', write_authority: 'review_only', runtime_class: 'manual', runtime_id: 'manual-pm' },
      dev: { title: 'Developer', mandate: 'Implement approved work', write_authority: 'authoritative', runtime_class: 'local_cli', runtime_id: 'local-dev' },
      qa: { title: 'QA', mandate: 'Challenge correctness', write_authority: 'review_only', runtime_class: 'api_proxy', runtime_id: 'api-qa' },
    },
    runtimes: {
      'manual-pm': { type: 'manual' },
      'local-dev': { type: 'local_cli' },
      'api-qa': { type: 'api_proxy' },
    },
    routing: {
      planning: { entry_role: 'pm', allowed_next_roles: ['pm', 'dev', 'human'], exit_gate: 'planning_signoff' },
      implementation: { entry_role: 'dev', allowed_next_roles: ['dev', 'qa', 'human'], exit_gate: 'implementation_complete' },
      qa: { entry_role: 'qa', allowed_next_roles: ['dev', 'qa', 'human'], exit_gate: 'qa_ship_verdict' },
    },
    gates: {
      planning_signoff: { requires_human_approval: true },
      implementation_complete: { requires_verification_pass: true },
      qa_ship_verdict: { requires_human_approval: true },
    },
    budget: { per_turn_max_usd: 2.0, per_run_max_usd: 50.0 },
    rules: { challenge_required: true, max_turn_retries: 2, max_deadlock_cycles: 2 },
    files: { talk: 'TALK.md', history: '.agentxchain/history.jsonl', state: '.agentxchain/state.json' },
    compat: { next_owner_source: 'state-json', lock_based_coordination: false, original_version: 4 },
    hooks,
  };
}

function stageTurnResult(root, state, overrides = {}) {
  const turn = getActiveTurn(state);
  const base = {
    schema_version: '1.0',
    run_id: state.run_id,
    turn_id: turn.turn_id,
    role: turn.assigned_role,
    runtime_id: turn.runtime_id,
    status: 'completed',
    summary: `Turn completed by ${turn.assigned_role}.`,
    decisions: [{ id: 'DEC-001', category: 'implementation', statement: 'Approach chosen.', rationale: 'Best fit.' }],
    objections: [{ id: 'OBJ-001', severity: 'low', statement: 'Minor concern noted.', status: 'raised' }],
    files_changed: [],
    artifacts_created: [],
    verification: { status: 'pass', commands: ['echo ok'], evidence_summary: 'All good.', machine_evidence: [{ command: 'echo ok', exit_code: 0 }] },
    artifact: { type: 'review', ref: null },
    proposed_next_role: 'dev',
    phase_transition_request: null,
    run_completion_request: null,
    needs_human_reason: null,
    cost: { input_tokens: 100, output_tokens: 50, usd: 0.01 },
  };
  const result = { ...base, ...overrides };
  const stagingDir = join(root, '.agentxchain', 'staging');
  mkdirSync(stagingDir, { recursive: true });
  writeFileSync(join(root, STAGING_PATH), JSON.stringify(result, null, 2));
  return result;
}

// ── Scenario A: Blocking hook on before_validation halts acceptance ──────────

describe('E2E hook composition: blocking before_validation halts cleanly', () => {
  let root;

  before(() => {
    root = join(tmpdir(), `axc-hook-e2e-block-${randomBytes(6).toString('hex')}`);
    cpSync(EXAMPLE_DIR, root, { recursive: true });
    execSync('git init', { cwd: root, stdio: 'ignore' });
    execSync('git add -A', { cwd: root, stdio: 'ignore' });
    execSync('git -c user.name="test" -c user.email="test@test" commit -m "initial"', { cwd: root, stdio: 'ignore' });

    // Write a blocking before_validation hook that rejects turns from 'pm'
    writeHookScript(root, 'block-pm.sh', `#!/bin/sh
read INPUT
ROLE=$(echo "$INPUT" | node -e "const d=require('fs').readFileSync('/dev/stdin','utf8');const j=JSON.parse(d);process.stdout.write(j.payload?.role_id||'')")
if [ "$ROLE" = "pm" ]; then
  echo '{"verdict":"block","message":"PM turns require compliance review","annotations":[]}'
else
  echo '{"verdict":"allow","message":"ok","annotations":[]}'
fi
`);
  });

  after(() => {
    try { rmSync(root, { recursive: true, force: true }); } catch {}
  });

  it('blocks PM turn acceptance and records audit trail', () => {
    const hooks = {
      before_validation: [{
        name: 'compliance-gate',
        type: 'process',
        command: ['.hooks/block-pm.sh'],
        timeout_ms: 5000,
        mode: 'blocking',
      }],
    };
    const config = makeConfigWithHooks(hooks);

    // Init + assign PM
    const init = initializeGovernedRun(root, config);
    assert.ok(init.ok, `init failed: ${init.error}`);

    const assign = assignGovernedTurn(root, config, 'pm');
    assert.ok(assign.ok, `assign failed: ${assign.error}`);

    // Stage a valid turn result
    stageTurnResult(root, assign.state, {
      proposed_next_role: 'human',
    });

    // Accept should fail because blocking hook fires
    const accept = acceptGovernedTurn(root, config);
    assert.equal(accept.ok, false, 'acceptance should be blocked');
    assert.ok(accept.error.includes('compliance review') || accept.error.includes('compliance-gate'),
      `error should reference the hook: ${accept.error}`);

    // State should be blocked
    const state = readJson(root, STATE_PATH);
    assert.equal(state.status, 'blocked');
    assert.ok(state.blocked_on?.includes('hook:before_validation'));

    // History should be empty — turn was never committed
    const history = readJsonl(root, HISTORY_PATH);
    assert.equal(history.length, 0, 'history must be empty when hook blocks before commit');

    // Audit trail should record the blocking invocation
    const audit = readJsonl(root, HOOK_AUDIT_PATH);
    assert.ok(audit.length >= 1, 'hook-audit.jsonl should have at least one entry');
    const blockEntry = audit.find(e => e.hook_name === 'compliance-gate' && e.verdict === 'block');
    assert.ok(blockEntry, 'audit should contain the blocking verdict');
    assert.equal(blockEntry.hook_phase, 'before_validation');
    assert.ok(blockEntry.orchestrator_action === 'blocked', `expected blocked action, got ${blockEntry.orchestrator_action}`);
  });
});

// ── Scenario B: Advisory after_acceptance records annotations ────────────────

describe('E2E hook composition: advisory after_acceptance with annotations', () => {
  let root;
  let config;

  before(() => {
    root = join(tmpdir(), `axc-hook-e2e-advisory-${randomBytes(6).toString('hex')}`);
    cpSync(EXAMPLE_DIR, root, { recursive: true });
    execSync('git init', { cwd: root, stdio: 'ignore' });
    execSync('git add -A', { cwd: root, stdio: 'ignore' });
    execSync('git -c user.name="test" -c user.email="test@test" commit -m "initial"', { cwd: root, stdio: 'ignore' });

    // Advisory after_acceptance hook that emits annotations
    writeHookScript(root, 'annotate.sh', `#!/bin/sh
read INPUT
echo '{"verdict":"allow","message":"annotated","annotations":[{"key":"review_ticket","value":"REV-42"},{"key":"compliance_status","value":"passed"}]}'
`);

    // Advisory after_acceptance hook that tries to block (should be downgraded)
    writeHookScript(root, 'try-block.sh', `#!/bin/sh
read INPUT
echo '{"verdict":"block","message":"I tried to block but cannot","annotations":[{"key":"attempted_block","value":"true"}]}'
`);

    const hooks = {
      after_acceptance: [
        {
          name: 'annotator',
          type: 'process',
          command: ['.hooks/annotate.sh'],
          timeout_ms: 5000,
          mode: 'advisory',
        },
        {
          name: 'block-attempt',
          type: 'process',
          command: ['.hooks/try-block.sh'],
          timeout_ms: 5000,
          mode: 'advisory',
        },
      ],
    };
    config = makeConfigWithHooks(hooks);
  });

  after(() => {
    try { rmSync(root, { recursive: true, force: true }); } catch {}
  });

  it('accepts PM turn and records after_acceptance annotations', () => {
    const init = initializeGovernedRun(root, config);
    assert.ok(init.ok, `init failed: ${init.error}`);

    const assign = assignGovernedTurn(root, config, 'pm');
    assert.ok(assign.ok, `assign failed: ${assign.error}`);

    stageTurnResult(root, assign.state, {
      proposed_next_role: 'human',
      phase_transition_request: 'implementation',
    });

    const accept = acceptGovernedTurn(root, config);
    assert.ok(accept.ok, `acceptance should succeed: ${accept.error}`);

    // History should have 1 entry — the accepted PM turn
    const history = readJsonl(root, HISTORY_PATH);
    assert.equal(history.length, 1, 'history should have exactly 1 entry');
    assert.equal(history[0].role, 'pm');

    // hook-annotations.jsonl should have entries from both hooks
    const annotations = readJsonl(root, HOOK_ANNOTATIONS_PATH);
    assert.ok(annotations.length >= 1, 'annotations file should have entries');
    const reviewTicket = annotations.find(a => a.annotations?.some(ann => ann.key === 'review_ticket'));
    assert.ok(reviewTicket, 'should find review_ticket annotation');

    // Audit trail should record both hooks
    const audit = readJsonl(root, HOOK_AUDIT_PATH);
    const afterAcceptAudit = audit.filter(e => e.hook_phase === 'after_acceptance');
    assert.ok(afterAcceptAudit.length >= 2, `expected 2 after_acceptance audit entries, got ${afterAcceptAudit.length}`);

    // The block-attempt hook's verdict should be downgraded to warn
    const blockAttempt = afterAcceptAudit.find(e => e.hook_name === 'block-attempt');
    assert.ok(blockAttempt, 'block-attempt hook should appear in audit');
    assert.ok(
      blockAttempt.orchestrator_action === 'downgraded_block_to_warn' || blockAttempt.orchestrator_action === 'warned',
      `block should be downgraded, got ${blockAttempt.orchestrator_action}`,
    );
  });

  it('history.jsonl was only modified by the orchestrator path', () => {
    // Verify history content integrity — entries should have orchestrator-written fields
    const history = readJsonl(root, HISTORY_PATH);
    for (const entry of history) {
      assert.ok(entry.accepted_at, 'history entry must have accepted_at (orchestrator-written)');
      assert.ok(entry.turn_id, 'history entry must have turn_id');
      assert.ok(entry.role, 'history entry must have role');
      assert.ok(entry.run_id, 'history entry must have run_id');
    }

    // hook-annotations.jsonl should NOT contain history-like entries
    const annotations = readJsonl(root, HOOK_ANNOTATIONS_PATH);
    for (const entry of annotations) {
      assert.ok(!entry.accepted_at, 'annotation entries must NOT look like history entries');
    }
  });
});

// ── Scenario C: Multi-phase hooks compose in a full lifecycle ────────────────

describe('E2E hook composition: multi-phase hooks across full lifecycle', () => {
  let root;
  let config;

  before(() => {
    root = join(tmpdir(), `axc-hook-e2e-multi-${randomBytes(6).toString('hex')}`);
    cpSync(EXAMPLE_DIR, root, { recursive: true });
    execSync('git init', { cwd: root, stdio: 'ignore' });
    execSync('git add -A', { cwd: root, stdio: 'ignore' });
    execSync('git -c user.name="test" -c user.email="test@test" commit -m "initial"', { cwd: root, stdio: 'ignore' });

    // before_assignment: advisory — logs assignment attempts
    writeHookScript(root, 'log-assignment.sh', `#!/bin/sh
read INPUT
echo '{"verdict":"allow","message":"assignment logged","annotations":[]}'
`);

    // before_validation: advisory — warns but does not block
    writeHookScript(root, 'warn-validation.sh', `#!/bin/sh
read INPUT
echo '{"verdict":"warn","message":"Lint warnings detected","annotations":[]}'
`);

    // after_acceptance: advisory — attaches annotations
    writeHookScript(root, 'tag-acceptance.sh', `#!/bin/sh
read INPUT
echo '{"verdict":"allow","message":"tagged","annotations":[{"key":"ci_run","value":"ci-12345"},{"key":"coverage","value":"87"}]}'
`);

    // on_escalation: advisory — logs escalation
    writeHookScript(root, 'notify-escalation.sh', `#!/bin/sh
read INPUT
echo '{"verdict":"allow","message":"escalation notified","annotations":[]}'
`);

    const hooks = {
      before_assignment: [{
        name: 'assignment-logger',
        type: 'process',
        command: ['.hooks/log-assignment.sh'],
        timeout_ms: 5000,
        mode: 'advisory',
      }],
      before_validation: [{
        name: 'lint-checker',
        type: 'process',
        command: ['.hooks/warn-validation.sh'],
        timeout_ms: 5000,
        mode: 'advisory',
      }],
      after_acceptance: [{
        name: 'ci-tagger',
        type: 'process',
        command: ['.hooks/tag-acceptance.sh'],
        timeout_ms: 5000,
        mode: 'advisory',
      }],
      on_escalation: [{
        name: 'escalation-notifier',
        type: 'process',
        command: ['.hooks/notify-escalation.sh'],
        timeout_ms: 5000,
        mode: 'advisory',
      }],
    };
    config = makeConfigWithHooks(hooks);
  });

  after(() => {
    try { rmSync(root, { recursive: true, force: true }); } catch {}
  });

  it('Phase 1: initializes and assigns PM with before_assignment hook', () => {
    const init = initializeGovernedRun(root, config);
    assert.ok(init.ok, `init failed: ${init.error}`);

    const assign = assignGovernedTurn(root, config, 'pm');
    assert.ok(assign.ok, `assign failed: ${assign.error}`);

    // Audit should record before_assignment invocation
    const audit = readJsonl(root, HOOK_AUDIT_PATH);
    const assignAudit = audit.filter(e => e.hook_phase === 'before_assignment');
    assert.ok(assignAudit.length >= 1, 'before_assignment hook should be audited');
    assert.equal(assignAudit[0].hook_name, 'assignment-logger');
    assert.equal(assignAudit[0].verdict, 'allow');
  });

  it('Phase 1: accepts PM turn through before_validation (warn) and after_acceptance hooks', () => {
    const state = readJson(root, STATE_PATH);

    stageTurnResult(root, state, {
      proposed_next_role: 'human',
      phase_transition_request: 'implementation',
    });

    const accept = acceptGovernedTurn(root, config);
    assert.ok(accept.ok, `acceptance should succeed despite warn: ${accept.error}`);

    // History should have 1 entry
    const history = readJsonl(root, HISTORY_PATH);
    assert.equal(history.length, 1);

    // Audit should now have entries from multiple phases
    const audit = readJsonl(root, HOOK_AUDIT_PATH);
    const phases = new Set(audit.map(e => e.hook_phase));
    assert.ok(phases.has('before_assignment'), 'audit should include before_assignment');
    assert.ok(phases.has('before_validation'), 'audit should include before_validation');
    assert.ok(phases.has('after_acceptance'), 'audit should include after_acceptance');

    // before_validation should show warn action
    const warnEntry = audit.find(e => e.hook_phase === 'before_validation' && e.hook_name === 'lint-checker');
    assert.ok(warnEntry, 'lint-checker should be in audit');
    assert.equal(warnEntry.verdict, 'warn');

    // after_acceptance annotations should be persisted
    const annotations = readJsonl(root, HOOK_ANNOTATIONS_PATH);
    assert.ok(annotations.length >= 1, 'annotations should be recorded');
    const ciTag = annotations.find(a => a.annotations?.some(ann => ann.key === 'ci_run'));
    assert.ok(ciTag, 'ci_run annotation should be present');
  });

  it('Phase 1: approves phase transition to implementation', () => {
    const result = approvePhaseTransition(root);
    assert.ok(result.ok, `transition failed: ${result.error}`);
    assert.equal(result.state.phase, 'implementation');
  });

  it('Phase 2: assigns dev, accepts with hooks, transitions to qa', () => {
    execSync('git add -A', { cwd: root, stdio: 'ignore' });
    execSync('git -c user.name="test" -c user.email="test@test" commit -m "orchestrator: pm done" --allow-empty', { cwd: root, stdio: 'ignore' });

    const assign = assignGovernedTurn(root, config, 'dev');
    assert.ok(assign.ok, `assign dev failed: ${assign.error}`);

    const state = readJson(root, STATE_PATH);

    // Create dev artifact
    writeFileSync(join(root, 'index.js'), 'console.log("app");\n');
    execSync('git add -A', { cwd: root, stdio: 'ignore' });
    execSync('git -c user.name="test" -c user.email="test@test" commit -m "implement"', { cwd: root, stdio: 'ignore' });

    stageTurnResult(root, state, {
      files_changed: ['index.js'],
      artifact: { type: 'commit', ref: 'mock-sha' },
      phase_transition_request: 'qa',
      proposed_next_role: 'qa',
      verification: { status: 'pass', commands: ['node index.js'], evidence_summary: 'ok', machine_evidence: [{ command: 'node index.js', exit_code: 0 }] },
    });

    const accept = acceptGovernedTurn(root, config);
    assert.ok(accept.ok, `dev accept failed: ${accept.error}`);

    // Auto-transitions to qa (no human approval needed)
    assert.equal(accept.state.phase, 'qa');

    // History now has 2 entries
    const history = readJsonl(root, HISTORY_PATH);
    assert.equal(history.length, 2);
  });

  it('Phase 3: QA turn accepted with full hook composition', () => {
    execSync('git add -A', { cwd: root, stdio: 'ignore' });
    execSync('git -c user.name="test" -c user.email="test@test" commit -m "orchestrator: dev done" --allow-empty', { cwd: root, stdio: 'ignore' });

    const assign = assignGovernedTurn(root, config, 'qa');
    assert.ok(assign.ok, `assign qa failed: ${assign.error}`);

    const state = readJson(root, STATE_PATH);
    stageTurnResult(root, state, {
      run_completion_request: true,
      proposed_next_role: 'human',
      artifact: { type: 'review', ref: null },
    });

    const accept = acceptGovernedTurn(root, config);
    assert.ok(accept.ok, `qa accept failed: ${accept.error}`);

    // History has 3 entries
    const history = readJsonl(root, HISTORY_PATH);
    assert.equal(history.length, 3);
    assert.equal(history[0].role, 'pm');
    assert.equal(history[1].role, 'dev');
    assert.equal(history[2].role, 'qa');
  });

  it('final: audit trail covers all phases that fired', () => {
    const audit = readJsonl(root, HOOK_AUDIT_PATH);

    // Should have at least: 3x before_assignment + 3x before_validation + 3x after_acceptance
    assert.ok(audit.length >= 9, `expected at least 9 audit entries, got ${audit.length}`);

    // Count by phase
    const phaseCounts = {};
    for (const entry of audit) {
      phaseCounts[entry.hook_phase] = (phaseCounts[entry.hook_phase] || 0) + 1;
    }
    assert.ok(phaseCounts['before_assignment'] >= 3, `before_assignment should fire 3x, got ${phaseCounts['before_assignment']}`);
    assert.ok(phaseCounts['before_validation'] >= 3, `before_validation should fire 3x, got ${phaseCounts['before_validation']}`);
    assert.ok(phaseCounts['after_acceptance'] >= 3, `after_acceptance should fire 3x, got ${phaseCounts['after_acceptance']}`);

    // Every audit entry should have required fields
    for (const entry of audit) {
      assert.ok(entry.timestamp, 'audit entry needs timestamp');
      assert.ok(entry.hook_phase, 'audit entry needs hook_phase');
      assert.ok(entry.hook_name, 'audit entry needs hook_name');
      assert.ok(entry.orchestrator_action, 'audit entry needs orchestrator_action');
      assert.ok(typeof entry.duration_ms === 'number', 'audit entry needs numeric duration_ms');
    }
  });

  it('final: annotations only in hook-annotations.jsonl, never in history.jsonl', () => {
    const history = readJsonl(root, HISTORY_PATH);
    const annotations = readJsonl(root, HOOK_ANNOTATIONS_PATH);

    // Annotations file should have entries (3 after_acceptance invocations)
    assert.ok(annotations.length >= 3, `expected at least 3 annotation entries, got ${annotations.length}`);

    // History entries must NOT contain hook annotation keys
    for (const entry of history) {
      assert.equal(entry.ci_run, undefined, 'history must not contain hook annotation data');
      assert.equal(entry.coverage, undefined, 'history must not contain hook annotation data');
      assert.equal(entry.hook_annotations, undefined, 'history must not contain hook_annotations field');
    }

    // Annotations should reference correct turns and come from the ci-tagger hook
    for (const annEntry of annotations) {
      assert.ok(annEntry.hook_name, 'annotation entry needs hook_name');
      assert.equal(annEntry.hook_name, 'ci-tagger', 'annotations should come from the ci-tagger hook');
      assert.ok(annEntry.turn_id, 'annotation entry needs turn_id');
      assert.ok(annEntry.annotations?.length > 0, 'annotation entry needs annotations array');
    }
  });

  it('final: history.jsonl integrity — only orchestrator-written fields', () => {
    const history = readJsonl(root, HISTORY_PATH);
    assert.equal(history.length, 3);

    for (const entry of history) {
      // Orchestrator-written fields must be present
      assert.ok(entry.accepted_at, 'must have accepted_at');
      assert.ok(entry.turn_id, 'must have turn_id');
      assert.ok(entry.role, 'must have role');
      assert.ok(entry.run_id, 'must have run_id');
    }
  });
});

// ── Scenario D: complete lifecycle covers post-validation and gate hooks ─────

describe('E2E hook composition: full lifecycle includes after_validation, before_acceptance, and before_gate', () => {
  let root;
  let config;
  let pmTurnId;
  let devTurnId;
  let qaTurnId;

  before(() => {
    root = join(tmpdir(), `axc-hook-e2e-full-${randomBytes(6).toString('hex')}`);
    cpSync(EXAMPLE_DIR, root, { recursive: true });
    execSync('git init', { cwd: root, stdio: 'ignore' });
    execSync('git add -A', { cwd: root, stdio: 'ignore' });
    execSync('git -c user.name="test" -c user.email="test@test" commit -m "initial"', { cwd: root, stdio: 'ignore' });

    writeHookScript(root, 'assignment-logger.sh', `#!/bin/sh
read INPUT
echo '{"verdict":"allow","message":"assignment recorded","annotations":[]}'
`);

    writeHookScript(root, 'warn-before-validation.sh', `#!/bin/sh
read INPUT
echo '{"verdict":"warn","message":"before_validation advisory","annotations":[]}'
`);

    writeHookScript(root, 'after-validation.sh', `#!/bin/sh
INPUT=$(cat)
VALIDATION_OK=$(printf "%s" "$INPUT" | node -e "const d=require('fs').readFileSync(0,'utf8');const j=JSON.parse(d);process.stdout.write(String(Boolean(j.payload?.validation_ok)))")
echo "{\\"verdict\\":\\"warn\\",\\"message\\":\\"after_validation:validation_ok=\${VALIDATION_OK}\\",\\"annotations\\":[]}"
`);

    writeHookScript(root, 'before-acceptance.sh', `#!/bin/sh
INPUT=$(cat)
TOTAL=$(printf "%s" "$INPUT" | node -e "const d=require('fs').readFileSync(0,'utf8');const j=JSON.parse(d);const c=j.payload?.observed_changes||{};const total=(c.added?.length||0)+(c.modified?.length||0)+(c.deleted?.length||0);process.stdout.write(String(total))")
echo "{\\"verdict\\":\\"allow\\",\\"message\\":\\"before_acceptance:observed_changes=\${TOTAL}\\",\\"annotations\\":[]}"
`);

    writeHookScript(root, 'after-acceptance.sh', `#!/bin/sh
INPUT=$(cat)
PHASE=$(printf "%s" "$INPUT" | node -e "const d=require('fs').readFileSync(0,'utf8');const j=JSON.parse(d);process.stdout.write(j.payload?.phase||'unknown')")
echo "{\\"verdict\\":\\"allow\\",\\"message\\":\\"after_acceptance:\${PHASE}\\",\\"annotations\\":[{\\"key\\":\\"accept_phase\\",\\"value\\":\\"\${PHASE}\\"}]}"
`);

    writeHookScript(root, 'before-gate.sh', `#!/bin/sh
INPUT=$(cat)
GATE_TYPE=$(printf "%s" "$INPUT" | node -e "const d=require('fs').readFileSync(0,'utf8');const j=JSON.parse(d);process.stdout.write(j.payload?.gate_type||'unknown')")
echo "{\\"verdict\\":\\"allow\\",\\"message\\":\\"before_gate:\${GATE_TYPE}\\",\\"annotations\\":[]}"
`);

    config = makeConfigWithHooks({
      before_assignment: [{
        name: 'assignment-logger',
        type: 'process',
        command: ['.hooks/assignment-logger.sh'],
        timeout_ms: 5000,
        mode: 'advisory',
      }],
      before_validation: [{
        name: 'before-validation-check',
        type: 'process',
        command: ['.hooks/warn-before-validation.sh'],
        timeout_ms: 5000,
        mode: 'advisory',
      }],
      after_validation: [{
        name: 'after-validation-check',
        type: 'process',
        command: ['.hooks/after-validation.sh'],
        timeout_ms: 5000,
        mode: 'advisory',
      }],
      before_acceptance: [{
        name: 'before-acceptance-check',
        type: 'process',
        command: ['.hooks/before-acceptance.sh'],
        timeout_ms: 5000,
        mode: 'blocking',
      }],
      after_acceptance: [{
        name: 'after-acceptance-tag',
        type: 'process',
        command: ['.hooks/after-acceptance.sh'],
        timeout_ms: 5000,
        mode: 'advisory',
      }],
      before_gate: [{
        name: 'before-gate-check',
        type: 'process',
        command: ['.hooks/before-gate.sh'],
        timeout_ms: 5000,
        mode: 'blocking',
      }],
    });
  });

  after(() => {
    try { rmSync(root, { recursive: true, force: true }); } catch {}
  });

  it('completes a governed run while auditing the remaining hook phases', () => {
    const init = initializeGovernedRun(root, config);
    assert.ok(init.ok, `init failed: ${init.error}`);

    const assignPm = assignGovernedTurn(root, config, 'pm');
    assert.ok(assignPm.ok, `assign pm failed: ${assignPm.error}`);
    pmTurnId = assignPm.state.current_turn.turn_id;

    stageTurnResult(root, assignPm.state, {
      proposed_next_role: 'human',
      phase_transition_request: 'implementation',
    });

    const acceptPm = acceptGovernedTurn(root, config);
    assert.ok(acceptPm.ok, `accept pm failed: ${acceptPm.error}`);
    assert.equal(acceptPm.state.status, 'paused');

    const approvePlanning = approvePhaseTransition(root, config);
    assert.ok(approvePlanning.ok, `approve planning failed: ${approvePlanning.error}`);
    assert.equal(approvePlanning.state.phase, 'implementation');

    execSync('git add -A', { cwd: root, stdio: 'ignore' });
    execSync('git -c user.name="test" -c user.email="test@test" commit -m "orchestrator: planning accepted" --allow-empty', { cwd: root, stdio: 'ignore' });

    const assignDev = assignGovernedTurn(root, config, 'dev');
    assert.ok(assignDev.ok, `assign dev failed: ${assignDev.error}`);
    devTurnId = assignDev.state.current_turn.turn_id;

    writeFileSync(join(root, 'index.js'), 'console.log("hook coverage");\n');
    execSync('git add -A', { cwd: root, stdio: 'ignore' });
    execSync('git -c user.name="test" -c user.email="test@test" commit -m "implement hook lifecycle fixture"', { cwd: root, stdio: 'ignore' });

    stageTurnResult(root, assignDev.state, {
      files_changed: ['index.js'],
      artifact: { type: 'commit', ref: 'mock-sha' },
      phase_transition_request: 'qa',
      proposed_next_role: 'qa',
      verification: { status: 'pass', commands: ['node index.js'], evidence_summary: 'ok', machine_evidence: [{ command: 'node index.js', exit_code: 0 }] },
    });

    const acceptDev = acceptGovernedTurn(root, config);
    assert.ok(acceptDev.ok, `accept dev failed: ${acceptDev.error}`);
    assert.equal(acceptDev.state.phase, 'qa');

    execSync('git add -A', { cwd: root, stdio: 'ignore' });
    execSync('git -c user.name="test" -c user.email="test@test" commit -m "orchestrator: dev accepted" --allow-empty', { cwd: root, stdio: 'ignore' });

    const assignQa = assignGovernedTurn(root, config, 'qa');
    assert.ok(assignQa.ok, `assign qa failed: ${assignQa.error}`);
    qaTurnId = assignQa.state.current_turn.turn_id;

    stageTurnResult(root, assignQa.state, {
      run_completion_request: true,
      proposed_next_role: 'human',
      artifact: { type: 'review', ref: null },
    });

    const acceptQa = acceptGovernedTurn(root, config);
    assert.ok(acceptQa.ok, `accept qa failed: ${acceptQa.error}`);
    assert.equal(acceptQa.state.status, 'paused');
    assert.ok(acceptQa.state.pending_run_completion, 'run completion should require approval');

    const approveCompletion = approveRunCompletion(root, config);
    assert.ok(approveCompletion.ok, `approve completion failed: ${approveCompletion.error}`);
    assert.equal(approveCompletion.state.status, 'completed');

    const history = readJsonl(root, HISTORY_PATH);
    assert.equal(history.length, 3, 'history should contain exactly 3 accepted turns');

    const audit = readJsonl(root, HOOK_AUDIT_PATH);
    const phaseCounts = {};
    for (const entry of audit) {
      phaseCounts[entry.hook_phase] = (phaseCounts[entry.hook_phase] || 0) + 1;
    }

    assert.equal(phaseCounts.before_assignment, 3, `before_assignment should fire 3 times, got ${phaseCounts.before_assignment}`);
    assert.equal(phaseCounts.before_validation, 3, `before_validation should fire 3 times, got ${phaseCounts.before_validation}`);
    assert.equal(phaseCounts.after_validation, 3, `after_validation should fire 3 times, got ${phaseCounts.after_validation}`);
    assert.equal(phaseCounts.before_acceptance, 3, `before_acceptance should fire 3 times, got ${phaseCounts.before_acceptance}`);
    assert.equal(phaseCounts.after_acceptance, 3, `after_acceptance should fire 3 times, got ${phaseCounts.after_acceptance}`);
    assert.equal(phaseCounts.before_gate, 2, `before_gate should fire 2 times, got ${phaseCounts.before_gate}`);

    const turnPhaseSequence = (turnId) => audit
      .filter(entry => entry.turn_id === turnId)
      .map(entry => entry.hook_phase);

    assert.deepEqual(
      turnPhaseSequence(pmTurnId),
      ['before_validation', 'after_validation', 'before_acceptance', 'after_acceptance'],
      'pm turn should record the full acceptance hook order',
    );
    assert.deepEqual(
      turnPhaseSequence(devTurnId),
      ['before_validation', 'after_validation', 'before_acceptance', 'after_acceptance'],
      'dev turn should record the full acceptance hook order',
    );
    assert.deepEqual(
      turnPhaseSequence(qaTurnId),
      ['before_validation', 'after_validation', 'before_acceptance', 'after_acceptance'],
      'qa turn should record the full acceptance hook order',
    );

    const afterValidationMessages = audit
      .filter(entry => entry.hook_phase === 'after_validation')
      .map(entry => entry.message);
    assert.ok(
      afterValidationMessages.every(message => message === 'after_validation:validation_ok=true'),
      `after_validation messages should confirm validation success, got ${afterValidationMessages.join(', ')}`,
    );

    const beforeAcceptanceDev = audit.find(
      entry => entry.turn_id === devTurnId && entry.hook_phase === 'before_acceptance',
    );
    assert.ok(beforeAcceptanceDev, 'dev before_acceptance audit entry must exist');
    assert.equal(
      beforeAcceptanceDev.message,
      'before_acceptance:observed_changes=1',
      'dev before_acceptance hook should see one observed file change',
    );

    const gateMessages = audit
      .filter(entry => entry.hook_phase === 'before_gate')
      .map(entry => entry.message);
    assert.deepEqual(
      gateMessages,
      ['before_gate:phase_transition', 'before_gate:run_completion'],
      'before_gate should audit both human approval types in order',
    );

    const annotations = readJsonl(root, HOOK_ANNOTATIONS_PATH);
    assert.equal(annotations.length, 3, 'after_acceptance should append one annotation entry per accepted turn');
    for (const entry of annotations) {
      assert.equal(entry.hook_name, 'after-acceptance-tag');
      assert.equal(entry.annotations?.[0]?.key, 'accept_phase');
    }

    for (const entry of history) {
      assert.equal(entry.accept_phase, undefined, 'history must not contain hook annotation data');
      assert.equal(entry.hook_name, undefined, 'history must remain orchestrator-owned');
    }
  });
});

// ── Scenario E: before_gate block preserves approval and supports replay ────

describe('E2E hook composition: before_gate block preserves pending approval for replay', () => {
  let root;
  let config;

  before(() => {
    root = join(tmpdir(), `axc-hook-e2e-gate-replay-${randomBytes(6).toString('hex')}`);
    cpSync(EXAMPLE_DIR, root, { recursive: true });
    execSync('git init', { cwd: root, stdio: 'ignore' });
    execSync('git add -A', { cwd: root, stdio: 'ignore' });
    execSync('git -c user.name="test" -c user.email="test@test" commit -m "initial"', { cwd: root, stdio: 'ignore' });

    writeHookScript(root, 'replayable-before-gate.sh', `#!/bin/sh
if [ -f ".hooks/allow-gate" ]; then
  echo '{"verdict":"allow","message":"gate replay approved","annotations":[]}'
else
  echo '{"verdict":"block","message":"gate replay requires operator fix","annotations":[]}'
fi
`);

    config = makeConfigWithHooks({
      before_gate: [{
        name: 'replayable-gate',
        type: 'process',
        command: ['.hooks/replayable-before-gate.sh'],
        timeout_ms: 5000,
        mode: 'blocking',
      }],
    });
  });

  after(() => {
    try { rmSync(root, { recursive: true, force: true }); } catch {}
  });

  it('blocks once, retains pending phase approval, then succeeds when replayed', () => {
    const init = initializeGovernedRun(root, config);
    assert.ok(init.ok, `init failed: ${init.error}`);

    const assignPm = assignGovernedTurn(root, config, 'pm');
    assert.ok(assignPm.ok, `assign pm failed: ${assignPm.error}`);

    stageTurnResult(root, assignPm.state, {
      proposed_next_role: 'human',
      phase_transition_request: 'implementation',
    });

    const acceptPm = acceptGovernedTurn(root, config);
    assert.ok(acceptPm.ok, `accept pm failed: ${acceptPm.error}`);
    assert.equal(acceptPm.state.status, 'paused');
    assert.ok(acceptPm.state.pending_phase_transition, 'planning approval should be pending before hook replay');

    const blockedApproval = approvePhaseTransition(root, config);
    assert.equal(blockedApproval.ok, false, 'first approval should block');
    assert.equal(blockedApproval.state.status, 'blocked');
    assert.equal(blockedApproval.state.phase, 'planning');
    assert.ok(blockedApproval.state.pending_phase_transition, 'pending approval must survive the hook block');
    assert.equal(
      blockedApproval.state.blocked_reason?.recovery?.recovery_action,
      'agentxchain approve-transition',
      'recovery should point back to the same approval command',
    );

    writeFileSync(join(root, '.hooks', 'allow-gate'), 'allow\n');

    const replayedApproval = approvePhaseTransition(root, config);
    assert.ok(replayedApproval.ok, `replayed approval failed: ${replayedApproval.error}`);
    assert.equal(replayedApproval.state.status, 'active');
    assert.equal(replayedApproval.state.phase, 'implementation');
    assert.equal(replayedApproval.state.pending_phase_transition, null);
    assert.equal(replayedApproval.state.blocked_on, null);
    assert.equal(replayedApproval.state.blocked_reason, null);

    const audit = readJsonl(root, HOOK_AUDIT_PATH)
      .filter(entry => entry.hook_phase === 'before_gate');
    assert.equal(audit.length, 2, `expected 2 before_gate audits, got ${audit.length}`);
    assert.equal(audit[0].verdict, 'block');
    assert.equal(audit[1].verdict, 'allow');
  });
});

// ── Scenario F: on_escalation fires for non-hook blocks only ─────────────────

describe('E2E hook composition: on_escalation exclusion for hook-caused blocks', () => {
  let root;

  before(() => {
    root = join(tmpdir(), `axc-hook-e2e-esc-${randomBytes(6).toString('hex')}`);
    cpSync(EXAMPLE_DIR, root, { recursive: true });
    execSync('git init', { cwd: root, stdio: 'ignore' });
    execSync('git add -A', { cwd: root, stdio: 'ignore' });
    execSync('git -c user.name="test" -c user.email="test@test" commit -m "initial"', { cwd: root, stdio: 'ignore' });

    // on_escalation hook that records invocations to a marker file
    writeHookScript(root, 'escalation-marker.sh', `#!/bin/sh
read INPUT
echo "$INPUT" >> "${root}/.hooks/escalation-fired.log"
echo '{"verdict":"allow","message":"escalation received","annotations":[]}'
`);

    // Blocking before_validation hook
    writeHookScript(root, 'always-block.sh', `#!/bin/sh
read INPUT
echo '{"verdict":"block","message":"always blocks","annotations":[]}'
`);
  });

  after(() => {
    try { rmSync(root, { recursive: true, force: true }); } catch {}
  });

  it('on_escalation does NOT fire when a hook causes the block', () => {
    const hooks = {
      before_validation: [{
        name: 'always-blocker',
        type: 'process',
        command: ['.hooks/always-block.sh'],
        timeout_ms: 5000,
        mode: 'blocking',
      }],
      on_escalation: [{
        name: 'escalation-marker',
        type: 'process',
        command: ['.hooks/escalation-marker.sh'],
        timeout_ms: 5000,
        mode: 'advisory',
      }],
    };
    const config = makeConfigWithHooks(hooks);

    const init = initializeGovernedRun(root, config);
    assert.ok(init.ok);

    const assign = assignGovernedTurn(root, config, 'pm');
    assert.ok(assign.ok);

    stageTurnResult(root, assign.state, { proposed_next_role: 'human' });

    // This should block because of the hook
    const accept = acceptGovernedTurn(root, config);
    assert.equal(accept.ok, false);

    const state = readJson(root, STATE_PATH);
    assert.equal(state.status, 'blocked');

    // The escalation marker file should NOT exist — on_escalation must not fire
    // because blockRunForHookIssue does not trigger on_escalation
    const markerExists = existsSync(join(root, '.hooks', 'escalation-fired.log'));
    assert.equal(markerExists, false, 'on_escalation must NOT fire for hook-caused blocks');

    // Audit trail should have the blocking hook but NOT an on_escalation entry
    const audit = readJsonl(root, HOOK_AUDIT_PATH);
    const escalationAudit = audit.filter(e => e.hook_phase === 'on_escalation');
    assert.equal(escalationAudit.length, 0, 'on_escalation should not appear in audit for hook-caused blocks');
  });

  it('on_escalation DOES fire for non-hook blocks (markRunBlocked)', () => {
    // Use a fresh temp dir for the positive escalation test
    const root2 = join(tmpdir(), `axc-hook-e2e-esc2-${randomBytes(6).toString('hex')}`);
    cpSync(EXAMPLE_DIR, root2, { recursive: true });
    execSync('git init', { cwd: root2, stdio: 'ignore' });
    execSync('git add -A', { cwd: root2, stdio: 'ignore' });
    execSync('git -c user.name="test" -c user.email="test@test" commit -m "initial"', { cwd: root2, stdio: 'ignore' });

    // Reuse the escalation marker hook
    writeHookScript(root2, 'escalation-marker.sh', `#!/bin/sh
read INPUT
echo '{"verdict":"allow","message":"escalation received","annotations":[]}'
`);

    const hooks = {
      on_escalation: [{
        name: 'escalation-marker',
        type: 'process',
        command: ['.hooks/escalation-marker.sh'],
        timeout_ms: 5000,
        mode: 'advisory',
      }],
    };
    const config2 = makeConfigWithHooks(hooks);

    const init = initializeGovernedRun(root2, config2);
    assert.ok(init.ok, `init failed: ${init.error}`);

    // Manually block run (non-hook cause)
    const blockResult = markRunBlocked(root2, {
      blockedOn: 'human:dependency_missing',
      category: 'external_dependency',
      recovery: { typed_reason: 'external_dependency', owner: 'human', recovery_action: 'Install dep', detail: 'Missing npm package' },
      hooksConfig: hooks,
    });
    assert.ok(blockResult.ok !== false, 'markRunBlocked should succeed');

    // Audit should show on_escalation hook invocation
    const audit = readJsonl(root2, HOOK_AUDIT_PATH);
    const escalationAudit = audit.filter(e => e.hook_phase === 'on_escalation');
    assert.ok(escalationAudit.length >= 1, 'on_escalation should fire for non-hook blocks');
    assert.equal(escalationAudit[0].hook_name, 'escalation-marker');

    // Cleanup
    try { rmSync(root2, { recursive: true, force: true }); } catch {}
  });
});
