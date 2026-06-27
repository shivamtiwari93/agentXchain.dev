import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  evaluateHumanAttention,
  buildHumanAttentionSummary,
  HUMAN_ATTENTION_CATEGORIES,
} from '../src/lib/human-attention.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const BIN = join(__dirname, '..', 'bin', 'agentxchain.js');

// ── fixtures ──────────────────────────────────────────────────────────────────

// Minimal governed config. `qa_ship_verdict` is marked credentialed so we can exercise
// the credentialed-gate category via the qa phase's exit gate.
const GOVERNED_CONFIG = {
  schema_version: 4,
  protocol_mode: 'governed',
  template: 'generic',
  project: { id: 'p1', name: 'P1' },
  roles: {
    dev: { title: 'Dev', mandate: 'build', write_authority: 'authoritative', runtime: 'local' },
  },
  runtimes: { local: { type: 'local_cli' } },
  routing: {
    planning: { entry_role: 'dev', allowed_next_roles: ['dev'], exit_gate: 'planning_signoff' },
    implementation: { entry_role: 'dev', allowed_next_roles: ['dev'], exit_gate: 'implementation_complete' },
    qa: { entry_role: 'dev', allowed_next_roles: ['dev'], exit_gate: 'qa_ship_verdict' },
  },
  gates: {
    planning_signoff: {},
    implementation_complete: {},
    qa_ship_verdict: { credentialed: true },
  },
};

let tmpDirs = [];
function tmp(prefix = 'human-attention-') {
  const d = mkdtempSync(join(tmpdir(), prefix));
  tmpDirs.push(d);
  return d;
}

afterEach(() => {
  for (const d of tmpDirs) {
    try { rmSync(d, { recursive: true, force: true }); } catch { /* ignore */ }
  }
  tmpDirs = [];
});

function writeRepo({ state, escalations, intents, config = GOVERNED_CONFIG } = {}) {
  const dir = tmp();
  writeFileSync(join(dir, 'agentxchain.json'), JSON.stringify(config));
  mkdirSync(join(dir, '.agentxchain'), { recursive: true });
  if (state) writeFileSync(join(dir, '.agentxchain', 'state.json'), JSON.stringify(state));
  if (escalations) {
    writeFileSync(
      join(dir, '.agentxchain', 'human-escalations.jsonl'),
      escalations.map((e) => JSON.stringify(e)).join('\n') + '\n',
    );
  }
  if (intents) {
    const intentsDir = join(dir, '.agentxchain', 'intake', 'intents');
    mkdirSync(intentsDir, { recursive: true });
    for (const intent of intents) {
      writeFileSync(join(intentsDir, `${intent.intent_id}.json`), JSON.stringify(intent, null, 2));
    }
  }
  return dir;
}

function idleState(overrides = {}) {
  return {
    schema_version: '1.1',
    run_id: 'run_x',
    status: 'active',
    phase: 'implementation',
    blocked_on: null,
    ...overrides,
  };
}

function raisedEscalation(overrides = {}) {
  return {
    kind: 'raised',
    escalation_id: 'hesc_abc',
    created_at: '2026-06-01T00:00:00.000Z',
    run_id: 'run_def',
    phase: 'implementation',
    blocked_on: 'escalation:hesc_abc',
    category: 'unknown_block',
    typed_reason: 'needs_credential',
    type: 'needs_credential',
    service: 'Anthropic',
    action: 'Provide the required Anthropic credential.',
    recovery_action: null,
    resolution_command: 'agentxchain unblock hesc_abc',
    detail: 'credential failure escalated to human',
    turn_id: 'turn_1',
    role_id: 'dev',
    ...overrides,
  };
}

function approvedIntent(overrides = {}) {
  return {
    schema_version: '1.0',
    intent_id: 'intent_1',
    status: 'approved',
    priority: 'p1',
    template: 'generic',
    charter: 'ship the website refresh',
    acceptance_contract: ['site updated'],
    approved_run_id: 'run_x',
    cross_run_durable: false,
    created_at: '2026-06-01T00:00:00.000Z',
    approved_at: '2026-06-02T00:00:00.000Z',
    ...overrides,
  };
}

// ── AT-HA-001..009: evaluateHumanAttention composition ─────────────────────────

