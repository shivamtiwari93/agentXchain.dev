/**
 * Claim-reality preflight gate — discipline rule from HUMAN-ROADMAP.md.
 *
 * Verifies that every source file imported by beta-tester-scenario tests
 * is included in the npm-packed tarball. This catches the "source passes,
 * published binary fails" class of bug where tests exercise code that
 * isn't shipped.
 *
 * Runs as part of the release-gate test suite.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve, dirname, relative } from 'node:path';
import { execSync } from 'node:child_process';

const CLI_DIR = resolve(import.meta.dirname, '..');
const SCENARIOS_DIR = join(import.meta.dirname, 'beta-tester-scenarios');

function getPackedFiles() {
  const output = execSync('npm pack --dry-run --json 2>/dev/null', {
    cwd: CLI_DIR,
    encoding: 'utf8',
    timeout: 30000,
  });
  const data = JSON.parse(output);
  return new Set(data[0].files.map(f => f.path));
}

function extractImports(filePath) {
  const content = readFileSync(filePath, 'utf8');
  const imports = [];
  // Match: import ... from '../../src/...'
  // Match: require('../../src/...')
  const importRegex = /(?:import\s+.*?from\s+['"]|require\s*\(\s*['"])(\.\.[/\\].*?)['")]/g;
  let match;
  while ((match = importRegex.exec(content)) !== null) {
    const importPath = match[1];
    // Resolve relative to the test file's directory
    const resolvedPath = resolve(dirname(filePath), importPath);
    // Convert to relative path from CLI_DIR
    const relPath = relative(CLI_DIR, resolvedPath);
    // Only track imports that resolve to src/ (production code)
    if (relPath.startsWith('src/')) {
      imports.push(relPath);
    }
  }
  return imports;
}

describe('claim-reality preflight', () => {
  it('all production imports used by beta-tester-scenario tests are in the npm tarball', () => {
    const packedFiles = getPackedFiles();
    const scenarioFiles = readdirSync(SCENARIOS_DIR)
      .filter(f => f.endsWith('.test.js'))
      .map(f => join(SCENARIOS_DIR, f));

    const missingFiles = [];

    for (const scenarioFile of scenarioFiles) {
      const imports = extractImports(scenarioFile);
      for (const imp of imports) {
        if (!packedFiles.has(imp)) {
          missingFiles.push({
            scenario: relative(CLI_DIR, scenarioFile),
            import: imp,
          });
        }
      }
    }

    if (missingFiles.length > 0) {
      const details = missingFiles.map(m =>
        `  ${m.scenario} imports ${m.import}`
      ).join('\n');
      assert.fail(
        `${missingFiles.length} production file(s) imported by beta-tester-scenario ` +
        `tests are NOT included in the npm tarball.\n\n` +
        `This means the tests pass against the source tree but the published ` +
        `package is missing these files. Either add the missing paths to the ` +
        `"files" field in package.json, or fix the import path.\n\n${details}`
      );
    }
  });

  it('tarball includes all core lib modules', () => {
    const packedFiles = getPackedFiles();
    // These are the production files most commonly used by beta scenarios
    const criticalFiles = [
      'src/lib/governed-state.js',
      'src/lib/gate-evaluator.js',
      'src/lib/dispatch-bundle.js',
      'src/lib/intake.js',
      'src/lib/workflow-gate-semantics.js',
    ];
    const missing = criticalFiles.filter(f => !packedFiles.has(f));
    assert.equal(missing.length, 0,
      `Critical lib files missing from tarball: ${missing.join(', ')}`);
  });

  it('scenario test count matches expected range', () => {
    const scenarioFiles = readdirSync(SCENARIOS_DIR)
      .filter(f => f.endsWith('.test.js') && f.startsWith('bug-'));
    // There should be at least 30 bug scenario files (BUG-1 through BUG-39,
    // minus the few that share files). If the count drops, someone deleted a
    // regression test.
    assert.ok(scenarioFiles.length >= 30,
      `Expected at least 30 bug scenario files, found ${scenarioFiles.length}. ` +
      `Beta-tester regression tests must not be deleted.`);
  });
});
