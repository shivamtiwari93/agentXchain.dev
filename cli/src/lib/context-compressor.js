/**
 * Bounded context compressor for preflight tokenization.
 *
 * Takes parsed context sections and applies the v1.1 deterministic
 * compression order from PREEMPTIVE_TOKENIZATION_SPEC.md §4.
 * Does not perform token counting — that is the caller's responsibility.
 */

import { renderContextSections } from './context-section-parser.js';

/**
 * The fixed compression order. Each step is tried in sequence until the
 * caller's budget check passes or all steps are exhausted.
 */
const COMPRESSION_STEPS = [
  { id: 'budget', action: 'drop' },
  { id: 'phase_gate_status', action: 'drop' },
  { id: 'decision_history', action: 'drop' },
  { id: 'workflow_artifacts', action: 'drop' },
  { id: 'last_turn_verification', action: 'drop' },
  { id: 'gate_required_files', action: 'drop' },
  { id: 'last_turn_objections', action: 'drop' },
  { id: 'last_turn_decisions', action: 'drop' },
  { id: 'last_turn_summary', action: 'truncate', max_chars: 240 },
  { id: 'last_turn_summary', action: 'drop' },
];

export { COMPRESSION_STEPS };

/**
 * @typedef {Object} SectionAction
 * @property {string} id - Section ID
 * @property {boolean} required - Whether the section is sticky
 * @property {number} original_tokens - Token count before compression (set by caller)
 * @property {number} final_tokens - Token count after compression (set by caller)
 * @property {'kept' | 'dropped' | 'truncated'} action - What happened to this section
 */

/**
 * @typedef {Object} CompressionResult
 * @property {Array<Object>} sections - The (possibly compressed) section array
 * @property {Array<SectionAction>} actions - Per-section action log
 * @property {string} effective_context - Rendered markdown of the compressed sections
 * @property {boolean} exhausted - True if all compression steps were applied
 * @property {number} steps_applied - Number of compression steps applied
 */

/**
 * Compress parsed context sections using the v1.1 bounded compression order.
 *
 * The `fitsInBudget` callback is called after each compression step with the
 * current effective context string. It should return true if the full outbound
 * request (including system prompt, PROMPT.md, separator, and the provided
 * effective context) fits within the available input token budget.
 *
 * @param {Array<Object>} sections - Parsed sections from parseContextSections()
 * @param {(effectiveContext: string) => boolean} fitsInBudget - Budget check callback
 * @returns {CompressionResult}
 */
export function compressContextSections(sections, fitsInBudget) {
  // Deep copy so we don't mutate the caller's array
  let working = sections.map((s) => ({ ...s }));

  // Track actions per section
  const actionMap = new Map(
    sections.map((s) => [s.id, { id: s.id, required: s.required, action: 'kept' }])
  );

  // Check if it already fits before any compression
  let effectiveContext = renderContextSections(working);
  if (fitsInBudget(effectiveContext)) {
    return buildResult(working, actionMap, effectiveContext, false, 0);
  }

  // Apply compression steps in order
  let stepsApplied = 0;
  for (const step of COMPRESSION_STEPS) {
    const sectionIndex = working.findIndex((s) => s.id === step.id);
    if (sectionIndex === -1) {
      // Section not present — skip this step
      continue;
    }

    const section = working[sectionIndex];

    // Safety: never compress a required/sticky section
    if (section.required) {
      continue;
    }

    if (step.action === 'drop') {
      working = working.filter((s) => s.id !== step.id);
      actionMap.get(step.id).action = 'dropped';
      stepsApplied += 1;
    } else if (step.action === 'truncate') {
      const original = section.content;
      if (original.length > step.max_chars) {
        section.content = original.slice(0, step.max_chars);
        // Only count as a step if we actually truncated
        actionMap.get(step.id).action = 'truncated';
        stepsApplied += 1;
      }
    }

    effectiveContext = renderContextSections(working);
    if (fitsInBudget(effectiveContext)) {
      return buildResult(working, actionMap, effectiveContext, false, stepsApplied);
    }
  }

  // All compression steps exhausted and still doesn't fit
  effectiveContext = renderContextSections(working);
  return buildResult(working, actionMap, effectiveContext, true, stepsApplied);
}

function buildResult(sections, actionMap, effectiveContext, exhausted, stepsApplied) {
  return {
    sections,
    actions: Array.from(actionMap.values()),
    effective_context: effectiveContext,
    exhausted,
    steps_applied: stepsApplied,
  };
}
