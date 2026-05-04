import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

// Stop words aligned with vision-reader.js:155
const STOP_WORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for',
  'of', 'with', 'by', 'from', 'is', 'are', 'was', 'were', 'be', 'been',
  'being', 'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would',
  'could', 'should', 'may', 'might', 'must', 'shall', 'can', 'that',
  'this', 'these', 'those', 'it', 'its', 'they', 'them', 'their',
  'not', 'no', 'nor', 'only', 'also', 'just', 'than', 'then',
  'each', 'every', 'all', 'any', 'both', 'such', 'as', 'more',
]);

// Structural boilerplate introduced by seedFromVision charter/acceptance templates.
// These tokens appear in every vision-derived intent and create false overlap.
const TEMPLATE_NOISE = new Set([
  'vision', 'goal', 'addressed', 'section',
]);

/**
 * Extract a scope fingerprint from charter/acceptance text.
 *
 * Extracts normalized significant tokens:
 * - Milestone references: M1, M2, ..., M10 (case-insensitive)
 * - Bug references: BUG-54, BUG-78, etc.
 * - MW reference (workflow kit milestone)
 * - File paths: patterns matching cli/src/..., cli/test/..., .planning/...
 * - Module keywords: significant words (>3 chars) after stop-word removal
 *
 * @param {string} text - Charter and/or acceptance contract text (concatenated)
 * @returns {Set<string>} - Set of normalized lowercase tokens
 */
export function extractScopeFingerprint(text) {
  if (!text || typeof text !== 'string') return new Set();

  const tokens = new Set();

  // 1. Milestone refs: M1, M2, ..., M10 etc.
  const milestoneRefs = text.match(/\bM\d+\b/gi);
  if (milestoneRefs) {
    for (const ref of milestoneRefs) tokens.add(ref.toLowerCase());
  }

  // 2. Bug refs: BUG-54, BUG-78, etc.
  const bugRefs = text.match(/\bBUG-\d+\b/gi);
  if (bugRefs) {
    for (const ref of bugRefs) tokens.add(ref.toLowerCase());
  }

  // 3. MW ref
  const mwRefs = text.match(/\bMW\b/gi);
  if (mwRefs) tokens.add('mw');

  // 4. File paths: cli/src/..., cli/test/..., cli/bin/..., .planning/...
  const filePaths = text.match(/(?:cli\/(?:src|test|bin)\/\S+|\.planning\/\S+)/g);
  if (filePaths) {
    for (const fp of filePaths) tokens.add(fp.toLowerCase());
  }

  // 5. Module keywords: significant words (>3 chars) after stop-word removal
  const cleaned = text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 3 && !STOP_WORDS.has(w) && !TEMPLATE_NOISE.has(w) && !/^\d+$/.test(w));
  for (const word of cleaned) tokens.add(word);

  return tokens;
}

/**
 * Compute Jaccard similarity between two scope fingerprints.
 *
 * Jaccard = |A ∩ B| / |A ∪ B|
 * Returns 0 when both sets are empty (no overlap by definition).
 *
 * @param {Set<string>} a - First fingerprint
 * @param {Set<string>} b - Second fingerprint
 * @returns {number} - Similarity score between 0.0 and 1.0
 */
export function computeScopeOverlap(a, b) {
  if (a.size === 0 && b.size === 0) return 0;

  let intersection = 0;
  for (const token of a) {
    if (b.has(token)) intersection++;
  }

  const union = a.size + b.size - intersection;
  if (union === 0) return 0;

  return intersection / union;
}

/**
 * Extract charter text from state.json active run.
 * Checks: 1) first active turn's intake_context.charter, 2) provenance.trigger_reason
 */
