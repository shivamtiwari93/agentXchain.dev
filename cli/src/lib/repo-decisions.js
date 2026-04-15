/**
 * Repo Decisions — cross-run decision carryover.
 *
 * Decisions with durability: "repo" persist in `.agentxchain/repo-decisions.jsonl`
 * across governed runs. They act as binding constraints: agents in future runs
 * must comply with active repo decisions or explicitly override them.
 *
 * DEC-SPEC: .planning/CROSS_RUN_DECISION_CARRYOVER_SPEC.md
 */

import { readFileSync, appendFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';

const REPO_DECISIONS_PATH = '.agentxchain/repo-decisions.jsonl';

// ── Read ────────────────────────────────────────────────────────────────────

export function readRepoDecisions(root) {
  const filePath = join(root, REPO_DECISIONS_PATH);
  if (!existsSync(filePath)) return [];
  try {
    const content = readFileSync(filePath, 'utf8').trim();
    if (!content) return [];
    return content.split('\n').filter(Boolean).map(line => {
      try { return JSON.parse(line); } catch { return null; }
    }).filter(Boolean);
  } catch {
    return [];
  }
}

export function getActiveRepoDecisions(root) {
  return readRepoDecisions(root).filter(d => d.status === 'active');
}

export function getRepoDecisionById(root, decisionId) {
  return readRepoDecisions(root).find(d => d.id === decisionId) || null;
}

export function buildRepoDecisionsSummary(decisions) {
  if (!Array.isArray(decisions) || decisions.length === 0) return null;
  const active = decisions.filter((d) => d.status === 'active');
  const overridden = decisions.filter((d) => d.status === 'overridden');
  return {
    total: decisions.length,
    active_count: active.length,
    overridden_count: overridden.length,
    active: active.map((d) => ({
      id: d.id,
      category: d.category,
      statement: d.statement,
      role: d.role,
      run_id: d.run_id,
      overrides: d.overrides || null,
      durability: d.durability || 'repo',
    })),
    overridden: overridden.map((d) => ({
      id: d.id,
      overridden_by: d.overridden_by,
      statement: d.statement,
      overrides: d.overrides || null,
      durability: d.durability || 'repo',
    })),
  };
}

// ── Write ───────────────────────────────────────────────────────────────────

export function appendRepoDecision(root, entry) {
  const filePath = join(root, REPO_DECISIONS_PATH);
  const dir = dirname(filePath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  appendFileSync(filePath, JSON.stringify(entry) + '\n');
}

export function overrideRepoDecision(root, targetId, overridingId) {
  const all = readRepoDecisions(root);
  const updated = all.map(d => {
    if (d.id === targetId) {
      return { ...d, status: 'overridden', overridden_by: overridingId };
    }
    return d;
  });
  const filePath = join(root, REPO_DECISIONS_PATH);
  const dir = dirname(filePath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(filePath, updated.map(d => JSON.stringify(d)).join('\n') + '\n');
}

// ── Validate Override ───────────────────────────────────────────────────────

/**
 * Validate that an override is allowed.
 * @param {string} root - project root
 * @param {object} decision - the overriding decision (must have .overrides, .id, optionally .role)
 * @param {object} [config] - agentxchain config (used for authority enforcement)
 * @returns {{ ok: boolean, error?: string, warning?: string }}
 *
 * DEC-SPEC: .planning/DECISION_AUTHORITY_SPEC.md
 */
export function validateOverride(root, decision, config) {
  if (!decision.overrides) return { ok: true };
  const targetId = decision.overrides;
  const target = getRepoDecisionById(root, targetId);
  if (!target) {
    return { ok: false, error: `decisions: overrides references ${targetId} which does not exist in repo decisions.` };
  }
  if (target.status === 'overridden') {
    return { ok: false, error: `decisions: ${targetId} is already overridden by ${target.overridden_by}.` };
  }
  if (target.status !== 'active') {
    return { ok: false, error: `decisions: ${targetId} has status "${target.status}", only active repo decisions can be overridden.` };
  }

  // Authority enforcement (opt-in via decision_authority on roles)
  const authorityResult = checkOverrideAuthority(decision, target, config);
  if (!authorityResult.ok) return authorityResult;

  return authorityResult.warning ? { ok: true, warning: authorityResult.warning } : { ok: true };
}

/**
 * Resolve the decision_authority level for a role.
 * - 'human' defaults to 100 unless explicitly configured.
 * - Unknown roles default to 0 (with warning).
 * - Null means opt-out (no enforcement).
 */
export function resolveDecisionAuthority(roleId, config) {
  if (!config || !config.roles) return null;
  if (roleId === 'human') {
    const humanRole = config.roles.human;
    if (humanRole && typeof humanRole.decision_authority === 'number') {
      return humanRole.decision_authority;
    }
    return 100; // human default
  }
  const role = config.roles[roleId];
  if (!role) return { level: 0, unknown: true };
  if (typeof role.decision_authority !== 'number') return null;
  return role.decision_authority;
}

/**
 * Check whether the overriding role has sufficient authority to override
 * a decision made by the target role.
 */
function checkOverrideAuthority(overridingDecision, targetDecision, config) {
  if (!config || !config.roles) return { ok: true };

  const overridingRole = overridingDecision.role;
  const targetRole = targetDecision.role;

  // Same-role override is always allowed
  if (overridingRole && targetRole && overridingRole === targetRole) return { ok: true };

  const targetAuth = resolveDecisionAuthority(targetRole, config);
  const overridingAuth = resolveDecisionAuthority(overridingRole, config);

  // Handle unknown target role
  let warning;
  if (targetAuth && typeof targetAuth === 'object' && targetAuth.unknown) {
    warning = `decisions: target decision role '${targetRole}' not found in current config, treating as authority 0.`;
    // targetAuth is effectively 0, allow override
    return { ok: true, warning };
  }

  // Opt-in: if either side is null (not configured), allow
  if (targetAuth === null || overridingAuth === null) return { ok: true };

  // Handle unknown overriding role (shouldn't normally happen, but be safe)
  const overridingLevel = (typeof overridingAuth === 'object' && overridingAuth.unknown) ? 0 : overridingAuth;
  const targetLevel = (typeof targetAuth === 'object') ? 0 : targetAuth;

  if (overridingLevel < targetLevel) {
    return {
      ok: false,
      error: `decisions: role '${overridingRole}' (authority ${overridingLevel}) cannot override ${targetDecision.id} made by '${targetRole}' (authority ${targetLevel}). Override requires authority >= ${targetLevel}.`,
    };
  }

  return { ok: true };
}

// ── Render ──────────────────────────────────────────────────────────────────

export function renderRepoDecisionsMarkdown(activeDecisions) {
  if (!activeDecisions || activeDecisions.length === 0) return '';
  const lines = [
    '## Active Repo Decisions',
    '',
    'These decisions persist from prior governed runs. Comply or explicitly override with rationale.',
    '',
  ];
  for (const d of activeDecisions) {
    const supersedes = d.overrides ? ` Supersedes ${d.overrides}.` : '';
    lines.push(`- **${d.id}** (${d.category}): ${d.statement}${supersedes}`);
  }
  lines.push('');
  return lines.join('\n');
}

// ── Constants ───────────────────────────────────────────────────────────────

export { REPO_DECISIONS_PATH };
