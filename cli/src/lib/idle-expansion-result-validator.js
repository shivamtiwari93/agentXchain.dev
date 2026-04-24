import { VALID_GOVERNED_TEMPLATE_IDS } from './governed-templates.js';

const VALID_KINDS = ['new_intake_intent', 'vision_exhausted'];
const VALID_TRACE_KINDS = ['advances', 'supports', 'unblocks'];
const VALID_EXHAUSTION_STATUSES = ['complete', 'deferred', 'out_of_scope'];
const VALID_PRIORITIES = ['p0', 'p1', 'p2', 'p3'];

export function validateIdleExpansionTurnResult(turnResult, context = {}) {
  const required = context.required === true;
  const errors = [];
  const warnings = [];
  const result = turnResult?.idle_expansion_result;

  if (result === undefined || result === null) {
    if (required) {
      errors.push('idle_expansion_result is required for vision_idle_expansion turns.');
    }
    return { ok: errors.length === 0, errors, warnings };
  }

  if (typeof result !== 'object' || Array.isArray(result)) {
    return {
      ok: false,
      errors: ['idle_expansion_result must be an object.'],
      warnings,
    };
  }

  if (!VALID_KINDS.includes(result.kind)) {
    errors.push(`idle_expansion_result.kind must be one of: ${VALID_KINDS.join(', ')}.`);
  }

  if (!Number.isInteger(result.expansion_iteration) || result.expansion_iteration < 1) {
    errors.push('idle_expansion_result.expansion_iteration must be a positive integer.');
  } else if (
    Number.isInteger(context.expansionIteration)
    && context.expansionIteration >= 1
    && result.expansion_iteration !== context.expansionIteration
  ) {
    errors.push(
      `idle_expansion_result.expansion_iteration mismatch: got ${result.expansion_iteration}, expected ${context.expansionIteration}.`
    );
  }

  const visionHeadings = normalizeVisionHeadingSnapshot(context.visionHeadingsSnapshot);
  const traceErrors = validateVisionTraceability(result.vision_traceability, {
    required: result.kind === 'new_intake_intent',
    visionHeadings,
  });
  errors.push(...traceErrors);

  if (result.kind === 'new_intake_intent') {
    errors.push(...validateNewIntakeIntent(result.new_intake_intent));
    if ('vision_exhausted' in result) {
      errors.push('idle_expansion_result.vision_exhausted is only allowed when kind is "vision_exhausted".');
    }
  }

  if (result.kind === 'vision_exhausted') {
    errors.push(...validateVisionExhausted(result.vision_exhausted, visionHeadings));
    if ('new_intake_intent' in result) {
      errors.push('idle_expansion_result.new_intake_intent is only allowed when kind is "new_intake_intent".');
    }
  }

  return { ok: errors.length === 0, errors, warnings };
}

export function summarizeIdleExpansionResult(turnResult) {
  const result = turnResult?.idle_expansion_result;
  if (!result || typeof result !== 'object' || Array.isArray(result)) {
    return null;
  }

  if (result.kind === 'new_intake_intent') {
    return {
      kind: result.kind,
      expansion_iteration: result.expansion_iteration,
      new_intent_title: truncate(result.new_intake_intent?.title || '', 120),
      priority: result.new_intake_intent?.priority || null,
      template: result.new_intake_intent?.template || null,
    };
  }

  if (result.kind === 'vision_exhausted') {
    const firstReason = Array.isArray(result.vision_exhausted?.classification)
      ? result.vision_exhausted.classification.find((entry) => typeof entry?.reason === 'string')?.reason || ''
      : '';
    return {
      kind: result.kind,
      expansion_iteration: result.expansion_iteration,
      reason_excerpt: truncate(firstReason, 160),
    };
  }

  return {
    kind: result.kind || null,
    expansion_iteration: result.expansion_iteration || null,
  };
}

function validateVisionTraceability(traceability, { required, visionHeadings }) {
  const errors = [];

  if (!Array.isArray(traceability)) {
    errors.push('idle_expansion_result.vision_traceability must be an array.');
    return errors;
  }
  if (required && traceability.length === 0) {
    errors.push('idle_expansion_result.vision_traceability must cite at least one VISION.md heading for new_intake_intent.');
  }

  for (let i = 0; i < traceability.length; i++) {
    const entry = traceability[i];
    const prefix = `idle_expansion_result.vision_traceability[${i}]`;
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      errors.push(`${prefix} must be an object.`);
      continue;
    }

    const heading = typeof entry.vision_heading === 'string' ? entry.vision_heading.trim() : '';
    if (!heading) {
      errors.push(`${prefix}.vision_heading must be a non-empty string.`);
    } else if (visionHeadings.length > 0 && !visionHeadings.includes(heading)) {
      errors.push(`${prefix}.vision_heading "${heading}" is not present in the session VISION.md heading snapshot.`);
    }

    if (entry.goal !== undefined && (typeof entry.goal !== 'string' || !entry.goal.trim())) {
      errors.push(`${prefix}.goal must be a non-empty string when provided.`);
    }
    if (entry.kind !== undefined && !VALID_TRACE_KINDS.includes(entry.kind)) {
      errors.push(`${prefix}.kind must be one of: ${VALID_TRACE_KINDS.join(', ')}.`);
    }
  }

  return errors;
}

