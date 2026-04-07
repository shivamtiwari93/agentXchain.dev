import { mkdirSync, writeFileSync, readFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { randomBytes } from 'crypto';
import { execSync } from 'child_process';
import chalk from 'chalk';

/**
 * `agentxchain demo` — zero-friction first-run experience.
 *
 * Runs a complete PM → Dev → QA governed lifecycle in a temp dir
 * using programmatically staged turn results. No API keys, no
 * external tools, no manual steps. Shows governance in action.
 */

// ── Config ──────────────────────────────────────────────────────────────────

function makeConfig() {
  return {
    schema_version: 4,
    protocol_mode: 'governed',
    project: { id: 'agentxchain-demo', name: 'AgentXchain Demo', default_branch: 'main' },
    roles: {
      pm: {
        title: 'Product Manager',
        mandate: 'Protect user value, scope clarity, and acceptance criteria.',
        write_authority: 'review_only',
        runtime_class: 'manual',
        runtime_id: 'manual-pm',
      },
      dev: {
        title: 'Developer',
        mandate: 'Implement approved work safely and verify behavior.',
        write_authority: 'authoritative',
        runtime_class: 'manual',
        runtime_id: 'manual-dev',
      },
      qa: {
        title: 'QA Reviewer',
        mandate: 'Challenge correctness, acceptance coverage, and ship readiness.',
        write_authority: 'review_only',
        runtime_class: 'manual',
        runtime_id: 'manual-qa',
      },
    },
    runtimes: {
      'manual-pm': { type: 'manual' },
      'manual-dev': { type: 'manual' },
      'manual-qa': { type: 'manual' },
    },
    routing: {
      planning: {
        entry_role: 'pm',
        allowed_next_roles: ['pm', 'human'],
        exit_gate: 'planning_signoff',
      },
      implementation: {
        entry_role: 'dev',
        allowed_next_roles: ['dev', 'qa', 'human'],
        exit_gate: 'implementation_complete',
      },
      qa: {
        entry_role: 'qa',
        allowed_next_roles: ['dev', 'qa', 'human'],
        exit_gate: 'qa_ship_verdict',
      },
    },
    gates: {
      planning_signoff: {
        requires_files: ['.planning/PM_SIGNOFF.md'],
        requires_human_approval: true,
      },
      implementation_complete: {
        requires_files: ['.planning/IMPLEMENTATION_NOTES.md'],
        requires_verification_pass: true,
      },
      qa_ship_verdict: {
        requires_files: ['.planning/acceptance-matrix.md', '.planning/ship-verdict.md'],
        requires_human_approval: true,
      },
    },
    budget: { per_turn_max_usd: 1.0, per_run_max_usd: 5.0 },
    rules: { challenge_required: true, max_turn_retries: 2, max_deadlock_cycles: 1 },
    files: {
      talk: 'TALK.md',
      history: '.agentxchain/history.jsonl',
      state: '.agentxchain/state.json',
    },
    compat: {
      next_owner_source: 'state-json',
      lock_based_coordination: false,
      original_version: 4,
    },
  };
}

// ── Canned turn results ─────────────────────────────────────────────────────

function makePmTurnResult(runId, turnId) {
  return {
    schema_version: '1.0',
    run_id: runId,
    turn_id: turnId,
    role: 'pm',
    runtime_id: 'manual-pm',
    status: 'completed',
    summary: 'Scoped auth token rotation service: key expiry, graceful rollover, and audit logging. Established 3 acceptance criteria with security constraints.',
    decisions: [
      {
        id: 'DEC-001',
        category: 'scope',
        statement: 'MVP scope: single-module token rotation with expiry check, graceful rollover, and audit trail.',
        rationale: 'Security-sensitive surface — minimal scope reduces attack surface while proving governance value.',
      },
      {
        id: 'DEC-002',
        category: 'scope',
        statement: 'Three acceptance criteria: safe rotation with rollback, monotonic expiry checks, and audit log on every lifecycle event.',
        rationale: 'Each criterion maps to a testable assertion. Compliance requires traceability.',
      },
    ],
    objections: [
      {
        id: 'OBJ-001',
        severity: 'high',
        statement: 'No rollback plan if new tokens fail validation. Live API keys could be invalidated without a recovery path.',
        status: 'raised',
      },
    ],
    files_changed: [],
    artifacts_created: [],
    verification: {
      status: 'pass',
      commands: [],
      evidence_summary: 'Planning review — no code to verify.',
      machine_evidence: [],
    },
    artifact: { type: 'review', ref: null },
    proposed_next_role: 'human',
    phase_transition_request: 'implementation',
    needs_human_reason: null,
    cost: { input_tokens: 0, output_tokens: 0, usd: 0 },
  };
}

function makeDevTurnResult(runId, turnId) {
  return {
    schema_version: '1.0',
    run_id: runId,
    turn_id: turnId,
    role: 'dev',
    runtime_id: 'manual-dev',
    status: 'completed',
    summary: 'Implemented token rotation with rollback, monotonic expiry, and audit trail. All 3 tests passing.',
    decisions: [
      {
        id: 'DEC-003',
        category: 'implementation',
        statement: 'Added atomic rollback: new token is validated before old token is invalidated.',
        rationale: 'Addresses OBJ-001 — live keys are never invalidated without a validated replacement.',
      },
    ],
    objections: [
      {
        id: 'OBJ-002',
        severity: 'medium',
        statement: 'Token expiry check uses wall-clock time without monotonic fallback. Clock skew could skip rotation or double-rotate.',
        status: 'raised',
      },
    ],
    files_changed: ['token-rotator.js', 'token-rotator.test.js', '.planning/IMPLEMENTATION_NOTES.md'],
    artifacts_created: [],
    verification: {
      status: 'pass',
      commands: ['node token-rotator.test.js'],
      evidence_summary: '3/3 tests passing: safe rotation with rollback, expiry bounds, audit emission.',
      machine_evidence: [
        { command: 'node token-rotator.test.js', exit_code: 0, stdout_excerpt: '3 tests passed, 0 failed' },
      ],
    },
    artifact: { type: 'commit', ref: 'token-rotator.js' },
    proposed_next_role: 'qa',
    phase_transition_request: 'qa',
    needs_human_reason: null,
    cost: { input_tokens: 0, output_tokens: 0, usd: 0 },
  };
}

function makeQaTurnResult(runId, turnId) {
  return {
    schema_version: '1.0',
    run_id: runId,
    turn_id: turnId,
    role: 'qa',
    runtime_id: 'manual-qa',
    status: 'completed',
    summary: 'Reviewed token rotation against acceptance matrix. All 3 criteria met. Ship verdict: YES.',
    decisions: [
      {
        id: 'DEC-004',
        category: 'quality',
        statement: 'All acceptance criteria verified: rollback safety, expiry monotonicity, and audit completeness.',
        rationale: 'Token rotation, rollback, and audit trail all function as specified.',
      },
      {
        id: 'DEC-005',
        category: 'release',
        statement: 'Ship verdict: YES. Security-sensitive implementation meets all acceptance criteria.',
        rationale: 'OBJ-002 (clock skew) is noted for follow-up but not blocking for controlled environments.',
      },
    ],
    objections: [
      {
        id: 'OBJ-003',
        severity: 'medium',
        statement: 'No audit entry emitted on rotation failure. Compliance requires traceability for every key lifecycle event.',
        status: 'raised',
      },
    ],
    files_changed: [],
    artifacts_created: [],
    verification: {
      status: 'pass',
      commands: [],
      evidence_summary: 'Review-only turn. Verified against acceptance matrix.',
      machine_evidence: [],
    },
    artifact: { type: 'review', ref: null },
    proposed_next_role: 'human',
    phase_transition_request: null,
    run_completion_request: true,
    needs_human_reason: null,
    cost: { input_tokens: 0, output_tokens: 0, usd: 0 },
  };
}

// ── Scaffold helpers ────────────────────────────────────────────────────────

function scaffoldProject(root) {
  const config = makeConfig();
  writeFileSync(join(root, 'agentxchain.json'), JSON.stringify(config, null, 2));
  mkdirSync(join(root, '.agentxchain/prompts'), { recursive: true });
  mkdirSync(join(root, '.planning'), { recursive: true });

  writeFileSync(join(root, '.agentxchain/state.json'), JSON.stringify({
    schema_version: '1.1',
    status: 'idle',
    phase: 'planning',
    run_id: null,
    active_turns: {},
    next_role: null,
    pending_phase_transition: null,
    pending_run_completion: null,
    blocked_on: null,
    blocked_reason: null,
  }, null, 2));

  writeFileSync(join(root, '.agentxchain/history.jsonl'), '');
  writeFileSync(join(root, '.agentxchain/decision-ledger.jsonl'), '');
  writeFileSync(join(root, '.agentxchain/prompts/pm.md'), '# PM Prompt\nYou are the Product Manager.');
  writeFileSync(join(root, '.agentxchain/prompts/dev.md'), '# Dev Prompt\nYou are the Developer.');
  writeFileSync(join(root, '.agentxchain/prompts/qa.md'), '# QA Prompt\nYou are the QA Reviewer.');
  writeFileSync(join(root, 'TALK.md'), '# Collaboration Log\n');

  // Planning artifacts — PM_SIGNOFF starts blocked (flipped after PM turn)
  writeFileSync(join(root, '.planning/PM_SIGNOFF.md'), '# PM Planning Sign-Off\n\nApproved: NO\n');
  writeFileSync(join(root, '.planning/ROADMAP.md'), '# Roadmap\n\n(PM fills this)\n');

  return config;
}

function gitInit(root) {
  execSync('git init', { cwd: root, stdio: 'ignore' });
  execSync('git config user.email "demo@agentxchain.dev"', { cwd: root, stdio: 'ignore' });
  execSync('git config user.name "AgentXchain Demo"', { cwd: root, stdio: 'ignore' });
  execSync('git add -A', { cwd: root, stdio: 'ignore' });
  execSync('git commit -m "demo: scaffold governed project"', { cwd: root, stdio: 'ignore' });
}

function gitCommit(root, message) {
  execSync('git add -A', { cwd: root, stdio: 'ignore' });
  execSync(`git commit -m "${message}" --allow-empty`, { cwd: root, stdio: 'ignore' });
}

function stageTurnResult(root, turnId, result) {
  const stagingDir = join(root, '.agentxchain/staging', turnId);
  mkdirSync(stagingDir, { recursive: true });
  writeFileSync(join(stagingDir, 'turn-result.json'), JSON.stringify(result, null, 2));
}

// ── Output helpers ──────────────────────────────────────────────────────────

function header(text) {
  console.log('');
  console.log(chalk.bold.cyan(`  ── ${text} ──`));
}

function step(text) {
  console.log(chalk.dim('  ▸ ') + text);
}

function lesson(text) {
  console.log(chalk.dim('    → ') + chalk.italic(text));
}

function success(text) {
  console.log(chalk.dim('  ▸ ') + chalk.green(text));
}

// ── Main ────────────────────────────────────────────────────────────────────

export async function demoCommand(opts = {}) {
  const jsonMode = opts.json || false;
  const verbose = opts.verbose || false;
  const startTime = Date.now();

  const root = join(tmpdir(), `agentxchain-demo-${randomBytes(6).toString('hex')}`);
  mkdirSync(root, { recursive: true });

  const result = {
    ok: false,
    run_id: null,
    turns: [],
    decisions: 0,
    objections: 0,
    duration_ms: 0,
    error: null,
  };

  try {
    // Verify git is available
    try {
      execSync('git --version', { stdio: 'ignore' });
    } catch {
      throw new Error('git is required for the demo but was not found in PATH');
    }

    // Lazy-load runner interface to avoid circular imports at module level
    const {
      initRun,
      assignTurn,
      acceptTurn,
      approvePhaseGate,
      approveCompletionGate,
    } = await import('../lib/runner-interface.js');

    if (!jsonMode) {
      console.log('');
      console.log(chalk.bold('  AgentXchain Demo — Governed Multi-Agent Delivery'));
      console.log(chalk.dim('  ' + '─'.repeat(51)));
    }

    // ── Scaffold ──────────────────────────────────────────────────────────
    if (!jsonMode) step('Scaffolding governed project...');
    const config = scaffoldProject(root);
    gitInit(root);

    // ── Init run ──────────────────────────────────────────────────────────
    const runResult = initRun(root, config);
    if (!runResult.ok) throw new Error(`initRun failed: ${runResult.error}`);
    const runId = runResult.state.run_id;
    result.run_id = runId;

    if (!jsonMode) step(`Starting governed run: ${chalk.bold(runId.slice(0, 16))}...`);

    // ── PM Turn (Planning) ────────────────────────────────────────────────
    if (!jsonMode) header('PM Turn — Planning Phase');

    const pmAssign = assignTurn(root, config, 'pm');
    if (!pmAssign.ok) throw new Error(`PM assign failed: ${pmAssign.error}`);
    const pmTurnId = pmAssign.turn.turn_id;

    if (!jsonMode) step(`Assigned PM turn: ${chalk.dim(pmTurnId.slice(0, 16))}...`);

    // Stage PM turn result
    const pmResult = makePmTurnResult(runId, pmTurnId);
    stageTurnResult(root, pmTurnId, pmResult);

    if (!jsonMode) {
      step('PM scoped auth token rotation: key expiry, graceful rollover, audit trail');
      step(`PM raised ${chalk.yellow('1 objection')}: "No rollback plan — live API keys could be invalidated without recovery"`);
      lesson('Without mandatory challenge, this missing rollback plan would have reached implementation unchecked');
      step(`PM recorded ${chalk.blue('2 decisions')} in the decision ledger`);
    }

    // Write planning artifacts BEFORE acceptance
    writeFileSync(join(root, '.planning/ROADMAP.md'),
      '# Roadmap\n\n## Acceptance Criteria\n\n1. Token rotation with atomic rollback — old key stays valid until new key is verified\n2. Expiry checks use monotonic time — no clock-skew-induced double-rotation\n3. Audit log emitted on every key lifecycle event (create, rotate, expire, revoke)\n');
    writeFileSync(join(root, '.planning/PM_SIGNOFF.md'),
      '# PM Planning Sign-Off\n\nApproved: YES\n');
    gitCommit(root, 'demo: pm planning work');

    const pmAccept = acceptTurn(root, config);
    if (!pmAccept.ok) throw new Error(`PM accept failed: ${pmAccept.error}`);
    gitCommit(root, 'demo: accept pm turn');

    if (!jsonMode) success('Turn accepted ✓');
    result.turns.push({ role: 'pm', turn_id: pmTurnId, phase: 'planning' });
    result.decisions += pmResult.decisions.length;
    result.objections += pmResult.objections.length;

    // ── Phase Gate: planning → implementation ─────────────────────────────
    if (!jsonMode) header('Phase Gate — planning → implementation');

    const gateResult = approvePhaseGate(root, config);
    if (!gateResult.ok) throw new Error(`Phase gate failed: ${gateResult.error}`);
    gitCommit(root, 'demo: approve phase transition');

    if (!jsonMode) {
      success('Gate passed: PM_SIGNOFF.md contains "Approved: YES"');
      lesson('This gate stopped 3 AI agents from proceeding until a human confirmed the security scope was correct');
    }

    // ── Dev Turn (Implementation) ─────────────────────────────────────────
    if (!jsonMode) header('Dev Turn — Implementation Phase');

    const devAssign = assignTurn(root, config, 'dev');
    if (!devAssign.ok) throw new Error(`Dev assign failed: ${devAssign.error}`);
    const devTurnId = devAssign.turn.turn_id;

    if (!jsonMode) step(`Assigned Dev turn: ${chalk.dim(devTurnId.slice(0, 16))}...`);

    // Write implementation files
    writeFileSync(join(root, 'token-rotator.js'), `// Auth Token Rotation Service — governed implementation
const audit = [];
let currentToken = { key: 'tok_initial', created: Date.now(), expires: Date.now() + 3600000 };
let previousToken = null;

function rotate(newKey) {
  if (!newKey || typeof newKey !== 'string') {
    audit.push({ event: 'rotate_failed', reason: 'invalid_key', ts: Date.now() });
    throw new Error('Invalid token key: must be a non-empty string');
  }
  // Atomic rollback: validate new token before invalidating old
  const candidate = { key: newKey, created: Date.now(), expires: Date.now() + 3600000 };
  previousToken = currentToken;  // preserve rollback path
  currentToken = candidate;
  audit.push({ event: 'rotated', from: previousToken.key, to: newKey, ts: Date.now() });
  return currentToken;
}

function rollback() {
  if (!previousToken) throw new Error('No previous token to roll back to');
  const rolled = previousToken;
  currentToken = previousToken;
  previousToken = null;
  audit.push({ event: 'rollback', to: rolled.key, ts: Date.now() });
  return currentToken;
}

function getAuditLog() { return [...audit]; }

module.exports = { rotate, rollback, getAuditLog, getCurrent: () => currentToken };
`);

    writeFileSync(join(root, 'token-rotator.test.js'), `const assert = require('assert');
const { rotate, rollback, getAuditLog } = require('./token-rotator');

// Test 1: Safe rotation with rollback
const newToken = rotate('tok_v2');
assert.strictEqual(newToken.key, 'tok_v2');
const rolledBack = rollback();
assert.strictEqual(rolledBack.key, 'tok_initial');

// Test 2: Invalid key rejected with audit trail
try { rotate(''); assert.fail('Should throw'); }
catch (e) { assert.match(e.message, /Invalid token key/); }

// Test 3: Audit log captures all lifecycle events
const log = getAuditLog();
assert.ok(log.some(e => e.event === 'rotated'), 'rotation logged');
assert.ok(log.some(e => e.event === 'rollback'), 'rollback logged');
assert.ok(log.some(e => e.event === 'rotate_failed'), 'failure logged');
console.log('3 tests passed, 0 failed');
`);

    writeFileSync(join(root, '.planning/IMPLEMENTATION_NOTES.md'), `# Implementation Notes

## Changes

- Created \`token-rotator.js\` with atomic rollback, expiry, and audit logging
- Created \`token-rotator.test.js\` with 3 test cases covering all acceptance criteria
- Resolved OBJ-001: new tokens are validated before old tokens are invalidated

## Verification

- \`node token-rotator.test.js\` → 3/3 passing
`);
    gitCommit(root, 'demo: dev implementation');

    // Stage dev turn result
    const devResult = makeDevTurnResult(runId, devTurnId);
    stageTurnResult(root, devTurnId, devResult);

    if (!jsonMode) {
      step('Dev implemented token rotation with atomic rollback and audit trail');
      step(`Dev resolved PM objection: ${chalk.green('OBJ-001 — rollback path now implemented')}`);
      step(`Dev raised ${chalk.yellow('1 new objection')}: "Clock skew could skip rotation or double-rotate"`);
      lesson('The dev caught a clock-skew bug the PM missed. Independent challenge surfaces different failure classes');
      step(`Verification: ${chalk.green('3/3 tests passing')}`);
    }

    const devAccept = acceptTurn(root, config);
    if (!devAccept.ok) throw new Error(`Dev accept failed: ${devAccept.error}`);
    gitCommit(root, 'demo: accept dev turn');

    if (!jsonMode) success('Turn accepted ✓');
    result.turns.push({ role: 'dev', turn_id: devTurnId, phase: 'implementation' });
    result.decisions += devResult.decisions.length;
    result.objections += devResult.objections.length;

    // implementation_complete gate auto-advances (no requires_human_approval)
    // so the phase is already 'qa' after dev acceptance
    if (!jsonMode) {
      header('Phase Gate — implementation → qa (auto-evaluated)');
      success('Gate passed: IMPLEMENTATION_NOTES.md has real content, verification passed');
      lesson('Without this gate, untested code could reach QA review — wasting a review turn on code that doesn\'t run');
    }

    // ── QA Turn (Review) ──────────────────────────────────────────────────
    if (!jsonMode) header('QA Turn — Review Phase');

    const qaAssign = assignTurn(root, config, 'qa');
    if (!qaAssign.ok) throw new Error(`QA assign failed: ${qaAssign.error}`);
    const qaTurnId = qaAssign.turn.turn_id;

    if (!jsonMode) step(`Assigned QA turn: ${chalk.dim(qaTurnId.slice(0, 16))}...`);

    // Write QA artifacts
    writeFileSync(join(root, '.planning/acceptance-matrix.md'), `# Acceptance Matrix

| Req # | Requirement | Status |
|-------|-------------|--------|
| 1 | Token rotation with atomic rollback | PASS |
| 2 | Monotonic expiry checks | PASS |
| 3 | Audit log on every lifecycle event | PASS |
`);

    writeFileSync(join(root, '.planning/ship-verdict.md'), `# Ship Verdict

## Verdict: SHIP

All acceptance criteria met. OBJ-002 (clock skew) noted for follow-up. OBJ-003 (failure audit) noted for next sprint.
`);

    writeFileSync(join(root, '.planning/RELEASE_NOTES.md'), `# Release Notes — v1.0.0

## What shipped

- Auth token rotation with atomic rollback and audit trail
- 3/3 acceptance criteria met
- Governed delivery: PM → Dev → QA with mandatory challenge at every turn
- 3 issues caught by governance that would have shipped undetected without challenge
`);
    gitCommit(root, 'demo: qa review artifacts');

    // Stage QA turn result
    const qaResult = makeQaTurnResult(runId, qaTurnId);
    stageTurnResult(root, qaTurnId, qaResult);

    if (!jsonMode) {
      step('QA reviewed token rotation against acceptance matrix');
      step(`QA verdict: ${chalk.green('All 3 criteria PASS')}`);
      step(`QA raised ${chalk.yellow('1 objection')}: "No audit entry on rotation failure — compliance gap"`);
      lesson('QA found a compliance gap neither PM nor dev raised. Three perspectives > one');
      step(`Ship verdict: ${chalk.green('SHIP')}`);
    }

    const qaAccept = acceptTurn(root, config);
    if (!qaAccept.ok) throw new Error(`QA accept failed: ${qaAccept.error}`);
    gitCommit(root, 'demo: accept qa turn');

    if (!jsonMode) success('Turn accepted ✓');
    result.turns.push({ role: 'qa', turn_id: qaTurnId, phase: 'qa' });
    result.decisions += qaResult.decisions.length;
    result.objections += qaResult.objections.length;

    // ── Run Completion ────────────────────────────────────────────────────
    if (!jsonMode) header('Run Completion');

    const completionResult = approveCompletionGate(root, config);
    if (!completionResult.ok) throw new Error(`Completion failed: ${completionResult.error}`);

    const completedAt = JSON.parse(readFileSync(join(root, '.agentxchain/state.json'), 'utf8')).completed_at;

    if (!jsonMode) {
      success(`Approved completion: qa_ship_verdict gate passed`);
      step(`Run completed at ${chalk.dim(completedAt || new Date().toISOString())}`);
    }

    // ── Summary ───────────────────────────────────────────────────────────
    result.ok = true;
    result.duration_ms = Date.now() - startTime;

    if (!jsonMode) {
      header('Summary');
      console.log('');
      console.log(`  Run:        ${chalk.bold(runId.slice(0, 16))}...`);
      console.log(`  Turns:      ${chalk.bold('3')} (PM, Dev, QA)`);
      console.log(`  Decisions:  ${chalk.blue(String(result.decisions))} recorded in decision ledger`);
      console.log(`  Objections: ${chalk.yellow(String(result.objections))} raised across all turns`);
      console.log(`  Duration:   ${chalk.dim((result.duration_ms / 1000).toFixed(1) + 's')}`);
      console.log(`  Caught:     ${chalk.green('3 issues that would have shipped undetected without governed challenge')}`);
      console.log('');
      console.log(chalk.dim('  ─'.repeat(26)));
      console.log('');
      console.log(`  ${chalk.bold('Try it for real:')}  agentxchain init --governed`);
      console.log(`  ${chalk.bold('Read more:')}       https://agentxchain.dev/docs/quickstart`);
      console.log('');
    }

    if (jsonMode) {
      process.stdout.write(JSON.stringify(result, null, 2) + '\n');
    }
  } catch (err) {
    result.ok = false;
    result.error = err.message;
    result.duration_ms = Date.now() - startTime;

    if (jsonMode) {
      process.stdout.write(JSON.stringify(result, null, 2) + '\n');
    } else {
      console.error(chalk.red(`\n  Demo failed: ${err.message}`));
      if (verbose) console.error(chalk.dim(`  ${err.stack}`));
    }

    process.exitCode = 1;
  } finally {
    // Always clean up
    try { rmSync(root, { recursive: true, force: true }); } catch {}
  }
}
