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

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve as pathResolve, isAbsolute } from 'node:path';
import { createHash } from 'node:crypto';

const ROADMAP_TRACKING_ANNOTATION_PATTERN = /<!--\s*tracking\s*:[\s\S]*?-->/i;

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
 * Derive concrete candidates from unchecked roadmap milestones.
 *
 * This is intentionally narrower than VISION.md derivation: a roadmap item is
 * already PM-shaped product scope, so continuous mode must treat it as work
 * before falling back to broad vision inference.
 *
 * @param {string} root - Project root
 * @param {string} [roadmapPath] - Project-relative roadmap path
 * @returns {{ ok: boolean, candidates: Array<{ section: string, goal: string, priority: string, source: string, roadmap_path: string, line: number }>, error?: string }}
 */
export function deriveRoadmapCandidates(root, roadmapPath = '.planning/ROADMAP.md') {
  const absPath = isAbsolute(roadmapPath) ? roadmapPath : pathResolve(root, roadmapPath);
  if (!existsSync(absPath)) {
    return { ok: true, candidates: [] };
  }

  let content;
  try {
    content = readFileSync(absPath, 'utf8');
  } catch (err) {
    return { ok: false, candidates: [], error: `Cannot read ROADMAP.md: ${err.message}` };
  }

  const activeSignals = loadActiveIntentSignals(root);
  const completedSignals = loadCompletedIntentSignals(root);
  const allSignals = [...activeSignals, ...completedSignals];

  const candidates = [];
  let currentMilestone = null;
  const lines = content.split('\n');

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const headingMatch = line.match(/^#{2,6}\s+(M\d+\b.*)$/i);
    if (headingMatch) {
      currentMilestone = headingMatch[1].trim();
      continue;
    }

    const uncheckedMatch = line.match(/^\s*[-*]\s+\[\s\]\s+(.+?)\s*$/);
    if (!uncheckedMatch || !currentMilestone) continue;
    if (ROADMAP_TRACKING_ANNOTATION_PATTERN.test(line)) continue;

    const goal = uncheckedMatch[1].trim();
    const combinedGoal = `${currentMilestone}: ${goal}`;
    if (isGoalAddressed(combinedGoal, allSignals) || isGoalAddressed(goal, allSignals)) {
      continue;
    }

    candidates.push({
      section: currentMilestone,
      goal,
      priority: 'p1',
      source: 'roadmap_open_work',
      roadmap_path: roadmapPath,
      line: i + 1,
    });
  }

  return { ok: true, candidates };
}

// ---------------------------------------------------------------------------
// Vision snapshot capture (BUG-60 Slice 3)
// ---------------------------------------------------------------------------

const MAX_PREVIEW_PER_SOURCE_BYTES = 16 * 1024;
const MAX_PREVIEW_TOTAL_BYTES = 48 * 1024;
const MAX_SOURCE_FILE_BYTES = 64 * 1024;

/**
 * Capture a heading snapshot from parsed VISION.md content.
 * Returns an array of unique heading strings (H1/H2/H3).
 *
 * @param {string} content - Raw VISION.md markdown
 * @returns {string[]}
 */
