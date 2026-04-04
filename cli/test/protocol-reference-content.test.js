import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..', '..');

const read = (rel) => readFileSync(join(REPO_ROOT, rel), 'utf8');

const DOC_PATH = 'website-v2/docs/protocol-reference.mdx';
const DOC = read(DOC_PATH);
const ROOT_SPEC = read('PROTOCOL-v6.md');
const SIDEBARS = read('website-v2/sidebars.ts');
const PLANNING_SPEC = read('.planning/PROTOCOL_REFERENCE_SPEC.md');
const DOCS_SURFACE_SPEC = read('.planning/DOCS_SURFACE_SPEC.md');
const ROOT_README = read('README.md');
const CLI_README = read('cli/README.md');
const SCHEMA_SRC = read('cli/src/lib/schema.js');
const NORMALIZED_CONFIG_SRC = read('cli/src/lib/normalized-config.js');
const COORDINATOR_CONFIG_SRC = read('cli/src/lib/coordinator-config.js');

function extractArrayValues(source, declaration) {
  const match = source.match(new RegExp(`const ${declaration} = \\[(.*?)\\];`, 's'));
  assert.ok(match, `could not find ${declaration}`);
  return [...match[1].matchAll(/'([^']+)'/g)].map((item) => item[1]);
}

function extractSetValues(source, declaration) {
  const match = source.match(new RegExp(`const ${declaration} = new Set\\(\\[(.*?)\\]\\);`, 's'));
  assert.ok(match, `could not find ${declaration}`);
  return [...match[1].matchAll(/'([^']+)'/g)].map((item) => item[1]);
}

function collectConformanceSurfaces() {
  const fixturesRoot = join(REPO_ROOT, '.agentxchain-conformance', 'fixtures');
  const surfaces = new Set();

  for (const tierEntry of readdirSync(fixturesRoot, { withFileTypes: true })) {
    if (!tierEntry.isDirectory()) {
      continue;
    }
    const tierPath = join(fixturesRoot, tierEntry.name);
    for (const surfaceEntry of readdirSync(tierPath, { withFileTypes: true })) {
      if (!surfaceEntry.isDirectory()) {
        continue;
      }
      const surfacePath = join(tierPath, surfaceEntry.name);
      for (const fixtureEntry of readdirSync(surfacePath, { withFileTypes: true })) {
        if (!fixtureEntry.isFile() || !fixtureEntry.name.endsWith('.json')) {
          continue;
        }
        const fixture = JSON.parse(readFileSync(join(surfacePath, fixtureEntry.name), 'utf8'));
        if (typeof fixture.surface === 'string' && fixture.surface.trim()) {
          surfaces.add(fixture.surface);
        }
      }
    }
  }

  return [...surfaces].sort();
}

const RUN_STATUSES = extractArrayValues(SCHEMA_SRC, 'VALID_RUN_STATUSES');
const WRITE_AUTHORITIES = extractArrayValues(NORMALIZED_CONFIG_SRC, 'VALID_WRITE_AUTHORITIES');
const BARRIER_TYPES = extractSetValues(COORDINATOR_CONFIG_SRC, 'VALID_BARRIER_TYPES');
const CONFORMANCE_SURFACES = collectConformanceSurfaces();

describe('Protocol reference docs surface', () => {
  it('ships the Docusaurus page and planning spec', () => {
    assert.ok(existsSync(join(REPO_ROOT, DOC_PATH)), 'protocol reference page must exist');
    assert.ok(existsSync(join(REPO_ROOT, '.planning/PROTOCOL_REFERENCE_SPEC.md')), 'protocol reference planning spec must exist');
  });

  it('is wired into the sidebar', () => {
    assert.match(SIDEBARS, /'protocol-reference'/, 'sidebars.ts must include protocol-reference');
  });

  it('has the expected frontmatter and doc links', () => {
    assert.match(DOC, /title:\s*Protocol Reference v6/);
    assert.match(DOC, /description:/);
    assert.match(DOC, /\.\/protocol\)/);
    assert.match(DOC, /\.\/protocol-implementor-guide\)/);
    assert.match(DOC, /PROTOCOL-v6\.md/);
  });
});

describe('Protocol reference contract', () => {
  it('distinguishes protocol version, schema versions, and conformance tiers', () => {
    for (const term of [
      'Protocol version',
      'Governed config schema',
      'Turn result schema',
      'Governed state schema',
      'Coordinator config/state/context schema',
      'Conformance tiers',
      'Tier 1',
      'Tier 2',
      'Tier 3',
    ]) {
      assert.ok(DOC.includes(term), `protocol reference must mention ${term}`);
    }
    assert.match(ROOT_SPEC, /Protocol version: `v6`/);
    assert.match(ROOT_SPEC, /governed state: `1\.1`/);
  });

  it('documents every shipped governed run status from schema validation', () => {
    for (const status of RUN_STATUSES) {
      assert.ok(DOC.includes(`\`${status}\``), `protocol reference must mention run status "${status}"`);
    }
  });

  it('documents every shipped write authority from normalized config', () => {
    for (const authority of WRITE_AUTHORITIES) {
      assert.ok(DOC.includes(`\`${authority}\``), `protocol reference must mention write authority "${authority}"`);
    }
  });

  it('documents every shipped coordinator barrier type', () => {
    for (const barrierType of BARRIER_TYPES) {
      assert.ok(DOC.includes(`\`${barrierType}\``), `protocol reference must mention barrier type "${barrierType}"`);
    }
  });

  it('documents every shipped conformance surface from fixtures', () => {
    for (const surface of CONFORMANCE_SURFACES) {
      assert.ok(DOC.includes(`\`${surface}\``), `protocol reference must mention conformance surface "${surface}"`);
    }
  });

  it('explicitly rejects implementation leakage into the protocol boundary', () => {
    assert.match(DOC, /not normative/i);
    for (const term of ['dashboard', 'OpenAI', 'notifications.webhooks', 'CLI command names']) {
      assert.ok(DOC.includes(term), `protocol reference must classify ${term} outside the v6 core`);
    }
  });

  it('demotes CLI command names to reference-runner ergonomics in the root spec', () => {
    assert.match(ROOT_SPEC, /Reference CLI operator surface/);
    assert.match(ROOT_SPEC, /reference-runner commands/);
    assert.match(ROOT_SPEC, /Other runners may expose different operator commands/);
    assert.doesNotMatch(ROOT_SPEC, /Repo-local commands remain:/);
  });
});

describe('Protocol reference discoverability', () => {
  it('updates planning and docs surface specs to include the new reference route', () => {
    assert.match(PLANNING_SPEC, /\/docs\/protocol-reference/);
    assert.match(DOCS_SURFACE_SPEC, /\/docs\/protocol-reference/);
  });

  it('surfaces the new reference page in both READMEs', () => {
    assert.match(ROOT_README, /https:\/\/agentxchain\.dev\/docs\/protocol-reference\/?/);
    assert.match(CLI_README, /https:\/\/agentxchain\.dev\/docs\/protocol-reference\/?/);
  });
});