describe('evaluateHumanAttention — composition', () => {
  it('AT-HA-001: no pending decisions of any category → clear, empty queue', () => {
    const dir = writeRepo({ state: idleState() });
    const report = evaluateHumanAttention(dir);
    expect(report.overall).toBe('clear');
    expect(report.items).toEqual([]);
    expect(report.items_count).toBe(0);
    expect(report.blocking_count).toBe(0);
    expect(report.categories).toEqual([]);
  });

  it('AT-HA-002: blocked_on human_approval:<gate> (non-credentialed) → approval, blocking', () => {
    const dir = writeRepo({
      state: idleState({ status: 'blocked', phase: 'implementation', blocked_on: 'human_approval:implementation_complete' }),
    });
    const report = evaluateHumanAttention(dir);
    expect(report.overall).toBe('attention');
    const item = report.items.find((i) => i.category === HUMAN_ATTENTION_CATEGORIES.APPROVAL);
    expect(item).toBeTruthy();
    expect(item.blocking).toBe(true);
    expect(item.action_hint).toContain('approve');
    // implementation phase exit gate is not credentialed → not classified as credentialed_gate
    expect(report.categories).not.toContain(HUMAN_ATTENTION_CATEGORIES.CREDENTIALED_GATE);
  });

  it('AT-HA-003: open human escalation present → escalation, blocking, resolve hint', () => {
    const dir = writeRepo({
      state: idleState({ status: 'blocked', blocked_on: 'escalation:hesc_abc' }),
      escalations: [raisedEscalation()],
    });
    const report = evaluateHumanAttention(dir);
    const item = report.items.find((i) => i.category === HUMAN_ATTENTION_CATEGORIES.ESCALATION);
    expect(item).toBeTruthy();
    expect(item.blocking).toBe(true);
    expect(item.action_hint).toBe('agentxchain unblock hesc_abc');
    expect(item.run_id).toBe('run_def');
  });

  it('AT-HA-004: pending approved intent awaiting dispatch → pending_intent, non-blocking', () => {
    const dir = writeRepo({ state: idleState(), intents: [approvedIntent()] });
    const report = evaluateHumanAttention(dir);
    const item = report.items.find((i) => i.category === HUMAN_ATTENTION_CATEGORIES.PENDING_INTENT);
    expect(item).toBeTruthy();
    expect(item.blocking).toBe(false);
    expect(item.summary).toContain('intent_1');
    expect(report.overall).toBe('attention');
  });

  it('AT-HA-005: credentialed exit gate active → credentialed_gate, blocking', () => {
    const dir = writeRepo({
      // qa phase exit gate (qa_ship_verdict) is credentialed in GOVERNED_CONFIG
      state: idleState({ status: 'blocked', phase: 'qa', blocked_on: 'human_approval:qa_ship_verdict' }),
    });
    const report = evaluateHumanAttention(dir);
    const item = report.items.find((i) => i.category === HUMAN_ATTENTION_CATEGORIES.CREDENTIALED_GATE);
    expect(item).toBeTruthy();
    expect(item.blocking).toBe(true);
    expect(item.summary).toContain('qa_ship_verdict');
    // the same pending decision must NOT also appear as a plain approval
    expect(report.categories).not.toContain(HUMAN_ATTENTION_CATEGORIES.APPROVAL);
  });

  it('AT-HA-006: blocked_on budget:exhausted → budget_policy, blocking, unblock hint', () => {
    const dir = writeRepo({ state: idleState({ status: 'blocked', blocked_on: 'budget:exhausted' }) });
    const report = evaluateHumanAttention(dir);
    const item = report.items.find((i) => i.category === HUMAN_ATTENTION_CATEGORIES.BUDGET_POLICY);
    expect(item).toBeTruthy();
    expect(item.blocking).toBe(true);
    expect(item.action_hint).toContain('unblock');
  });

  it('AT-HA-007: blocked_on policy:<id> → budget_policy, blocking', () => {
    const dir = writeRepo({ state: idleState({ status: 'blocked', blocked_on: 'policy:no_force_push' }) });
    const report = evaluateHumanAttention(dir);
    const item = report.items.find((i) => i.category === HUMAN_ATTENTION_CATEGORIES.BUDGET_POLICY);
    expect(item).toBeTruthy();
    expect(item.blocking).toBe(true);
    expect(item.summary).toContain('no_force_push');
  });

  it('AT-HA-008: mixed categories → ordered per the Ordering contract', () => {
    // A repo cannot literally hold multiple simultaneous blocked_on values, so assemble
    // the ordering directly from the exported category evaluators to assert the contract:
    // blocking first; escalation/credentialed outrank pending-approval outranks budget/policy
    // outranks the informational pending-intent tier.
    const credDir = writeRepo({ state: idleState({ status: 'blocked', phase: 'qa', blocked_on: 'human_approval:qa_ship_verdict' }) });
    const escDir = writeRepo({ state: idleState({ status: 'blocked', blocked_on: 'escalation:hesc_abc' }), escalations: [raisedEscalation()] });
    const apprDir = writeRepo({ state: idleState({ status: 'blocked', blocked_on: 'human_approval:implementation_complete' }) });
    const budgDir = writeRepo({ state: idleState({ status: 'blocked', blocked_on: 'budget:exhausted' }) });
    const intentDir = writeRepo({ state: idleState(), intents: [approvedIntent()] });

    const pick = (dir, cat) => evaluateHumanAttention(dir).items.find((i) => i.category === cat);
    const mixed = [
      pick(intentDir, HUMAN_ATTENTION_CATEGORIES.PENDING_INTENT),
      pick(budgDir, HUMAN_ATTENTION_CATEGORIES.BUDGET_POLICY),
      pick(apprDir, HUMAN_ATTENTION_CATEGORIES.APPROVAL),
      pick(escDir, HUMAN_ATTENTION_CATEGORIES.ESCALATION),
      pick(credDir, HUMAN_ATTENTION_CATEGORIES.CREDENTIALED_GATE),
    ];

    // Re-sort via the public surface by round-tripping: build a synthetic repo is hard,
    // so assert the priority numbers themselves encode the contract.
    const byPriority = [...mixed].sort((a, b) => {
      if (a.blocking !== b.blocking) return a.blocking ? -1 : 1;
      return a.priority - b.priority;
    });
    const order = byPriority.map((i) => i.category);
    expect(order[0]).toBe(HUMAN_ATTENTION_CATEGORIES.CREDENTIALED_GATE);
    expect(order[1]).toBe(HUMAN_ATTENTION_CATEGORIES.ESCALATION);
    expect(order[2]).toBe(HUMAN_ATTENTION_CATEGORIES.APPROVAL);
    expect(order[3]).toBe(HUMAN_ATTENTION_CATEGORIES.BUDGET_POLICY);
    // the only non-blocking category is last
    expect(order[order.length - 1]).toBe(HUMAN_ATTENTION_CATEGORIES.PENDING_INTENT);
    expect(byPriority[byPriority.length - 1].blocking).toBe(false);
  });

  it('AT-HA-008b: a single repo with a blocking + informational item orders blocking first', () => {
    // budget block (blocking) + pending intent (informational) co-exist in one repo.
    const dir = writeRepo({
      state: idleState({ status: 'blocked', blocked_on: 'budget:exhausted' }),
      intents: [approvedIntent()],
    });
    const report = evaluateHumanAttention(dir);
    expect(report.items.length).toBe(2);
    expect(report.items[0].blocking).toBe(true);
    expect(report.items[0].category).toBe(HUMAN_ATTENTION_CATEGORIES.BUDGET_POLICY);
    expect(report.items[1].blocking).toBe(false);
    expect(report.items[1].category).toBe(HUMAN_ATTENTION_CATEGORIES.PENDING_INTENT);
  });

  it('AT-HA-009: blocking_count reflects only blocking items when mixed', () => {
    const dir = writeRepo({
      state: idleState({ status: 'blocked', blocked_on: 'budget:exhausted' }),
      intents: [approvedIntent(), approvedIntent({ intent_id: 'intent_2' })],
    });
    const report = evaluateHumanAttention(dir);
    expect(report.items_count).toBe(3);
    expect(report.blocking_count).toBe(1); // only the budget block is blocking
  });
});