export function captureVisionHeadingsSnapshot(content) {
  if (!content || typeof content !== 'string') return [];
  const headings = [];
  for (const line of content.split('\n')) {
    const match = line.match(/^(#{1,3})\s+(.+)$/);
    if (match) {
      const heading = match[2].trim();
      if (heading && !headings.includes(heading)) {
        headings.push(heading);
      }
    }
  }
  return headings;
}

/**
 * Compute a SHA-256 content hash for VISION.md content.
 *
 * @param {string} content - Raw file content
 * @returns {string} Hex-encoded SHA-256
 */
export function computeVisionContentSha(content) {
  if (!content || typeof content !== 'string') return '';
  return createHash('sha256').update(content, 'utf8').digest('hex');
}

/**
 * Build a bounded source manifest for idle-expansion PM charter context.
 *
 * Per BUG-60 Plan §2: manifest includes path, presence, byte_count, warning,
 * extracted H1/H2 headings, and a bounded preview. Preview truncation is
 * deterministic: at most 16KB per source and 48KB total, using head+tail
 * with `[...truncated middle...]` inserted between halves.
 *
 * VISION.md missing/malformed is a hard error. ROADMAP.md and SYSTEM_SPEC.md
 * missing are warnings. ROADMAP/SYSTEM_SPEC malformed if they cannot be
 * decoded as UTF-8, exceed 64KB, or parse into fewer than one H1/H2 heading.
 *
 * @param {string} root - Project root
 * @param {string[]} sources - Array of project-relative source paths
 * @returns {{ ok: boolean, entries: Array<object>, error?: string }}
 */
export function buildSourceManifest(root, sources) {
  if (!Array.isArray(sources) || sources.length === 0) {
    return { ok: false, entries: [], error: 'No sources configured for idle expansion.' };
  }

  const entries = [];
  let totalPreviewBytes = 0;

  for (const sourcePath of sources) {
    const absPath = isAbsolute(sourcePath) ? sourcePath : pathResolve(root, sourcePath);
    const isVision = sourcePath.toLowerCase().includes('vision');
    const entry = { path: sourcePath, present: false, byte_count: 0, warning: null, headings: [], preview: null };

    if (!existsSync(absPath)) {
      entry.warning = 'file_not_found';
      if (isVision) {
        return { ok: false, entries, error: `VISION.md not found at ${absPath}. Cannot run idle expansion without VISION.md.` };
      }
      entries.push(entry);
      continue;
    }

    let content;
    let byteCount;
    try {
      const stat = statSync(absPath);
      byteCount = stat.size;
      entry.byte_count = byteCount;
      entry.present = true;

      if (byteCount > MAX_SOURCE_FILE_BYTES && !isVision) {
        entry.warning = 'exceeds_64kb';
        // Still read what we can for preview, but flag it
        content = readFileSync(absPath, 'utf8');
      } else {
        content = readFileSync(absPath, 'utf8');
      }
    } catch (err) {
      entry.warning = 'read_error';
      if (isVision) {
        return { ok: false, entries, error: `Cannot read VISION.md at ${absPath}: ${err.message}` };
      }
      entries.push(entry);
      continue;
    }

    // Extract H1/H2 headings
    const headings = [];
    for (const line of content.split('\n')) {
      const match = line.match(/^(#{1,2})\s+(.+)$/);
      if (match) {
        const heading = match[2].trim();
        if (heading && !headings.includes(heading)) {
          headings.push(heading);
        }
      }
    }
    entry.headings = headings;

    // Malformed check for non-VISION sources
    if (!isVision) {
      if (byteCount > MAX_SOURCE_FILE_BYTES) {
        entry.warning = 'exceeds_64kb';
      } else if (headings.length === 0) {
        entry.warning = 'no_headings';
      }
    }

    // Bounded preview
    const remainingBudget = MAX_PREVIEW_TOTAL_BYTES - totalPreviewBytes;
    const perSourceCap = Math.min(MAX_PREVIEW_PER_SOURCE_BYTES, remainingBudget);
    if (perSourceCap > 0 && content.length > 0) {
      entry.preview = truncatePreview(content, perSourceCap);
      totalPreviewBytes += Buffer.byteLength(entry.preview, 'utf8');
    }

    entries.push(entry);
  }

  return { ok: true, entries };
}

/**
 * Deterministic head+tail preview truncation.
 * If content fits within cap, return as-is. Otherwise split into
 * head half + `[...truncated middle...]` + tail half.
 *
 * @param {string} content
 * @param {number} capBytes
 * @returns {string}
 */
function truncatePreview(content, capBytes) {
  const contentBytes = Buffer.byteLength(content, 'utf8');
  if (contentBytes <= capBytes) return content;

  const marker = '\n[...truncated middle...]\n';
  const markerBytes = Buffer.byteLength(marker, 'utf8');
  const usable = capBytes - markerBytes;
  if (usable <= 0) return content.slice(0, 100) + marker;

  const halfChars = Math.floor(usable / 2);
  const head = content.slice(0, halfChars);
  const tail = content.slice(-halfChars);
  return head + marker + tail;
}

/**
 * Detect whether the roadmap is exhausted but VISION.md still has unplanned scope.
 *
 * BUG-77: When all ROADMAP.md milestones are checked and no M<n+1> exists,
 * but VISION.md has sections with goals that are NOT mapped to any roadmap
 * milestone, continuous mode should dispatch PM to derive the next bounded
 * roadmap increment — not declare idle_exit or vision_exhausted.
 *
 * @param {string} root - Project root
 * @param {string} visionPath - Absolute path to VISION.md
 * @param {string} [roadmapPath] - Project-relative roadmap path
 * @returns {{ open: boolean, reason: string, unplanned_sections?: string[], mapped_sections?: string[], total_milestones?: number, latest_milestone?: string, evidence_map?: Array<{ milestone: string, status: string }> }}
 */
export function detectRoadmapExhaustedVisionOpen(root, visionPath, roadmapPath = '.planning/ROADMAP.md') {
  const absRoadmap = isAbsolute(roadmapPath) ? roadmapPath : pathResolve(root, roadmapPath);
  const absVision = isAbsolute(visionPath) ? visionPath : pathResolve(root, visionPath);

  // If no roadmap, cannot be "exhausted"
  if (!existsSync(absRoadmap)) {
    return { open: false, reason: 'no_roadmap' };
  }

  let roadmapContent;
  try {
    roadmapContent = readFileSync(absRoadmap, 'utf8');
  } catch {
    return { open: false, reason: 'roadmap_unreadable' };
  }

  // Parse milestone headings and check for unchecked items
  const milestoneHeadings = [];
  let currentMilestone = null;
  let hasUnchecked = false;

  for (const line of roadmapContent.split('\n')) {
    const hm = line.match(/^#{2,6}\s+(M\d+\b.*)$/i);
    if (hm) {
      currentMilestone = hm[1].trim();
      milestoneHeadings.push(currentMilestone);
      continue;
    }
    if (currentMilestone && /^\s*[-*]\s+\[\s\]/.test(line)) {
      if (ROADMAP_TRACKING_ANNOTATION_PATTERN.test(line)) continue;
      hasUnchecked = true;
    }
  }

  // Not exhausted if unchecked work exists (BUG-76 handles this)
  if (hasUnchecked) {
    return { open: false, reason: 'has_unchecked' };
  }
  // No milestones at all — not a milestone-based roadmap
  if (milestoneHeadings.length === 0) {
    return { open: false, reason: 'no_milestones' };
  }

  // Roadmap IS exhausted (all milestones checked, none unchecked). Check VISION.
  if (!existsSync(absVision)) {
    return {
      open: false,
      reason: 'no_vision',
      evidence_map: milestoneHeadings.map(m => ({ milestone: m, status: 'completed' })),
    };
  }

  let visionContent;
  try {
    visionContent = readFileSync(absVision, 'utf8');
  } catch {
    return { open: false, reason: 'vision_unreadable' };
  }

  const { sections } = parseVisionDocument(visionContent);
  const sectionsWithGoals = sections.filter(s => s.goals.length > 0);

  if (sectionsWithGoals.length === 0) {
    return {
      open: false,
      reason: 'vision_no_actionable_scope',
      evidence_map: milestoneHeadings.map(m => ({ milestone: m, status: 'completed' })),
    };
  }

  // Check which VISION sections are NOT mapped to any roadmap milestone heading
  const unplanned = [];
  const mapped = [];

  for (const section of sectionsWithGoals) {
    const sectionWords = extractSignificantWords(section.heading);
    const isMapped = milestoneHeadings.some(m => {
      const milestoneWords = extractSignificantWords(m);
      if (sectionWords.length === 0 || milestoneWords.length === 0) return false;
      const overlap = sectionWords.filter(w =>
        milestoneWords.some(mw => mw.includes(w) || w.includes(mw)),
      ).length;
      return overlap / sectionWords.length >= 0.4;
    });
    if (isMapped) {
      mapped.push(section.heading);
    } else {
      unplanned.push(section.heading);
    }
  }

  if (unplanned.length > 0) {
    return {
      open: true,
      reason: 'roadmap_exhausted_vision_open',
      unplanned_sections: unplanned,
      mapped_sections: mapped,
      total_milestones: milestoneHeadings.length,
      latest_milestone: milestoneHeadings[milestoneHeadings.length - 1],
    };
  }

  return {
    open: false,
    reason: 'vision_fully_mapped',
    evidence_map: milestoneHeadings.map(m => ({ milestone: m, status: 'completed' })),
    mapped_sections: mapped,
  };
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