function extractActiveRunCharter(state) {
  // Check active turns for intake_context.charter
  if (state.active_turns && Array.isArray(state.active_turns)) {
    for (const turn of state.active_turns) {
      if (turn.intake_context && turn.intake_context.charter) {
        return turn.intake_context.charter;
      }
    }
  }

  // Fall back to provenance.trigger_reason
  if (state.provenance && state.provenance.trigger_reason) {
    return state.provenance.trigger_reason;
  }

  return null;
}

/**
 * Load recent completed intents from .agentxchain/intake/intents/*.json
 */
function loadRecentCompletedIntents(root, limit) {
  const intentsDir = join(root, '.agentxchain', 'intake', 'intents');
  if (!existsSync(intentsDir)) return [];

  let files;
  try {
    files = readdirSync(intentsDir).filter(f => f.endsWith('.json'));
  } catch {
    return [];
  }

  const intents = [];
  for (const file of files) {
    try {
      const intent = JSON.parse(readFileSync(join(intentsDir, file), 'utf8'));
      if (intent.status === 'completed' || intent.status === 'satisfied') {
        intents.push(intent);
      }
    } catch {
      // Skip malformed intent files
    }
  }

  // Sort by updated_at descending, take first `limit`
  intents.sort((a, b) => {
    const dateA = a.updated_at || a.created_at || '';
    const dateB = b.updated_at || b.created_at || '';
    return dateB.localeCompare(dateA);
  });

  return intents.slice(0, limit);
}

/**
 * Check if an intent's charter overlaps with active or recent work.
 *
 * @param {string} root - Project root
 * @param {string} charter - The candidate intent's charter text
 * @param {string[]} acceptanceContract - The candidate intent's acceptance items
 * @param {object} [options]
 * @param {number} [options.threshold=0.4] - Jaccard score above which overlap is reported
 * @param {number} [options.lookbackIntents=10] - Max recent completed intents to check
 * @returns {{ overlapping: boolean, matches: Array<{ source: string, charter: string, score: number }>, max_score: number }}
 */
export function checkIntentScopeOverlap(root, charter, acceptanceContract, options = {}) {
  const threshold = options.threshold ?? 0.4;
  const lookbackIntents = options.lookbackIntents ?? 10;

  const candidateText = charter + ' ' + (Array.isArray(acceptanceContract) ? acceptanceContract.join(' ') : '');
  const candidateFP = extractScopeFingerprint(candidateText);

  // Too few tokens means there isn't enough semantic signal for meaningful
  // comparison — skip overlap check to avoid false positives from
  // section names or template scaffolding alone.
  if (candidateFP.size < 3) {
    return { overlapping: false, matches: [], max_score: 0 };
  }

  const matches = [];

  // 1. Check active run
  const statePath = join(root, '.agentxchain', 'state.json');
  if (existsSync(statePath)) {
    try {
      const state = JSON.parse(readFileSync(statePath, 'utf8'));
      if (state && state.status === 'active') {
        const activeCharter = extractActiveRunCharter(state);
        if (activeCharter) {
          const activeFP = extractScopeFingerprint(activeCharter);
          const score = computeScopeOverlap(candidateFP, activeFP);
          if (score > 0) {
            matches.push({ source: 'active_run', charter: activeCharter, score });
          }
        }
      }
    } catch {
      // Non-fatal — state read failure doesn't block approval
    }
  }

  // 2. Check recent completed intents
  const recentIntents = loadRecentCompletedIntents(root, lookbackIntents);
  for (const intent of recentIntents) {
    const intentText = (intent.charter || '') + ' ' + (Array.isArray(intent.acceptance_contract) ? intent.acceptance_contract.join(' ') : '');
    const intentFP = extractScopeFingerprint(intentText);
    const score = computeScopeOverlap(candidateFP, intentFP);
    if (score > 0) {
      matches.push({ source: `intent:${intent.intent_id}`, charter: intent.charter || '', score });
    }
  }

  const max_score = Math.max(0, ...matches.map(m => m.score));
  return { overlapping: max_score >= threshold, matches, max_score };
}