// ── AT-HA-010..012: CLI command ────────────────────────────────────────────────

describe('agentxchain attention — CLI', () => {
  function runCli(dir, args = []) {
    return spawnSync('node', [BIN, 'attention', '--dir', dir, ...args], { encoding: 'utf8' });
  }

  it('AT-HA-010: empty queue → "Nothing needs your attention", exit 0', () => {
    const dir = writeRepo({ state: idleState() });
    const res = runCli(dir);
    expect(res.status).toBe(0);
    expect(res.stdout).toContain('Nothing needs your attention');
  });

  it('AT-HA-010b: attention state also exits 0 (status surface, not a gate)', () => {
    const dir = writeRepo({ state: idleState({ status: 'blocked', blocked_on: 'budget:exhausted' }) });
    const res = runCli(dir);
    expect(res.status).toBe(0);
    expect(res.stdout).toContain('Attention needed');
  });

  it('AT-HA-011: --json output matches the HumanAttentionReport schema', () => {
    const dir = writeRepo({ state: idleState({ status: 'blocked', blocked_on: 'budget:exhausted' }) });
    const res = runCli(dir, ['--json']);
    expect(res.status).toBe(0);
    const report = JSON.parse(res.stdout);
    for (const key of ['overall', 'items', 'items_count', 'blocking_count', 'categories', 'evidence_summary']) {
      expect(report).toHaveProperty(key);
    }
    expect(Array.isArray(report.items)).toBe(true);
    for (const item of report.items) {
      for (const key of ['category', 'priority', 'blocking', 'run_id', 'summary', 'action_hint']) {
        expect(item).toHaveProperty(key);
      }
    }
  });

  it('AT-HA-012: --all includes informational pending-intent items', () => {
    const dir = writeRepo({
      state: idleState({ status: 'blocked', blocked_on: 'budget:exhausted' }),
      intents: [approvedIntent()],
    });
    const withoutAll = runCli(dir);
    expect(withoutAll.stdout).not.toContain('intent_1');
    expect(withoutAll.stdout).toContain('informational'); // summarized as a count

    const withAll = runCli(dir, ['--all']);
    expect(withAll.status).toBe(0);
    expect(withAll.stdout).toContain('intent_1');
  });
});

