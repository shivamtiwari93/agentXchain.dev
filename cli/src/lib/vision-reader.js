/**
 * Vision Reader — parse VISION.md and derive candidate intents.
 *
 * Reads a project-relative VISION.md, extracts sections and goals,
 * compares against existing intake state (completed intents, run history),
 * and produces ranked candidate intents for the continuous loop.
 *
 * IMPORTANT: The vision path is project-relative, never hardcoded to
 * the agentxchain.dev repo. Each governed project has its own VISION.md.
 *
 * Spec: .planning/VISION_DRIVEN_CONTINUOUS_SPEC.md
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, resolve as pathResolve, isAbsolute } from 'node:path';

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

/**
 * Parse a VISION.md file into structured sections with goals.
 *
 * @param {string} content - Raw markdown content
 * @returns {{ sections: Array<{ heading: string, level: number, goals: string[], raw: string }> }}
 */
export function parseVisionDocument(content) {
  if (!content || typeof content !== 'string') {
    return { sections: [] };
  }

  const lines = content.split('\n');
  const sections = [];
  let current = null;

  for (const line of lines) {
    // Match H2 or H3 headings (## or ###)
    const headingMatch = line.match(/^(#{2,3})\s+(.+)$/);
    if (headingMatch) {
      if (current) sections.push(current);
      current = {
        heading: headingMatch[2].trim(),
        level: headingMatch[1].length,
        goals: [],
        raw: '',
      };
      continue;
    }

    if (current) {
      current.raw += line + '\n';

      // Extract bullet points as goals
      const bulletMatch = line.match(/^[-*]\s+\*{0,2}(.+?)\*{0,2}\s*$/);
      if (bulletMatch) {
        const goal = bulletMatch[1].trim();
        if (goal.length > 5) { // skip trivially short bullets
          current.goals.push(goal);
        }
      }
    }
  }

  if (current) sections.push(current);

  return { sections };
}

// ---------------------------------------------------------------------------
// Evidence comparison
// ---------------------------------------------------------------------------

/**
 * Load completed intent descriptions from the intake directory.
 *
 * @param {string} root - Project root
 * @returns {string[]} Array of completed intent charters/descriptions
 */
export function loadCompletedIntentSignals(root) {
  const intentsDir = join(root, '.agentxchain', 'intake', 'intents');
  if (!existsSync(intentsDir)) return [];

  const signals = [];
  for (const file of readdirSync(intentsDir)) {
    if (!file.endsWith('.json') || file.startsWith('.tmp-')) continue;
    try {
      const intent = JSON.parse(readFileSync(join(intentsDir, file), 'utf8'));
      if (intent.status === 'completed' || intent.status === 'executing') {
        const desc = intent.charter || intent.signal?.description || '';
        if (desc) signals.push(desc.toLowerCase());
      }
    } catch {
      // skip corrupt files
    }
  }
  return signals;
}

/**
 * Load existing intent signals (all statuses except suppressed/rejected) for dedup.
 *
 * @param {string} root - Project root
 * @returns {string[]} Array of active intent charters/descriptions
 */
export function loadActiveIntentSignals(root) {
  const intentsDir = join(root, '.agentxchain', 'intake', 'intents');
  if (!existsSync(intentsDir)) return [];

  const signals = [];
  const skip = new Set(['suppressed', 'rejected']);
  for (const file of readdirSync(intentsDir)) {
    if (!file.endsWith('.json') || file.startsWith('.tmp-')) continue;
    try {
      const intent = JSON.parse(readFileSync(join(intentsDir, file), 'utf8'));
      if (!skip.has(intent.status)) {
        const desc = intent.charter || '';
        if (desc) signals.push(desc.toLowerCase());
      }
    } catch {
      // skip corrupt files
    }
  }
  return signals;
}

/**
 * Check whether a vision goal appears to be addressed by existing work.
 *
 * Uses keyword overlap: if >= 60% of significant words in the goal
 * appear in any completed intent description, the goal is considered addressed.
 *
 * @param {string} goal - The vision goal text
 * @param {string[]} completedSignals - Lowercased completed intent descriptions
 * @returns {boolean}
 */
export function isGoalAddressed(goal, completedSignals) {
  const words = extractSignificantWords(goal);
  if (words.length === 0) return false;

  for (const signal of completedSignals) {
    const matchCount = words.filter(w => signal.includes(w)).length;
    if (matchCount / words.length >= 0.6) return true;
  }
  return false;
}

const STOP_WORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for',
  'of', 'with', 'by', 'from', 'is', 'are', 'was', 'were', 'be', 'been',
  'being', 'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would',
  'could', 'should', 'may', 'might', 'must', 'shall', 'can', 'that',
  'this', 'these', 'those', 'it', 'its', 'they', 'them', 'their',
  'not', 'no', 'nor', 'only', 'also', 'just', 'than', 'then',
  'each', 'every', 'all', 'any', 'both', 'such', 'as', 'more',
]);

function extractSignificantWords(text) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .split(/\s+/)
    .filter(w => w.length > 2 && !STOP_WORDS.has(w));
}

// ---------------------------------------------------------------------------
// Candidate derivation
// ---------------------------------------------------------------------------

/**
 * Derive candidate intents from a VISION.md file.
 *
 * @param {string} root - Project root
 * @param {string} visionPath - Absolute path to VISION.md
 * @returns {{ ok: boolean, candidates: Array<{ section: string, goal: string, priority: string }>, error?: string }}
 */
export function deriveVisionCandidates(root, visionPath) {
  if (!existsSync(visionPath)) {
    return {
      ok: false,
      candidates: [],
      error: `VISION.md not found at ${visionPath}. Create a .planning/VISION.md for your project to enable vision-driven operation.`,
    };
  }

  let content;
  try {
    content = readFileSync(visionPath, 'utf8');
  } catch (err) {
    return { ok: false, candidates: [], error: `Cannot read VISION.md: ${err.message}` };
  }

  const { sections } = parseVisionDocument(content);
  if (sections.length === 0) {
    return { ok: false, candidates: [], error: 'VISION.md has no extractable sections.' };
  }

  const completedSignals = loadCompletedIntentSignals(root);
  const activeSignals = loadActiveIntentSignals(root);
  const allSignals = [...completedSignals, ...activeSignals];

  const candidates = [];

  for (const section of sections) {
    for (const goal of section.goals) {
      // Skip if this goal is already addressed
      if (isGoalAddressed(goal, allSignals)) continue;

      candidates.push({
        section: section.heading,
        goal,
        priority: 'p2', // default; operators can override via triage_approval: "human"
      });
    }
  }

  return { ok: true, candidates };
}

/**
 * Resolve a vision path relative to the project root.
 *
 * @param {string} root - Project root
 * @param {string} visionPath - Path (absolute or project-relative)
 * @returns {string} Absolute path
 */
export function resolveVisionPath(root, visionPath) {
  if (isAbsolute(visionPath)) return visionPath;
  return pathResolve(root, visionPath);
}
