import { extractStatus, parseDecisionLog } from './parser.js';

const VALID_STATUSES = new Set(['proposed', 'accepted', 'rejected', 'superseded']);

function hasSection(body, heading) {
  return String(body).includes(heading);
}

function pushError(errors, decisionId, code, message) {
  errors.push({
    decision_id: decisionId,
    code,
    message,
  });
}

export function lintDecisionLog(source) {
  const decisions = parseDecisionLog(source);
  const errors = [];
  const seenIds = new Set();

  if (decisions.length === 0) {
    return {
      ok: false,
      decisions_checked: 0,
      errors: [
        {
          decision_id: null,
          code: 'no_decisions_found',
          message: 'No decision entries were found. Expected headings like `## DEC-001 - Title`.',
        },
      ],
    };
  }

  for (const decision of decisions) {
    if (seenIds.has(decision.id)) {
      pushError(errors, decision.id, 'duplicate_id', `Duplicate decision ID "${decision.id}" found.`);
    } else {
      seenIds.add(decision.id);
    }

    if (!decision.title) {
      pushError(errors, decision.id, 'missing_title', `Decision "${decision.id}" must include a title in the heading.`);
    }

    const status = extractStatus(decision.body);
    if (!status) {
      pushError(errors, decision.id, 'missing_status', `Decision "${decision.id}" is missing a \`Status:\` line.`);
    } else if (!VALID_STATUSES.has(status.toLowerCase())) {
      pushError(
        errors,
        decision.id,
        'invalid_status',
        `Decision "${decision.id}" has invalid status "${status}". Expected one of: ${[...VALID_STATUSES].join(', ')}.`,
      );
    }

    if (!hasSection(decision.body, '### Decision')) {
      pushError(errors, decision.id, 'missing_decision_section', `Decision "${decision.id}" must include a \`### Decision\` section.`);
    }

    if (!hasSection(decision.body, '### Rationale')) {
      pushError(errors, decision.id, 'missing_rationale_section', `Decision "${decision.id}" must include a \`### Rationale\` section.`);
    }
  }

  return {
    ok: errors.length === 0,
    decisions_checked: decisions.length,
    errors,
  };
}

export function formatHumanReport(result, filePath) {
  if (result.ok) {
    return `PASS ${filePath} (${result.decisions_checked} decisions checked)\n`;
  }

  const lines = [`FAIL ${filePath} (${result.errors.length} errors)\n`];
  for (const error of result.errors) {
    const prefix = error.decision_id ? `${error.decision_id}:` : 'file:';
    lines.push(`- ${prefix} ${error.message}`);
  }
  return `${lines.join('\n')}\n`;
}