// ── AT-HA-013: read-only invariant ─────────────────────────────────────────────

describe('evaluateHumanAttention — read-only', () => {
  function snapshot(dir) {
    const snap = {};
    const walk = (rel) => {
      const abs = join(dir, rel);
      if (!existsSync(abs)) return;
      for (const entry of readdirSync(abs, { withFileTypes: true })) {
        const childRel = join(rel, entry.name);
        if (entry.isDirectory()) walk(childRel);
        else snap[childRel] = readFileSync(join(dir, childRel), 'utf8');
      }
    };
    walk('.agentxchain');
    snap['agentxchain.json'] = readFileSync(join(dir, 'agentxchain.json'), 'utf8');
    return snap;
  }

  it('AT-HA-013: performs no writes (state/escalations/intents byte-identical)', () => {
    const dir = writeRepo({
      state: idleState({ status: 'blocked', blocked_on: 'human_approval:implementation_complete' }),
      escalations: [raisedEscalation()],
      intents: [approvedIntent()],
    });
    const before = snapshot(dir);
    const filesBefore = readdirSync(join(dir, '.agentxchain'));

    evaluateHumanAttention(dir);

    const after = snapshot(dir);
    expect(after).toEqual(before);
    // No new files (e.g. HUMAN_TASKS.md) created in the project root by reading escalations.
    expect(existsSync(join(dir, 'HUMAN_TASKS.md'))).toBe(false);
    expect(readdirSync(join(dir, '.agentxchain'))).toEqual(filesBefore);
  });
});

// ── AC-5: governance report integration ────────────────────────────────────────

describe('buildHumanAttentionSummary — governance report integration', () => {
  it('derives the compact summary from an export artifact (clear)', () => {
    const summary = buildHumanAttentionSummary({ state: idleState(), config: GOVERNED_CONFIG });
    expect(summary).toEqual({ overall: 'clear', items_count: 0, blocking_count: 0, categories: [] });
  });

  it('derives a blocking summary from a budget-blocked artifact', () => {
    const summary = buildHumanAttentionSummary({
      state: idleState({ status: 'blocked', blocked_on: 'budget:exhausted' }),
      config: GOVERNED_CONFIG,
    });
    expect(summary.overall).toBe('attention');
    expect(summary.items_count).toBe(1);
    expect(summary.blocking_count).toBe(1);
    expect(summary.categories).toContain(HUMAN_ATTENTION_CATEGORIES.BUDGET_POLICY);
  });

  it('returns null for a missing artifact', () => {
    expect(buildHumanAttentionSummary(null)).toBe(null);
  });
});