function validateNewIntakeIntent(intent) {
  const errors = [];
  const prefix = 'idle_expansion_result.new_intake_intent';

  if (!intent || typeof intent !== 'object' || Array.isArray(intent)) {
    return [`${prefix} must be an object.`];
  }

  for (const field of ['title', 'charter']) {
    if (typeof intent[field] !== 'string' || !intent[field].trim()) {
      errors.push(`${prefix}.${field} must be a non-empty string.`);
    }
  }

  if (!VALID_PRIORITIES.includes(intent.priority)) {
    errors.push(`${prefix}.priority must be one of: ${VALID_PRIORITIES.join(', ')}.`);
  }
  if (!VALID_GOVERNED_TEMPLATE_IDS.includes(intent.template)) {
    errors.push(`${prefix}.template must be one of: ${VALID_GOVERNED_TEMPLATE_IDS.join(', ')}.`);
  }
  if (!Array.isArray(intent.acceptance_contract) || intent.acceptance_contract.length === 0) {
    errors.push(`${prefix}.acceptance_contract must be a non-empty array.`);
  } else {
    for (let i = 0; i < intent.acceptance_contract.length; i++) {
      if (typeof intent.acceptance_contract[i] !== 'string' || !intent.acceptance_contract[i].trim()) {
        errors.push(`${prefix}.acceptance_contract[${i}] must be a non-empty string.`);
      }
    }
  }

  return errors;
}

function validateVisionExhausted(visionExhausted, visionHeadings) {
  const errors = [];
  const prefix = 'idle_expansion_result.vision_exhausted';

  if (!visionExhausted || typeof visionExhausted !== 'object' || Array.isArray(visionExhausted)) {
    return [`${prefix} must be an object.`];
  }

  const classification = visionExhausted.classification;
  if (!Array.isArray(classification) || classification.length === 0) {
    errors.push(`${prefix}.classification must be a non-empty array.`);
    return errors;
  }

  const classifiedHeadings = new Set();
  for (let i = 0; i < classification.length; i++) {
    const entry = classification[i];
    const entryPrefix = `${prefix}.classification[${i}]`;
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      errors.push(`${entryPrefix} must be an object.`);
      continue;
    }

    const heading = typeof entry.vision_heading === 'string' ? entry.vision_heading.trim() : '';
    if (!heading) {
      errors.push(`${entryPrefix}.vision_heading must be a non-empty string.`);
    } else {
      classifiedHeadings.add(heading);
      if (visionHeadings.length > 0 && !visionHeadings.includes(heading)) {
        errors.push(`${entryPrefix}.vision_heading "${heading}" is not present in the session VISION.md heading snapshot.`);
      }
    }
    if (!VALID_EXHAUSTION_STATUSES.includes(entry.status)) {
      errors.push(`${entryPrefix}.status must be one of: ${VALID_EXHAUSTION_STATUSES.join(', ')}.`);
    }
    if (typeof entry.reason !== 'string' || !entry.reason.trim()) {
      errors.push(`${entryPrefix}.reason must be a non-empty string.`);
    }
  }

  for (const heading of visionHeadings) {
    if (!classifiedHeadings.has(heading)) {
      errors.push(`${prefix}.classification must classify VISION.md heading "${heading}".`);
    }
  }

  return errors;
}

function normalizeVisionHeadingSnapshot(snapshot) {
  if (!Array.isArray(snapshot)) {
    return [];
  }

  const headings = [];
  for (const item of snapshot) {
    const heading = typeof item === 'string'
      ? item.trim()
      : typeof item?.heading === 'string'
        ? item.heading.trim()
        : typeof item?.title === 'string'
          ? item.title.trim()
          : '';
    if (heading && !headings.includes(heading)) {
      headings.push(heading);
    }
  }
  return headings;
}

function truncate(value, maxLength) {
  if (typeof value !== 'string') {
    return '';
  }
  const trimmed = value.trim();
  if (trimmed.length <= maxLength) {
    return trimmed;
  }
  return `${trimmed.slice(0, maxLength - 3)}...`;
}
