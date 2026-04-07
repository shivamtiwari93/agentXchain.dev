import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export const PM_SIGNOFF_PATH = '.planning/PM_SIGNOFF.md';
export const SYSTEM_SPEC_PATH = '.planning/SYSTEM_SPEC.md';
export const SHIP_VERDICT_PATH = '.planning/ship-verdict.md';

const AFFIRMATIVE_SHIP_VERDICTS = new Set(['YES', 'SHIP', 'SHIP IT']);

function normalizeToken(value) {
  return value.trim().replace(/\s+/g, ' ').toUpperCase();
}

function readFile(root, relPath) {
  const absPath = join(root, relPath);
  if (!existsSync(absPath)) {
    return null;
  }
  return readFileSync(absPath, 'utf8');
}

function parseLineValue(content, pattern) {
  const match = content.match(pattern);
  return match ? match[1].trim() : null;
}

function evaluatePmSignoff(content) {
  const approved = parseLineValue(content, /^Approved\s*:\s*(.+)$/im);
  if (!approved) {
    return {
      ok: false,
      reason: 'PM signoff must declare `Approved: YES` in .planning/PM_SIGNOFF.md.',
    };
  }

  if (normalizeToken(approved) !== 'YES') {
    return {
      ok: false,
      reason: `PM signoff is not approved. Found "Approved: ${approved}" in .planning/PM_SIGNOFF.md; set it to "Approved: YES".`,
    };
  }

  return { ok: true };
}

function evaluateSystemSpec(content) {
  const requiredSections = ['## Purpose', '## Interface', '## Acceptance Tests'];
  const missingSections = requiredSections.filter((section) => !content.includes(section));

  if (missingSections.length > 0) {
    return {
      ok: false,
      reason: `.planning/SYSTEM_SPEC.md must define ${missingSections.join(', ')} before planning can exit.`,
    };
  }

  return { ok: true };
}

function evaluateShipVerdict(content) {
  const verdict = parseLineValue(content, /^##\s+Verdict\s*:\s*(.+)$/im);
  if (!verdict) {
    return {
      ok: false,
      reason: 'Ship verdict must declare an affirmative `## Verdict:` line in .planning/ship-verdict.md.',
    };
  }

  if (!AFFIRMATIVE_SHIP_VERDICTS.has(normalizeToken(verdict))) {
    return {
      ok: false,
      reason: `Ship verdict is not affirmative. Found "## Verdict: ${verdict}" in .planning/ship-verdict.md; use "## Verdict: YES".`,
    };
  }

  return { ok: true };
}

export function evaluateWorkflowGateSemantics(root, relPath) {
  const content = readFile(root, relPath);
  if (content === null) {
    return null;
  }

  if (relPath === PM_SIGNOFF_PATH) {
    return evaluatePmSignoff(content);
  }

  if (relPath === SYSTEM_SPEC_PATH) {
    return evaluateSystemSpec(content);
  }

  if (relPath === SHIP_VERDICT_PATH) {
    return evaluateShipVerdict(content);
  }

  return null;
}
