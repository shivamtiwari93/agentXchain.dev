/**
 * M15: Govern Without Micromanaging — Human Attention Surface (VISION.md:51)
 *
 * Closes the final "Why This Must Exist" pain bullet: "humans lose the ability to
 * govern without micromanaging." The triggers that legitimately require a human are
 * real but scattered — pending phase/completion approvals live in `state.blocked_on`,
 * open escalations in `human-escalations.jsonl`, approved-but-undispatched work in the
 * intake system, credentialed gates in `approval-policy`, and budget/policy halts back
 * in `state.blocked_on`. To govern today the operator must poll every surface
 * (micromanage) or trust blindly (forbidden by VISION.md:220).
 *
 * This module is a govern-by-exception COMPOSITION layer (Architecture Invariant #1):
 * it aggregates those already-existing signals into a single prioritized
 * `HumanAttentionReport`, reaching each one through its public surface. It NEVER
 * reimplements escalation, approval, or intake logic, and it is strictly READ-ONLY
 * (Invariant #2) — it never mutates state, escalations, intents, artifacts, or config.
 * Every category is evaluated independently; a failure or empty result in one never
 * suppresses another (Invariant #4).
 *
 * The defining property: when no human decision is pending the queue is EMPTY and
 * `overall === 'clear'` (Invariant #3). That empty state is the operational proof that
 * the human can step back and let governed autonomy run.
 *
 * Public surface:
 *   evaluateHumanAttention(repoDir)      — live single-repo cross-category queue
 *   buildHumanAttentionSummary(artifact) — compact summary embedded in a governance report
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { loadProjectContext } from './config.js';
import { readHumanEscalations } from './human-escalations.js';
import { findPendingApprovedIntents } from './intake.js';
import { isCredentialedExitGate } from './approval-policy.js';

const DEFAULT_STATE_PATH = '.agentxchain/state.json';

// Category ids surfaced by the attention queue.
export const HUMAN_ATTENTION_CATEGORIES = {
  CREDENTIALED_GATE: 'credentialed_gate',
  ESCALATION: 'escalation',
  APPROVAL: 'approval',
  MANUAL_ACTION: 'manual_action',
  BUDGET_POLICY: 'budget_policy',
  PENDING_INTENT: 'pending_intent',
};

// Deterministic priority key (lower = more urgent). Blocking categories are all < 100
// and informational categories >= 100, which — combined with the blocking-first sort —
// guarantees every blocking item precedes every non-blocking item (Ordering contract).
// Within the blocking tier: credentialed-gate and escalation outrank pending-approval,
// which outranks budget/policy; manual_action (gate_action/human blocks) sits just below
// approval. Pending-intent is the only informational tier.
const CATEGORY_PRIORITY = {
  credentialed_gate: 10,
  escalation: 20,
  approval: 30,
  manual_action: 35,
  budget_policy: 40,
  pending_intent: 100,
};

/**
 * Read the governed state file WITHOUT writeback (loadProjectState may normalize and
 * persist, which would violate the read-only invariant). Mirrors ship-status.js.
 */
