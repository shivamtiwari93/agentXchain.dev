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

  return { getOverview, getRuns, getDecisions };
}
