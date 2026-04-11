import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..', '..');

const read = (rel) => readFileSync(join(REPO_ROOT, rel), 'utf8');

const DOC_PATH = 'website-v2/docs/recovery.mdx';
const DOC = read(DOC_PATH);
const SIDEBARS = read('website-v2/sidebars.ts');

// Code-backed sources
const BLOCKED_STATE_SRC = read('cli/src/lib/blocked-state.js');
const GOVERNED_STATE_SRC = read('cli/src/lib/governed-state.js');

// Extract typed_reason values from deriveRecoveryDescriptor
const TYPED_REASONS_IN_CODE = [];
for (const m of BLOCKED_STATE_SRC.matchAll(/typed_reason:\s*'([^']+)'/g)) {
  if (!TYPED_REASONS_IN_CODE.includes(m[1])) TYPED_REASONS_IN_CODE.push(m[1]);
}
// Also check governed-state.js for hook_block and hook_tamper
for (const m of GOVERNED_STATE_SRC.matchAll(/typed_reason:\s*'([^']+)'/g)) {
  if (!TYPED_REASONS_IN_CODE.includes(m[1])) TYPED_REASONS_IN_CODE.push(m[1]);
}

describe('Recovery docs surface', () => {
  it('ships the Docusaurus page', () => {
    assert.ok(existsSync(join(REPO_ROOT, DOC_PATH)), 'recovery docs page must exist');
  });

  it('is wired into the sidebar', () => {
    assert.match(SIDEBARS, /'recovery'/, 'sidebars.ts must include recovery page');
  });

  it('has correct frontmatter', () => {
    assert.match(DOC, /title:\s*Recovery/);
    assert.match(DOC, /description:/);
  });
});

describe('Recovery docs — typed_reason coverage', () => {
  it('documents every typed_reason from deriveRecoveryDescriptor', () => {
    for (const reason of TYPED_REASONS_IN_CODE) {
      assert.ok(
        DOC.includes(reason),
        `recovery docs must document typed_reason '${reason}'`
      );
    }
  });

  it('code has at least the 7 core typed_reason values', () => {
    const CORE_REASONS = [
      'pending_run_completion',
      'pending_phase_transition',
      'needs_human',
      'dispatch_error',
      'operator_escalation',
      'retries_exhausted',
      'unknown_block',
    ];
    for (const reason of CORE_REASONS) {
      assert.ok(
        TYPED_REASONS_IN_CODE.includes(reason),
        `blocked-state.js must define typed_reason '${reason}'`
      );
    }
  });
});

describe('Recovery docs — command coverage', () => {
  it('documents all recovery commands', () => {
    const RECOVERY_COMMANDS = [
      'step --resume',
      'agentxchain resume',
      'resume --role',
      'approve-transition',
      'approve-completion',
      'reject-turn',
      'accept-turn',
      'escalate',
      'status',
    ];
    for (const cmd of RECOVERY_COMMANDS) {
      assert.ok(
        DOC.includes(cmd),
        `recovery docs must mention recovery command '${cmd}'`
      );
    }
  });
});

describe('Recovery docs — implementation-backed contracts', () => {
  it('documents the recovery descriptor fields', () => {
    for (const field of ['typed_reason', 'owner', 'recovery_action', 'turn_retained']) {
      assert.ok(
        DOC.includes(field),
        `recovery docs must mention descriptor field '${field}'`
      );
    }
  });

  it('references deriveRecoveryDescriptor as the canonical contract', () => {
    assert.ok(
      DOC.includes('deriveRecoveryDescriptor'),
      'recovery docs must reference deriveRecoveryDescriptor()'
    );
  });

  it('documents markRunBlocked as the state entry point', () => {
    assert.ok(
      GOVERNED_STATE_SRC.includes('export function markRunBlocked') ||
        GOVERNED_STATE_SRC.includes('function markRunBlocked'),
      'governed-state.js must export markRunBlocked'
    );
  });

  it('documents reactivateGovernedRun as the recovery state mutation', () => {
    assert.ok(
      GOVERNED_STATE_SRC.includes('export function reactivateGovernedRun') ||
        GOVERNED_STATE_SRC.includes('function reactivateGovernedRun'),
      'governed-state.js must export reactivateGovernedRun'
    );
  });

  it('documents decision ledger entries for escalation', () => {
    assert.ok(DOC.includes('operator_escalated'), 'must document escalation raise ledger entry');
    assert.ok(DOC.includes('escalation_resolved'), 'must document escalation resolve ledger entry');
  });

  it('documents the decision ledger path', () => {
    assert.ok(
      DOC.includes('decision-ledger.jsonl'),
      'must reference the decision ledger file'
    );
  });

  it('documents budget recovery through config --set', () => {
    assert.match(DOC, /per_run_max_usd/);
    assert.match(DOC, /agentxchain config --set budget\.per_run_max_usd/);
    assert.doesNotMatch(DOC, /\.agentxchain\/config\.json/);
  });
});

describe('Recovery docs — no ghost commands', () => {
  it('does not claim a dedicated recover command exists', () => {
    // The docs should NOT suggest `agentxchain recover` as a command
    assert.ok(
      !DOC.match(/`agentxchain recover`/),
      'recovery docs must not claim a dedicated recover command exists'
    );
  });
});

describe('Recovery docs — analysis spec exists', () => {
  it('has a planning analysis document', () => {
    assert.ok(
      existsSync(join(REPO_ROOT, '.planning/RECOVERY_SURFACE_ANALYSIS.md')),
      'RECOVERY_SURFACE_ANALYSIS.md must exist'
    );
  });
});
