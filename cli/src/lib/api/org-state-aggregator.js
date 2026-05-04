/**
 * Org State Aggregator — reads governed state from each registered project
 * and returns aggregated cross-project views.
 *
 * Uses readJsonFile/readJsonlFile from state-reader.js for all file reads.
 * Individual project read failures are isolated — never throws.
 *
 * @module org-state-aggregator
 */

import { readJsonFile, readJsonlFile } from '../dashboard/state-reader.js';
import { join } from 'node:path';

/**
 * Read state for a single project. Returns a normalized project state object.
 * Never throws — returns a degraded object with error flag on failure.
 */
function readProjectState(project) {
  const axDir = join(project.root, '.agentxchain');

  try {
    const state = readJsonFile(axDir, 'state.json');
    const decisions = readJsonlFile(axDir, 'decision-ledger.jsonl') || [];
    const history = readJsonlFile(axDir, 'history.jsonl') || [];

    if (!state) {
      return {
        id: project.id,
        name: project.name,
        root: project.root,
        state: {
          run_id: null,
          status: null,
          phase: null,
          active_turns: 0,
          budget_spent_usd: 0,
          updated_at: null,
        },
        pending_gates: [],
        decision_count: 0,
        decisions,
        history,
        error: 'state_unreadable',
      };
    }

    const activeTurns = state.active_turns
      ? Object.keys(state.active_turns).length
      : 0;

    const budgetSpent = state.cost_tracker?.total_cost_usd || 0;

    // Extract pending gates
    const pendingGates = [];
    if (state.gates && typeof state.gates === 'object') {
      for (const [gateName, gateStatus] of Object.entries(state.gates)) {
        if (gateStatus === 'pending' || gateStatus?.status === 'pending') {
          pendingGates.push(gateName);
        }
      }
    }

    return {
      id: project.id,
      name: project.name,
      root: project.root,
      state: {
        run_id: state.run_id || null,
        status: state.status || null,
        phase: state.phase || null,
        active_turns: activeTurns,
        budget_spent_usd: budgetSpent,
        updated_at: state.updated_at || null,
      },
      pending_gates: pendingGates,
      decision_count: decisions.length,
      decisions,
      history,
    };
  } catch {
    return {
      id: project.id,
      name: project.name,
      root: project.root,
      state: {
        run_id: null,
        status: null,
        phase: null,
        active_turns: 0,
        budget_spent_usd: 0,
        updated_at: null,
      },
      pending_gates: [],
      decision_count: 0,
      decisions: [],
      history: [],
      error: 'state_unreadable',
    };
  }
}

/**
 * Create an org state aggregator.
 * @param {object} registry - project registry instance
 * @returns {{ getOverview(), getRuns(query?), getDecisions(query?) }}
 */
