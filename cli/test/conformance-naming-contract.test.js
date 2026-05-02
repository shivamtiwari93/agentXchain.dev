import { strict as assert } from 'node:assert';
import { describe, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..', '..');
const FIXTURES_ROOT = join(REPO_ROOT, '.agentxchain-conformance', 'fixtures');
const CAPABILITIES_PATH = join(REPO_ROOT, '.agentxchain-conformance', 'capabilities.json');

function walkFixtures() {
  const results = [];
  for (const tierEntry of readdirSync(FIXTURES_ROOT, { withFileTypes: true })) {
    if (!tierEntry.isDirectory()) continue;
    const tierPath = join(FIXTURES_ROOT, tierEntry.name);
    for (const surfaceEntry of readdirSync(tierPath, { withFileTypes: true })) {
      if (!surfaceEntry.isDirectory()) continue;
      const surfacePath = join(tierPath, surfaceEntry.name);
      const dirName = surfaceEntry.name;
      for (const fixtureEntry of readdirSync(surfacePath, { withFileTypes: true })) {
        if (!fixtureEntry.isFile() || !fixtureEntry.name.endsWith('.json')) continue;
        const filePath = join(surfacePath, fixtureEntry.name);
        const fixture = JSON.parse(readFileSync(filePath, 'utf8'));
        results.push({ filePath, dirName, tier: tierEntry.name, fixture });
      }
    }
  }
  return results;
}

function collectDirectoryNames() {
  const dirs = new Set();
  for (const tierEntry of readdirSync(FIXTURES_ROOT, { withFileTypes: true })) {
    if (!tierEntry.isDirectory()) continue;
    const tierPath = join(FIXTURES_ROOT, tierEntry.name);
    for (const surfaceEntry of readdirSync(tierPath, { withFileTypes: true })) {
      if (!surfaceEntry.isDirectory()) continue;
      dirs.add(surfaceEntry.name);
    }
  }
  return dirs;
}

const allFixtures = walkFixtures();
const capabilities = JSON.parse(readFileSync(CAPABILITIES_PATH, 'utf8'));

describe('AT-NAMING-001: fixture surface field matches parent directory name', () => {
  for (const { filePath, dirName, fixture } of allFixtures) {
    const label = `${basename(filePath)} surface="${fixture.surface}" dir="${dirName}"`;
    it(label, () => {
      assert.equal(
        fixture.surface,
        dirName,
        `Fixture ${fixture.fixture_id} has surface "${fixture.surface}" but lives in directory "${dirName}". ` +
        `The directory must be renamed to match the canonical surface identifier.`
      );
    });
  }
});

describe('AT-NAMING-002: every capabilities.json surface has a matching fixture directory', () => {
  const dirs = collectDirectoryNames();
  for (const surface of Object.keys(capabilities.surfaces)) {
    it(`capabilities surface "${surface}" has a fixture directory`, () => {
      assert.ok(
        dirs.has(surface),
        `capabilities.json claims surface "${surface}" but no fixture directory named "${surface}" exists`
      );
    });
  }
});

describe('AT-NAMING-003: every fixture directory has at least one matching fixture', () => {
  const dirs = collectDirectoryNames();
  for (const dir of dirs) {
    it(`directory "${dir}" has at least one fixture with matching surface`, () => {
      const matching = allFixtures.filter(f => f.dirName === dir && f.fixture.surface === dir);
      assert.ok(
        matching.length > 0,
        `Directory "${dir}" exists but no fixture inside it has surface="${dir}"`
      );
    });
  }
});
