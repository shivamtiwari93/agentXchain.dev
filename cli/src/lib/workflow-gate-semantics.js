import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export const PM_SIGNOFF_PATH = '.planning/PM_SIGNOFF.md';
export const SYSTEM_SPEC_PATH = '.planning/SYSTEM_SPEC.md';
export const IMPLEMENTATION_NOTES_PATH = '.planning/IMPLEMENTATION_NOTES.md';
export const ACCEPTANCE_MATRIX_PATH = '.planning/acceptance-matrix.md';
export const SHIP_VERDICT_PATH = '.planning/ship-verdict.md';
export const RELEASE_NOTES_PATH = '.planning/RELEASE_NOTES.md';
export const RECOVERY_REPORT_PATH = '.agentxchain/multirepo/RECOVERY_REPORT.md';

const AFFIRMATIVE_SHIP_VERDICTS = new Set(['YES', 'SHIP', 'SHIP IT']);
const AFFIRMATIVE_ACCEPTANCE_STATUSES = new Set(['PASS', 'PASSED', 'OK', 'YES']);

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

function isMarkdownSeparatorRow(cells) {
  return cells.length > 0 && cells.every((cell) => /^:?-{3,}:?$/.test(cell));
}

function evaluateAcceptanceMatrix(content) {
  const lines = content.split(/\r?\n/);
  const headerIndex = lines.findIndex((line) => /^\|\s*Req\s*#\s*\|/i.test(line));

  if (headerIndex === -1) {
    return {
      ok: false,
      reason: 'Acceptance matrix must preserve the `| Req # |` requirement table header in .planning/acceptance-matrix.md.',
    };
  }

  const rows = [];
  let sawTable = false;

  for (let index = headerIndex + 1; index < lines.length; index++) {
    const line = lines[index];
    if (!line.trim()) {
      if (sawTable) break;
      continue;
    }

    if (!line.trim().startsWith('|')) {
      if (sawTable) break;
      continue;
    }

    sawTable = true;
    const cells = line
      .trim()
      .split('|')
      .slice(1, -1)
      .map((cell) => cell.trim());

    if (cells.length === 0 || isMarkdownSeparatorRow(cells)) {
      continue;
    }

    rows.push(cells);
  }

  const requirementRows = rows.filter((cells) => {
    const reqId = cells[0] || '';
    return reqId && !/^\(QA fills this from ROADMAP\.md\)$/i.test(reqId);
  });

  if (requirementRows.length === 0) {
    return {
      ok: false,
      reason: 'Acceptance matrix has no real requirement verdict rows. Replace the scaffold placeholder with QA-owned requirement results before requesting ship approval.',
    };
  }

  const failingRows = [];
  for (const cells of requirementRows) {
    const reqId = cells[0] || '<unknown>';
    const status = cells[cells.length - 1] || '';
    const normalizedStatus = status ? normalizeToken(status) : '';
    if (!AFFIRMATIVE_ACCEPTANCE_STATUSES.has(normalizedStatus)) {
      failingRows.push(`${reqId}=${status || 'missing'}`);
    }
  }

  if (failingRows.length > 0) {
    return {
      ok: false,
      reason: `Acceptance matrix still has non-passing requirement rows in .planning/acceptance-matrix.md: ${failingRows.join(', ')}. Mark every requirement row with a passing Status before requesting ship approval.`,
    };
  }

  return { ok: true };
}

const IMPLEMENTATION_NOTES_PLACEHOLDER = /^\(Dev fills this during implementation\)$/i;

function hasSectionContent(content, sectionHeader) {
  const lines = content.split(/\r?\n/);
  const headerIndex = lines.findIndex((line) => line.trim().startsWith(sectionHeader));
  if (headerIndex === -1) {
    return { found: false, hasContent: false };
  }

  for (let i = headerIndex + 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line.startsWith('## ')) break;
    if (!line) continue;
    if (IMPLEMENTATION_NOTES_PLACEHOLDER.test(line)) continue;
    return { found: true, hasContent: true };
  }

  return { found: true, hasContent: false };
}

function evaluateImplementationNotes(content) {
  const changes = hasSectionContent(content, '## Changes');
  const verification = hasSectionContent(content, '## Verification');

  const missingSections = [];
  if (!changes.found) missingSections.push('## Changes');
  if (!verification.found) missingSections.push('## Verification');

  if (missingSections.length > 0) {
    return {
      ok: false,
      reason: `.planning/IMPLEMENTATION_NOTES.md must define ${missingSections.join(' and ')} before implementation can exit.`,
    };
  }

  const emptySections = [];
  if (!changes.hasContent) emptySections.push('## Changes');
  if (!verification.hasContent) emptySections.push('## Verification');

  if (emptySections.length > 0) {
    return {
      ok: false,
      reason: `${emptySections.join(' and ')} in .planning/IMPLEMENTATION_NOTES.md still contains only placeholder text. Dev must replace placeholder content with real implementation notes.`,
    };
  }

  return { ok: true };
}

const RELEASE_NOTES_PLACEHOLDER = /^\(QA fills this during the QA phase\)$/i;

function hasReleaseNotesSectionContent(content, sectionHeader) {
  const lines = content.split(/\r?\n/);
  const headerIndex = lines.findIndex((line) => line.trim().startsWith(sectionHeader));
  if (headerIndex === -1) {
    return { found: false, hasContent: false };
  }

  for (let i = headerIndex + 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line.startsWith('## ')) break;
    if (!line) continue;
    if (RELEASE_NOTES_PLACEHOLDER.test(line)) continue;
    return { found: true, hasContent: true };
  }

  return { found: true, hasContent: false };
}