export function createOrgAggregator(registry) {

  function getOverview() {
    const projects = registry.list();
    const projectStates = projects.map(readProjectState);

    let activeRuns = 0;
    let pendingGates = 0;
    let totalDecisions = 0;
    let totalCostUsd = 0;

    for (const ps of projectStates) {
      if (ps.state.status === 'active') activeRuns++;
      pendingGates += ps.pending_gates.length;
      totalDecisions += ps.decision_count;
      totalCostUsd += ps.state.budget_spent_usd;
    }

    return {
      total_projects: projects.length,
      active_runs: activeRuns,
      pending_gates: pendingGates,
      total_decisions: totalDecisions,
      total_cost_usd: Math.round(totalCostUsd * 100) / 100,
      projects: projectStates.map(ps => {
        const result = {
          id: ps.id,
          name: ps.name,
          root: ps.root,
          state: ps.state,
          pending_gates: ps.pending_gates,
          decision_count: ps.decision_count,
        };
        if (ps.error) result.error = ps.error;
        return result;
      }),
    };
  }

  function getRuns(query) {
    const projects = registry.list();
    const runs = [];

    for (const project of projects) {
      const axDir = join(project.root, '.agentxchain');

      try {
        const state = readJsonFile(axDir, 'state.json');
        const history = readJsonlFile(axDir, 'history.jsonl') || [];
        const runHistory = readJsonlFile(axDir, 'run-history.jsonl') || [];

        // Active run from state.json
        if (state && state.run_id) {
          runs.push({
            project_id: project.id,
            project_name: project.name,
            run_id: state.run_id,
            status: state.status || 'unknown',
            phase: state.phase || 'unknown',
            turns_completed: history.length,
            cost_usd: state.cost_tracker?.total_cost_usd || 0,
            started_at: state.created_at || null,
            updated_at: state.updated_at || null,
          });
        }

        // Historical runs
        for (const entry of runHistory) {
          if (entry.run_id === state?.run_id) continue; // skip active run
          runs.push({
            project_id: project.id,
            project_name: project.name,
            run_id: entry.run_id || 'unknown',
            status: entry.status || 'completed',
            phase: entry.phase || entry.final_phase || 'unknown',
            turns_completed: entry.turns_completed || 0,
            cost_usd: entry.cost_usd || 0,
            started_at: entry.started_at || null,
            updated_at: entry.completed_at || entry.updated_at || null,
          });
        }
      } catch {
        // Skip unreadable projects
      }
    }

    // Apply filters
    let filtered = runs;
    if (query?.project) {
      filtered = filtered.filter(r => r.project_id === query.project);
    }
    if (query?.phase) {
      filtered = filtered.filter(r => r.phase === query.phase);
    }
    if (query?.status) {
      filtered = filtered.filter(r => r.status === query.status);
    }

    // Sort by updated_at descending
    filtered.sort((a, b) => {
      const ta = a.updated_at || '';
      const tb = b.updated_at || '';
      return tb.localeCompare(ta);
    });

    const limit = parseInt(query?.limit, 10) || 50;
    return { data: filtered.slice(0, limit) };
  }

  function getDecisions(query) {
    const projects = registry.list();
    const decisions = [];

    for (const project of projects) {
      const axDir = join(project.root, '.agentxchain');

      try {
        const entries = readJsonlFile(axDir, 'decision-ledger.jsonl') || [];
        for (const entry of entries) {
          decisions.push({
            project_id: project.id,
            project_name: project.name,
            id: entry.id || entry.decision_id || 'unknown',
            phase: entry.phase || 'unknown',
            role: entry.role || 'unknown',
            runtime_id: entry.runtime_id || null,
            category: entry.category || 'unknown',
            statement: entry.statement || '',
            rationale: entry.rationale || '',
          });
        }
      } catch {
        // Skip unreadable projects
      }
    }

    // Apply filters
    let filtered = decisions;
    if (query?.project) {
      filtered = filtered.filter(d => d.project_id === query.project);
    }
    if (query?.phase) {
      filtered = filtered.filter(d => d.phase === query.phase);
    }
    if (query?.role) {
      filtered = filtered.filter(d => d.role === query.role);
    }

    const limit = parseInt(query?.limit, 10) || 100;
    return { data: filtered.slice(0, limit) };
  }

  // ── Run History (full-fidelity) ──────────────────────────────────────────

  function getRunHistory(query) {
    const projects = registry.list();
    const records = [];

    for (const project of projects) {
      const axDir = join(project.root, '.agentxchain');
      try {
        const entries = readJsonlFile(axDir, 'run-history.jsonl') || [];
        for (const entry of entries) {
          records.push({
            ...entry,
            project_id: project.id,
            project_name: project.name,
          });
        }
      } catch { /* skip unreadable */ }
    }

    let filtered = records;
    if (query?.project) filtered = filtered.filter(r => r.project_id === query.project);
    if (query?.status) filtered = filtered.filter(r => r.status === query.status);

    filtered.sort((a, b) => {
      const ta = a.completed_at || a.recorded_at || '';
      const tb = b.completed_at || b.recorded_at || '';
      return tb.localeCompare(ta);
    });

    const limit = parseInt(query?.limit, 10) || 50;
    const offset = parseInt(query?.offset, 10) || 0;
    return { data: filtered.slice(offset, offset + limit), total: filtered.length };
  }

  // ── Governance Audit Trail ─────────────────────────────────────────────

  const GOVERNANCE_EVENT_TYPES = new Set([
    'escalation_raised', 'escalation_resolved',
    'gate_pending', 'gate_approved', 'gate_failed',
    'run_blocked', 'human_escalation_raised',
    'budget_exceeded_warn',
  ]);

  const GOVERNANCE_DECISION_TYPES = new Set([
    'policy_escalation', 'conflict_detected', 'conflict_rejected',
    'conflict_resolution_selected', 'operator_escalated',
    'escalation_resolved', 'timeout_turn_level',
    'timeout_phase_level', 'timeout_run_level',
  ]);

  function classifySeverity(eventType) {
    if (['run_blocked', 'timeout_run_level', 'policy_escalation', 'hook_block'].includes(eventType)) return 'high';
    if (['escalation_raised', 'human_escalation_raised', 'gate_failed', 'conflict_detected', 'timeout_phase_level', 'timeout_turn_level', 'hook_warn', 'budget_exceeded_warn'].includes(eventType)) return 'medium';
    return 'low';
  }

  function buildDecisionSummary(entry) {
    const type = entry.decision || entry.type || 'unknown';
    if (type === 'policy_escalation') return `Policy violation: ${(entry.violations || []).map(v => v.message).join('; ') || 'unknown'}`;
    if (type === 'conflict_detected') return `File conflict detected: ${(entry.conflict?.conflicting_files || []).join(', ')}`;
    if (type.startsWith('timeout_')) return `Timeout (${entry.scope || type}): ${entry.elapsed_minutes || '?'}m elapsed vs ${entry.limit_minutes || '?'}m limit`;
    if (type === 'operator_escalated') return `Operator escalated: ${entry.escalation?.reason || entry.blocked_on || 'unknown'}`;
    if (type === 'escalation_resolved') return `Escalation resolved: ${entry.resolution || 'resolved'}`;
    if (type.startsWith('conflict_')) return `Conflict ${type.replace('conflict_', '')}: ${(entry.conflict?.conflicting_files || []).join(', ')}`;
    return type;
  }

  function buildEventSummary(entry) {
    const type = entry.event_type || 'unknown';
    const payload = entry.payload || {};
    if (type === 'escalation_raised') return `Escalation: ${payload.reason || payload.blocked_on || 'unknown'}`;
    if (type === 'gate_pending') return `Gate pending: ${payload.gate_id || 'unknown'}`;
    if (type === 'gate_approved') return `Gate approved: ${payload.gate_id || 'unknown'}`;
    if (type === 'gate_failed') return `Gate failed: ${payload.gate_id || 'unknown'}`;
    if (type === 'run_blocked') return `Run blocked: ${payload.reason || payload.blocked_on || 'unknown'}`;
    if (type === 'human_escalation_raised') return `Human escalation: ${payload.reason || 'operator required'}`;
    if (type === 'budget_exceeded_warn') return `Budget warning: ${payload.message || 'approaching limit'}`;
    if (type === 'escalation_resolved') return `Escalation resolved`;
    return type;
  }

  function getAuditTrail(query) {
    const projects = registry.list();
    const events = [];

    for (const project of projects) {
      const axDir = join(project.root, '.agentxchain');

      try {
        const ledger = readJsonlFile(axDir, 'decision-ledger.jsonl') || [];
        for (const entry of ledger) {
          const decisionType = entry.decision || entry.type || '';
          if (!GOVERNANCE_DECISION_TYPES.has(decisionType)) continue;
          events.push({
            timestamp: entry.timestamp || null,
            event_type: decisionType,
            severity: classifySeverity(decisionType),
            source: 'decision_ledger',
            project_id: project.id,
            project_name: project.name,
            run_id: entry.run_id || null,
            phase: entry.phase || null,
            role: entry.role || null,
            summary: buildDecisionSummary(entry),
            detail: entry,
          });
        }
      } catch { /* skip */ }

      try {
        const hooks = readJsonlFile(axDir, 'hook-audit.jsonl') || [];
        for (const entry of hooks) {
          if (entry.verdict !== 'block' && entry.verdict !== 'warn') continue;
          events.push({
            timestamp: entry.timestamp || null,
            event_type: `hook_${entry.verdict}`,
            severity: entry.verdict === 'block' ? 'high' : 'medium',
            source: 'hook_audit',
            project_id: project.id,
            project_name: project.name,
            run_id: entry.run_id || null,
            phase: entry.phase || null,
            role: null,
            summary: `Hook "${entry.hook_name || 'unknown'}" ${entry.verdict}: ${entry.message || entry.event || ''}`,
            detail: entry,
          });
        }
      } catch { /* skip */ }

      try {
        const evts = readJsonlFile(axDir, 'events.jsonl') || [];
        for (const entry of evts) {
          if (!GOVERNANCE_EVENT_TYPES.has(entry.event_type)) continue;
          events.push({
            timestamp: entry.timestamp || null,
            event_type: entry.event_type,
            severity: classifySeverity(entry.event_type),
            source: 'events',
            project_id: project.id,
            project_name: project.name,
            run_id: entry.run_id || null,
            phase: entry.phase || null,
            role: entry.turn?.role_id || null,
            summary: buildEventSummary(entry),
            detail: entry,
          });
        }
      } catch { /* skip */ }
    }

    let filtered = events;
    if (query?.project) filtered = filtered.filter(e => e.project_id === query.project);
    if (query?.severity) filtered = filtered.filter(e => e.severity === query.severity);
    if (query?.event_type) filtered = filtered.filter(e => e.event_type === query.event_type);
    if (query?.source) filtered = filtered.filter(e => e.source === query.source);

    filtered.sort((a, b) => {
      const ta = a.timestamp || '';
      const tb = b.timestamp || '';
      return tb.localeCompare(ta);
    });

    const limit = parseInt(query?.limit, 10) || 50;
    const offset = parseInt(query?.offset, 10) || 0;
    return { data: filtered.slice(offset, offset + limit), total: filtered.length };
  }

  return { getOverview, getRuns, getDecisions, getRunHistory, getAuditTrail };
}
