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

export function validateOverride(root, decision) {
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
    lines.push(`- **${d.id}** (${d.category}): ${d.statement}`);
  }
  lines.push('');
  return lines.join('\n');
}

// ── Constants ───────────────────────────────────────────────────────────────

export { REPO_DECISIONS_PATH };