function evaluateReleaseNotes(content) {
  const userImpact = hasReleaseNotesSectionContent(content, '## User Impact');
  const verificationSummary = hasReleaseNotesSectionContent(content, '## Verification Summary');

  const missingSections = [];
  if (!userImpact.found) missingSections.push('## User Impact');
  if (!verificationSummary.found) missingSections.push('## Verification Summary');

  if (missingSections.length > 0) {
    return {
      ok: false,
      reason: `.planning/RELEASE_NOTES.md must define ${missingSections.join(' and ')} before ship approval can be requested.`,
    };
  }

  const emptySections = [];
  if (!userImpact.hasContent) emptySections.push('## User Impact');
  if (!verificationSummary.hasContent) emptySections.push('## Verification Summary');

  if (emptySections.length > 0) {
    return {
      ok: false,
      reason: `${emptySections.join(' and ')} in .planning/RELEASE_NOTES.md still contains only placeholder text. QA must replace placeholder content with real release notes.`,
    };
  }

  return { ok: true };
}

const RECOVERY_REPORT_PLACEHOLDER = /^\(Operator fills this before running multi resume\)$/i;

function hasRecoveryReportSectionContent(content, sectionHeader) {
  const lines = content.split(/\r?\n/);
  const headerIndex = lines.findIndex((line) => line.trim().startsWith(sectionHeader));
  if (headerIndex === -1) {
    return { found: false, hasContent: false };
  }

  for (let i = headerIndex + 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line.startsWith('## ')) break;
    if (!line) continue;
    if (RECOVERY_REPORT_PLACEHOLDER.test(line)) continue;
    return { found: true, hasContent: true };
  }

  return { found: true, hasContent: false };
}

export function evaluateRecoveryReport(workspacePath) {
  const content = readFile(workspacePath, RECOVERY_REPORT_PATH);
  if (content === null) {
    return null;
  }

  const trigger = hasRecoveryReportSectionContent(content, '## Trigger');
  const impact = hasRecoveryReportSectionContent(content, '## Impact');
  const mitigation = hasRecoveryReportSectionContent(content, '## Mitigation');

  const missingSections = [];
  if (!trigger.found) missingSections.push('## Trigger');
  if (!impact.found) missingSections.push('## Impact');
  if (!mitigation.found) missingSections.push('## Mitigation');

  if (missingSections.length > 0) {
    return {
      ok: false,
      reason: `Recovery report must define ${missingSections.join(' and ')} before resume.`,
    };
  }

  const emptySections = [];
  if (!trigger.hasContent) emptySections.push('## Trigger');
  if (!impact.hasContent) emptySections.push('## Impact');
  if (!mitigation.hasContent) emptySections.push('## Mitigation');

  if (emptySections.length > 0) {
    return {
      ok: false,
      reason: `Recovery report sections still contain placeholder text: ${emptySections.join(', ')}. Replace placeholder content before running multi resume.`,
    };
  }

  return { ok: true };
}

export function scaffoldRecoveryReport(workspacePath, blockedReason) {
  const absPath = join(workspacePath, RECOVERY_REPORT_PATH);
  if (existsSync(absPath)) {
    return false;
  }

  const reasonText = typeof blockedReason === 'string'
    ? blockedReason
    : JSON.stringify(blockedReason) || 'unknown';

  const content = `# Recovery Report

Coordinator entered blocked state. Fill in the sections below before running \`agentxchain multi resume\`.

**Blocked reason:** ${reasonText}
**Blocked at:** ${new Date().toISOString()}

## Trigger

(Operator fills this before running multi resume)

## Impact

(Operator fills this before running multi resume)

## Mitigation

(Operator fills this before running multi resume)

## Owner

(Optional: who performed the recovery)

## Exit Condition

(Optional: what must remain true after recovery)
`;

  writeFileSync(absPath, content);
  return true;
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

function evaluateSectionCheck(content, config) {
  if (!config?.required_sections?.length) {
    return { ok: true };
  }
  const missing = config.required_sections.filter(
    section => !content.includes(section)
  );
  if (missing.length > 0) {
    return {
      ok: false,
      reason: `Document must contain sections: ${missing.join(', ')}`,
    };
  }
  return { ok: true };
}

const SEMANTIC_VALIDATORS = {
  pm_signoff: evaluatePmSignoff,
  system_spec: evaluateSystemSpec,
  implementation_notes: evaluateImplementationNotes,
  acceptance_matrix: evaluateAcceptanceMatrix,
  ship_verdict: evaluateShipVerdict,
  release_notes: evaluateReleaseNotes,
  section_check: evaluateSectionCheck,
};

/**
 * Evaluate a workflow artifact's semantic constraints by validator ID.
 * @param {string} root - project root directory
 * @param {object} artifact - { path, semantics, semantics_config }
 * @returns {{ ok: boolean, reason?: string } | null}
 */
export function evaluateArtifactSemantics(root, artifact) {
  if (!artifact.semantics) return null;
  const validator = SEMANTIC_VALIDATORS[artifact.semantics];
  if (!validator) return null;
  const content = readFile(root, artifact.path);
  if (content === null) return null;
  if (artifact.semantics === 'section_check') {
    return validator(content, artifact.semantics_config);
  }
  return validator(content);
}

/**
 * Path-based dispatch (backward compat for code calling this directly).
 */
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

  if (relPath === IMPLEMENTATION_NOTES_PATH) {
    return evaluateImplementationNotes(content);
  }

  if (relPath === ACCEPTANCE_MATRIX_PATH) {
    return evaluateAcceptanceMatrix(content);
  }

  if (relPath === SHIP_VERDICT_PATH) {
    return evaluateShipVerdict(content);
  }

  if (relPath === RELEASE_NOTES_PATH) {
    return evaluateReleaseNotes(content);
  }

  return null;
}
