/**
 * Token budget evaluator for preflight tokenization.
 *
 * Combines the context section parser, context compressor, and token counter
 * to produce a TokenBudgetReport and effective context for api_proxy dispatch.
 *
 * This is a pure computation helper — it does not perform network dispatch,
 * write audit artifacts, or mutate state.
 */

import { countTokens } from './token-counter.js';
import { parseContextSections, renderContextSections } from './context-section-parser.js';
import { compressContextSections } from './context-compressor.js';
import { getDispatchEffectiveContextPath } from './turn-paths.js';

const SEPARATOR = '\n\n---\n\n';

const SYSTEM_PROMPT = [
  'You are acting as a governed agent in an AgentXchain protocol run.',
  'Your task and rules are described in the user message.',
  'You MUST obey the write-authority-specific rules in the prompt exactly.',
  'You MUST respond with a valid JSON object matching the turn result schema provided in the prompt.',
  'Do NOT wrap the JSON in markdown code fences. Respond with raw JSON only.',
].join('\n');

/**
 * Evaluate the token budget for a preflight tokenization check.
 *
 * @param {object} params
 * @param {string} params.promptMd - Full PROMPT.md text
 * @param {string} params.contextMd - Full CONTEXT.md text (may be empty)
 * @param {string} params.provider - Provider name (e.g. "anthropic")
 * @param {string} params.model - Model identifier
 * @param {string} params.runtimeId - Runtime identifier for the report
 * @param {string} params.runId - Run identifier for the report
 * @param {string} params.turnId - Turn identifier for the report
 * @param {number} params.contextWindowTokens - Total context window size
 * @param {number} params.maxOutputTokens - Reserved output tokens
 * @param {number} params.safetyMarginTokens - Safety margin tokens
 * @returns {TokenBudgetResult}
 */
export function evaluateTokenBudget({
  promptMd,
  contextMd,
  provider,
  model,
  runtimeId,
  runId,
  turnId,
  contextWindowTokens,
  maxOutputTokens,
  safetyMarginTokens,
}) {
  const reservedOutputTokens = maxOutputTokens || 4096;
  const safetyMargin = safetyMarginTokens ?? 2048;
  const availableInputTokens = contextWindowTokens - reservedOutputTokens - safetyMargin;

  // Count immutable parts
  const systemPromptTokens = countTokens(SYSTEM_PROMPT, provider);
  const promptTokens = countTokens(promptMd || '', provider);
  const hasSeparator = !!(contextMd && contextMd.trim());
  const separatorTokens = hasSeparator ? countTokens(SEPARATOR, provider) : 0;
  const immutableTokens = systemPromptTokens + promptTokens + separatorTokens;

  // Build base report fields
  const baseReport = {
    provider,
    model,
    runtime_id: runtimeId,
    run_id: runId,
    turn_id: turnId,
    tokenizer: 'provider_local',
    context_window_tokens: contextWindowTokens,
    reserved_output_tokens: reservedOutputTokens,
    safety_margin_tokens: safetyMargin,
    available_input_tokens: availableInputTokens,
    system_prompt_tokens: systemPromptTokens,
    prompt_tokens: promptTokens,
    separator_tokens: separatorTokens,
  };

  // Prompt-only overflow: if immutable parts alone exceed budget, fail immediately
  if (immutableTokens > availableInputTokens) {
    const originalContextTokens = hasSeparator
      ? countTokens(contextMd, provider)
      : 0;

    return {
      sent_to_provider: false,
      effective_context: hasSeparator ? contextMd : '',
      report: {
        ...baseReport,
        original_context_tokens: originalContextTokens,
        final_context_tokens: originalContextTokens,
        estimated_input_tokens: immutableTokens + originalContextTokens,
        truncated: false,
        sent_to_provider: false,
        effective_context_path: getDispatchEffectiveContextPath(turnId),
        sections: [],
      },
    };
  }

  // No context case
  if (!hasSeparator) {
    return {
      sent_to_provider: true,
      effective_context: '',
      report: {
        ...baseReport,
        original_context_tokens: 0,
        final_context_tokens: 0,
        estimated_input_tokens: immutableTokens,
        truncated: false,
        sent_to_provider: true,
        effective_context_path: getDispatchEffectiveContextPath(turnId),
        sections: [],
      },
    };
  }

  // Parse context into sections and count original tokens per section
  const sections = parseContextSections(contextMd);
  const originalTokensById = new Map();
  for (const section of sections) {
    originalTokensById.set(section.id, countTokens(section.content, provider));
  }

  const originalContextTokens = countTokens(contextMd, provider);

  // Budget callback for the compressor: check if the full outbound request fits
  function fitsInBudget(effectiveContext) {
    const contextTokens = countTokens(effectiveContext, provider);
    return immutableTokens + contextTokens <= availableInputTokens;
  }

  // Check if it fits without compression
  if (fitsInBudget(contextMd)) {
    const sectionActions = sections.map((s) => ({
      id: s.id,
      required: s.required,
      original_tokens: originalTokensById.get(s.id),
      final_tokens: originalTokensById.get(s.id),
      action: 'kept',
    }));

    return {
      sent_to_provider: true,
      effective_context: contextMd,
      report: {
        ...baseReport,
        original_context_tokens: originalContextTokens,
        final_context_tokens: originalContextTokens,
        estimated_input_tokens: immutableTokens + originalContextTokens,
        truncated: false,
        sent_to_provider: true,
        effective_context_path: getDispatchEffectiveContextPath(turnId),
        sections: sectionActions,
      },
    };
  }

  // Run compression
  const compressionResult = compressContextSections(sections, fitsInBudget);
  const effectiveContext = compressionResult.effective_context;
  const finalContextTokens = countTokens(effectiveContext, provider);
  const estimatedInputTokens = immutableTokens + finalContextTokens;
  const sentToProvider = !compressionResult.exhausted;

  // Build per-section actions with token counts
  const sectionActions = compressionResult.actions.map((a) => {
    let finalTokens;
    if (a.action === 'dropped') {
      finalTokens = 0;
    } else if (a.action === 'truncated') {
      const remaining = compressionResult.sections.find((s) => s.id === a.id);
      finalTokens = remaining ? countTokens(remaining.content, provider) : 0;
    } else {
      finalTokens = originalTokensById.get(a.id) ?? 0;
    }

    return {
      id: a.id,
      required: a.required,
      original_tokens: originalTokensById.get(a.id) ?? 0,
      final_tokens: finalTokens,
      action: a.action,
    };
  });

  return {
    sent_to_provider: sentToProvider,
    effective_context: effectiveContext,
    report: {
      ...baseReport,
      original_context_tokens: originalContextTokens,
      final_context_tokens: finalContextTokens,
      estimated_input_tokens: estimatedInputTokens,
      truncated: compressionResult.steps_applied > 0,
      sent_to_provider: sentToProvider,
      effective_context_path: getDispatchEffectiveContextPath(turnId),
      sections: sectionActions,
    },
  };
}

export { SYSTEM_PROMPT, SEPARATOR };
