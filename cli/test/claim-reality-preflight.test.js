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
      'src/lib/verification-replay.js',
      'src/lib/workflow-gate-semantics.js',
      'src/lib/intent-phase-scope.js',
      'src/lib/intent-startup-migration.js',
    ];
    const missing = criticalFiles.filter(f => !packedFiles.has(f));
    assert.equal(missing.length, 0,
      `Critical lib files missing from tarball: ${missing.join(', ')}`);
  });

  it('BUG-44 continuous command-path proof exists and its production imports are packed', () => {
    const packedFiles = getPackedFiles();
    const bug44ContinuousTest = join(SCENARIOS_DIR, 'bug-44-continue-from-continuous.test.js');
    const imports = extractImports(bug44ContinuousTest);
    // The test must import at least intake.js (for intent seeding) from production
    assert.ok(imports.length > 0,
      'BUG-44 continuous command-path test must import production modules');
    const missing = imports.filter(imp => !packedFiles.has(imp));
    assert.equal(missing.length, 0,
      `BUG-44 continuous test imports production files missing from tarball: ${missing.join(', ')}`);
    // Verify the test file itself exists (guards against accidental deletion)
    const testContent = readFileSync(bug44ContinuousTest, 'utf8');
    assert.ok(testContent.includes('--continue-from') && testContent.includes('--continuous'),
      'BUG-44 continuous test must exercise the exact tester command shape');
  });

  it('BUG-45 retained-turn reconciliation proof exists and its production imports are packed', () => {
    const packedFiles = getPackedFiles();
    const bug45Test = join(SCENARIOS_DIR, 'bug-45-retained-turn-stale-intent-coverage.test.js');
    const imports = extractImports(bug45Test);
    assert.ok(imports.length > 0,
      'BUG-45 retained-turn reconciliation test must import production modules');
    const missing = imports.filter(imp => !packedFiles.has(imp));
    assert.equal(missing.length, 0,
      `BUG-45 retained-turn test imports production files missing from tarball: ${missing.join(', ')}`);
    const testContent = readFileSync(bug45Test, 'utf8');
    assert.ok(testContent.includes('accept-turn') && testContent.includes('--outcome') && testContent.includes('HUMAN_TASKS.md'),
      'BUG-45 test must cover accept-turn reconciliation, intake resolve override, and HUMAN_TASKS.md drift');
  });

  it('BUG-46 post-acceptance deadlock proof exists and its production imports are packed', () => {
    const packedFiles = getPackedFiles();
    const bug46Test = join(SCENARIOS_DIR, 'bug-46-post-acceptance-deadlock.test.js');
    const imports = extractImports(bug46Test);
    assert.ok(imports.length > 0,
      'BUG-46 post-acceptance deadlock test must import production modules');
    const missing = imports.filter(imp => !packedFiles.has(imp));
    assert.equal(missing.length, 0,
      `BUG-46 test imports production files missing from tarball: ${missing.join(', ')}`);
    const testContent = readFileSync(bug46Test, 'utf8');
    assert.ok(testContent.includes('accept-turn') && testContent.includes('checkpoint-turn') && testContent.includes('resume'),
      'BUG-46 test must cover the accept-turn/checkpoint-turn/resume deadlock seam');
    assert.ok(testContent.includes('require_reproducible_verification') && testContent.includes('authoritative'),
      'BUG-46 test must exercise reproducible-verification replay on an authoritative role');
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