function readGovernedStateReadOnly(root, config) {
  const rel = config?.files?.state || DEFAULT_STATE_PATH;
  const filePath = join(root, rel);
  if (!existsSync(filePath)) return null;
  try {
    return JSON.parse(readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function blockedOnString(state) {
  return typeof state?.blocked_on === 'string' ? state.blocked_on : null;
}

// ── category evaluators (pure; exported for focused unit testing) ─────────────

/**
 * Identify the gate (if any) currently awaiting human approval, from the blocked
 * state or a recorded pending transition / completion.
 */
function pendingApprovalGate(state) {
  if (!state) return null;
  const blockedOn = blockedOnString(state);
  if (blockedOn && blockedOn.startsWith('human_approval:')) {
    return blockedOn.slice('human_approval:'.length) || null;
  }
  if (state.pending_run_completion?.gate) return state.pending_run_completion.gate;
  if (state.pending_phase_transition?.gate) return state.pending_phase_transition.gate;
  return null;
}

function approvalActionHint(state) {
  if (state?.pending_run_completion) return 'agentxchain approve-completion';
  return 'agentxchain approve-transition';
}

/**
 * Categories 1 & 4 — Pending approvals (critical transitions / completion) and the
 * credentialed-gate refinement. A pending human-approval gate is a single decision;
 * it is classified as `credentialed_gate` when the current phase's exit gate is
 * credentialed (VISION.md:36 — gates guarding irreversible or credentialed actions),
 * otherwise as `approval`. Mutually exclusive, so the same decision is never
 * double-counted while still honouring the ordering contract (credentialed outranks
 * plain approval). Composes approval-policy.js `isCredentialedExitGate`.
 */
export function evaluatePendingApprovalCategory(state, config) {
  const gate = pendingApprovalGate(state);
  if (!gate) return [];

  const runId = state?.run_id || null;
  const phase = state?.phase || null;
  const phaseSuffix = phase ? ` (phase "${phase}")` : '';
  const hint = approvalActionHint(state);

  let credentialed = false;
  try {
    credentialed = isCredentialedExitGate(config, phase);
  } catch {
    credentialed = false;
  }

  if (credentialed) {
    return [{
      category: HUMAN_ATTENTION_CATEGORIES.CREDENTIALED_GATE,
      priority: CATEGORY_PRIORITY.credentialed_gate,
      blocking: true,
      run_id: runId,
      summary: `Credentialed gate "${gate}" requires human approval${phaseSuffix}.`,
      action_hint: hint,
    }];
  }

  return [{
    category: HUMAN_ATTENTION_CATEGORIES.APPROVAL,
    priority: CATEGORY_PRIORITY.approval,
    blocking: true,
    run_id: runId,
    summary: `Gate "${gate}" awaits human approval${phaseSuffix}.`,
    action_hint: hint,
  }];
}

/**
 * Category 2 — Open human escalations (intervene during escalation). Composes
 * human-escalations.js `readHumanEscalations`; surfaces every record whose status is
 * `open`. Each carries its own `resolution_command` action hint.
 */
export function evaluateEscalationCategory(escalations) {
  return (escalations || [])
    .filter((record) => record && record.status === 'open')
    .map((record) => {
      const service = record.service ? ` (${record.service})` : '';
      const what = record.detail || record.action || record.typed_reason || record.escalation_id;
      return {
        category: HUMAN_ATTENTION_CATEGORIES.ESCALATION,
        priority: CATEGORY_PRIORITY.escalation,
        blocking: true,
        run_id: record.run_id || null,
        summary: `${record.type || 'escalation'} escalated to human${service}: ${what}`,
        action_hint: record.resolution_command || `agentxchain unblock ${record.escalation_id}`,
      };
    });
}

/**
 * Category 5 — Budget / policy blockers. A run halted on budget or policy needs a human
 * to raise the budget or override the policy. Composes `state.blocked_on`
 * (`budget:exhausted`, `policy:<id>`).
 */
export function evaluateBudgetPolicyCategory(state) {
  const blockedOn = blockedOnString(state);
  if (!blockedOn) return [];
  const runId = state?.run_id || null;

  if (blockedOn === 'budget:exhausted') {
    return [{
      category: HUMAN_ATTENTION_CATEGORIES.BUDGET_POLICY,
      priority: CATEGORY_PRIORITY.budget_policy,
      blocking: true,
      run_id: runId,
      summary: 'Run halted: budget exhausted — raise the budget to continue.',
      action_hint: 'agentxchain unblock',
    }];
  }

  if (blockedOn.startsWith('policy:')) {
    const policyId = blockedOn.slice('policy:'.length) || 'unknown';
    return [{
      category: HUMAN_ATTENTION_CATEGORIES.BUDGET_POLICY,
      priority: CATEGORY_PRIORITY.budget_policy,
      blocking: true,
      run_id: runId,
      summary: `Run halted by policy "${policyId}" — a human must override or adjust it.`,
      action_hint: 'agentxchain unblock',
    }];
  }

  return [];
}

/**
 * Bonus category — Manual gate action / generic human block. Catches the remaining
 * human-owned `state.blocked_on` encodings (`gate_action:<gate>`, `human:<detail>`) so a
 * run blocked on operator intervention is never silently dropped from the queue. (The
 * `escalation:<id>` encoding is already represented by its open escalation in Category 2.)
 */
export function evaluateManualActionCategory(state) {
  const blockedOn = blockedOnString(state);
  if (!blockedOn) return [];
  const runId = state?.run_id || null;

  if (blockedOn.startsWith('gate_action:')) {
    const gate = blockedOn.slice('gate_action:'.length) || 'unknown';
    return [{
      category: HUMAN_ATTENTION_CATEGORIES.MANUAL_ACTION,
      priority: CATEGORY_PRIORITY.manual_action,
      blocking: true,
      run_id: runId,
      summary: `Run awaits a manual gate action on "${gate}".`,
      action_hint: 'agentxchain gate',
    }];
  }

  if (blockedOn.startsWith('human:')) {
    const detail = blockedOn.slice('human:'.length) || 'operator intervention required';
    return [{
      category: HUMAN_ATTENTION_CATEGORIES.MANUAL_ACTION,
      priority: CATEGORY_PRIORITY.manual_action,
      blocking: true,
      run_id: runId,
      summary: `Run awaits operator intervention: ${detail}.`,
      action_hint: 'agentxchain unblock',
    }];
  }

  return [];
}

/**
 * Category 3 — Pending approved intents awaiting dispatch (set direction). Informational:
 * work approved but not yet dispatched. Composes intake.js `findPendingApprovedIntents`.
 */
export function evaluatePendingIntentCategory(intents) {
  return (intents || []).map((intent) => {
    const pri = intent.priority ? ` [${intent.priority}]` : '';
    const charter = intent.charter ? `: ${intent.charter}` : '';
    return {
      category: HUMAN_ATTENTION_CATEGORIES.PENDING_INTENT,
      priority: CATEGORY_PRIORITY.pending_intent,
      blocking: false,
      run_id: null,
      summary: `Approved intent ${intent.intent_id}${pri} awaits dispatch${charter}.`,
      action_hint: 'agentxchain start',
    };
  });
}

// ── ordering & assembly ──────────────────────────────────────────────────────

/**
 * Deterministic Ordering contract: blocking items before non-blocking; within a tier,
 * ascending `priority`; ties broken by `run_id` then `summary` for stability.
 */
function sortItems(items) {
  return [...items].sort((a, b) => {
    if (a.blocking !== b.blocking) return a.blocking ? -1 : 1;
    if (a.priority !== b.priority) return a.priority - b.priority;
    const ra = a.run_id || '';
    const rb = b.run_id || '';
    if (ra !== rb) return ra < rb ? -1 : 1;
    const sa = a.summary || '';
    const sb = b.summary || '';
    if (sa !== sb) return sa < sb ? -1 : 1;
    return 0;
  });
}

function assembleReport(items) {
  const sorted = sortItems(items);
  const blockingCount = sorted.filter((item) => item.blocking).length;
  const categories = [...new Set(sorted.map((item) => item.category))];
  const overall = sorted.length === 0 ? 'clear' : 'attention';

  const evidence = overall === 'clear'
    ? 'Nothing needs your attention; governed autonomy can run.'
    : `${sorted.length} item${sorted.length === 1 ? '' : 's'} need human attention `
      + `(${blockingCount} blocking) across ${categories.length} `
      + `categor${categories.length === 1 ? 'y' : 'ies'}.`;

  return {
    overall,
    items: sorted,
    items_count: sorted.length,
    blocking_count: blockingCount,
    categories,
    evidence_summary: evidence,
  };
}

// Run each category in isolation so a throw or empty result in one never suppresses
// another (Architecture Invariant #4).
function collect(items, fn) {
  try {
    const result = fn();
    if (Array.isArray(result)) items.push(...result);
  } catch {
    /* category isolated — a failure here must not blank the rest of the queue */
  }
}

/**
 * Compose the cross-category human-decision queue for a single governed repo into a
 * prioritized `HumanAttentionReport`. Read-only.
 *
 * @param {string} repoDir
 * @returns {{ overall, items, items_count, blocking_count, categories, evidence_summary }}
 */
export function evaluateHumanAttention(repoDir) {
  const root = repoDir || process.cwd();

  let config = null;
  try {
    const ctx = loadProjectContext(root);
    config = ctx?.config || null;
  } catch {
    config = null;
  }

  const state = readGovernedStateReadOnly(root, config);

  let escalations = [];
  collect([], () => { escalations = readHumanEscalations(root) || []; return []; });

  let intents = [];
  collect([], () => { intents = findPendingApprovedIntents(root, { run_id: state?.run_id || null }) || []; return []; });

  const items = [];
  collect(items, () => evaluatePendingApprovalCategory(state, config));
  collect(items, () => evaluateEscalationCategory(escalations));
  collect(items, () => evaluateBudgetPolicyCategory(state));
  collect(items, () => evaluateManualActionCategory(state));
  collect(items, () => evaluatePendingIntentCategory(intents));

  return assembleReport(items);
}

/**
 * Build the compact human-attention summary embedded in a governance report. Operates on
 * an export artifact (filesystem is not live), so only the state/config-derivable
 * categories are evaluated — the live `agentxchain attention` command surfaces the full
 * cross-category queue (escalations, pending intents).
 *
 * @param {object} artifact
 * @returns {{ overall, items_count, blocking_count, categories } | null}
 */
export function buildHumanAttentionSummary(artifact) {
  if (!artifact) return null;
  const state = artifact.state || null;
  const config = artifact.config || null;

  const items = [];
  collect(items, () => evaluatePendingApprovalCategory(state, config));
  collect(items, () => evaluateBudgetPolicyCategory(state));
  collect(items, () => evaluateManualActionCategory(state));

  const report = assembleReport(items);
  return {
    overall: report.overall,
    items_count: report.items_count,
    blocking_count: report.blocking_count,
    categories: report.categories,
  };
}
