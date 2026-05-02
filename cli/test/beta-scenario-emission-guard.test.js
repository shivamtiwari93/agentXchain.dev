/**
 * Discipline guard: beta-tester-scenario tests must not use hardcoded gate
 * reason strings without also calling the real gate evaluator.
 *
 * Background: BUG-36 was falsely closed because its test used a hardcoded
 * reason string that didn't match the real evaluator output. BUG-37 fixed
 * the false closure. This guard prevents the pattern from recurring.
 *
 * Rule: if a beta-tester-scenario test file contains a string literal that
 * looks like a gate failure reason (patterns from gate-evaluator.js and
 * workflow-gate-semantics.js), it must also import and call the real
 * evaluator to verify the string matches reality.
 */

import { describe, it } from 'vitest';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const SCENARIOS_DIR = join(import.meta.dirname, 'beta-tester-scenarios');

// Patterns that match gate failure reason strings from the production code.
// If a test uses these patterns in string literals (not comments), it must
// also import the real gate evaluator.
const GATE_REASON_PATTERNS = [
  /must define\s+##/,            // workflow-gate-semantics.js semantic checks
  /Required file missing:/,       // gate-evaluator.js file-existence checks
  /Document must contain sections/,// workflow-gate-semantics.js generic doc gate
  /must define .* before .* can exit/, // planning/implementation/ship exit reasons
];

// Import patterns that indicate the test calls the real evaluator
const REAL_EVALUATOR_IMPORTS = [
  /import\s+.*evaluatePhaseExit.*from/,
  /import\s+.*evaluateRunCompletion.*from/,
  /import\s+.*gate-evaluator/,
  /require\s*\(\s*['"].*gate-evaluator/,
];

const REAL_EVALUATOR_CALLS = [
  /\bevaluatePhaseExit\s*\(/,
  /\bevaluateRunCompletion\s*\(/,
];

function isInComment(line) {
  const trimmed = line.trim();
  return trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*');
}

function collectGateReasonMatches(content) {
  const matches = [];

  for (const line of content.split('\n')) {
    if (isInComment(line)) continue;
    for (const pattern of GATE_REASON_PATTERNS) {
      if (pattern.test(line)) {
        matches.push({ line: line.trim(), pattern: pattern.source });
      }
    }
  }

  return matches;
}

function analyzeScenarioContent(content) {
  const matches = collectGateReasonMatches(content);
  const usesGateReasonStrings = matches.length > 0;
  const importsEvaluator = REAL_EVALUATOR_IMPORTS.some(pattern => pattern.test(content));
  const callsEvaluator = REAL_EVALUATOR_CALLS.some(pattern => pattern.test(content));

  return {
    usesGateReasonStrings,
    importsEvaluator,
    callsEvaluator,
    satisfiesGuard: !usesGateReasonStrings || (importsEvaluator && callsEvaluator),
    matches,
  };
}

describe('beta-scenario emission guard', () => {
  const scenarioFiles = readdirSync(SCENARIOS_DIR)
    .filter(f => f.endsWith('.test.js'));

  it('every scenario file that uses gate reason strings must import and call the real evaluator', () => {
    const violations = [];

    for (const file of scenarioFiles) {
      const content = readFileSync(join(SCENARIOS_DIR, file), 'utf8');
      const analysis = analyzeScenarioContent(content);

      if (!analysis.usesGateReasonStrings) continue;

      if (!analysis.satisfiesGuard) {
        violations.push({
          file,
          matches: analysis.matches,
          importsEvaluator: analysis.importsEvaluator,
          callsEvaluator: analysis.callsEvaluator,
        });
      }
    }

    if (violations.length > 0) {
      const details = violations.map(v =>
        `  ${v.file}:\n` +
        `    - imports evaluator: ${v.importsEvaluator}\n` +
        `    - calls evaluator: ${v.callsEvaluator}\n` +
        `${v.matches.map(m => `    - "${m.line}" (pattern: ${m.pattern})`).join('\n')}`
      ).join('\n\n');
      assert.fail(
        `${violations.length} beta-tester-scenario test(s) use hardcoded gate reason ` +
        `strings without both importing and calling the real gate evaluator.\n\n` +
        `This is the exact pattern that caused BUG-36's false closure. ` +
        `Either call evaluatePhaseExit()/evaluateRunCompletion() to produce ` +
        `the reason string, or verify the hardcoded string matches the real ` +
        `evaluator output in the same test.\n\n${details}`
      );
    }
  });

  it('known gate reason formats in tests match production code patterns', () => {
    // Verify that the patterns we guard against actually exist in production code
    const gateEvaluatorSrc = readFileSync(
      join(import.meta.dirname, '..', 'src', 'lib', 'gate-evaluator.js'), 'utf8'
    );
    const workflowGateSrc = readFileSync(
      join(import.meta.dirname, '..', 'src', 'lib', 'workflow-gate-semantics.js'), 'utf8'
    );
    const productionCode = gateEvaluatorSrc + '\n' + workflowGateSrc;

    assert.match(productionCode, /Required file missing:/,
      'Production code must contain "Required file missing:" pattern');
    assert.match(productionCode, /must define/,
      'Production code must contain "must define" pattern');
    assert.match(productionCode, /Document must contain sections/,
      'Production code must contain "Document must contain sections" pattern');
  });

  it('fails dead-import scenarios that never call the evaluator', () => {
    const content = `
      import { evaluatePhaseExit } from '../../src/lib/gate-evaluator.js';
      const expectedReason = '.planning/IMPLEMENTATION_NOTES.md must define ## Changes before implementation can exit.';
    `;

    assert.deepEqual(analyzeScenarioContent(content), {
      usesGateReasonStrings: true,
      importsEvaluator: true,
      callsEvaluator: false,
      satisfiesGuard: false,
      matches: [
        {
          line: "const expectedReason = '.planning/IMPLEMENTATION_NOTES.md must define ## Changes before implementation can exit.';",
          pattern: 'must define\\s+##',
        },
        {
          line: "const expectedReason = '.planning/IMPLEMENTATION_NOTES.md must define ## Changes before implementation can exit.';",
          pattern: 'must define .* before .* can exit',
        },
      ],
    });
  });

  it('allows scenarios that call the evaluator for the emitted reason', () => {
    const content = `
      import { evaluatePhaseExit } from '../../src/lib/gate-evaluator.js';
      const gateResult = evaluatePhaseExit({ gates: {} });
      assert.deepEqual(
        gateResult.reasons,
        ['.planning/IMPLEMENTATION_NOTES.md must define ## Changes before implementation can exit.']
      );
    `;

    const analysis = analyzeScenarioContent(content);

    assert.equal(analysis.usesGateReasonStrings, true);
    assert.equal(analysis.importsEvaluator, true);
    assert.equal(analysis.callsEvaluator, true);
    assert.equal(analysis.satisfiesGuard, true);
  });
});
