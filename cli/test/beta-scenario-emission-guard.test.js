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

import { describe, it } from 'node:test';
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

function isInComment(line) {
  const trimmed = line.trim();
  return trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*');
}

describe('beta-scenario emission guard', () => {
  const scenarioFiles = readdirSync(SCENARIOS_DIR)
    .filter(f => f.endsWith('.test.js'));

  it('every scenario file that uses gate reason strings must import the real evaluator', () => {
    const violations = [];

    for (const file of scenarioFiles) {
      const content = readFileSync(join(SCENARIOS_DIR, file), 'utf8');
      const lines = content.split('\n');

      // Check if this file uses any gate reason patterns in non-comment lines
      let usesGateReasonStrings = false;
      const matchedPatterns = [];

      for (const line of lines) {
        if (isInComment(line)) continue;
        for (const pattern of GATE_REASON_PATTERNS) {
          if (pattern.test(line)) {
            usesGateReasonStrings = true;
            matchedPatterns.push({ line: line.trim(), pattern: pattern.source });
          }
        }
      }

      if (!usesGateReasonStrings) continue;

      // File uses gate reason strings — verify it imports the real evaluator
      const importsEvaluator = REAL_EVALUATOR_IMPORTS.some(p => p.test(content));

      if (!importsEvaluator) {
        violations.push({
          file,
          matches: matchedPatterns,
        });
      }
    }

    if (violations.length > 0) {
      const details = violations.map(v =>
        `  ${v.file}:\n${v.matches.map(m => `    - "${m.line}" (pattern: ${m.pattern})`).join('\n')}`
      ).join('\n\n');
      assert.fail(
        `${violations.length} beta-tester-scenario test(s) use hardcoded gate reason ` +
        `strings without importing the real gate evaluator.\n\n` +
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
});
