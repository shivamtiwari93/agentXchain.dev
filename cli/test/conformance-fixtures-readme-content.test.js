import { strict as assert } from 'node:assert';
import { describe, it } from 'vitest';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..', '..');

const read = (rel) => readFileSync(join(REPO_ROOT, rel), 'utf8');

const README_PATH = '.agentxchain-conformance/fixtures/README.md';
const README = read(README_PATH);
const SPEC = read('.planning/CONFORMANCE_FIXTURES_README_SPEC.md');
const FIXTURE_ROOT = join(REPO_ROOT, '.agentxchain-conformance', 'fixtures');

const SURFACE_LABELS = {
  state_machine: 'State Machine',
  turn_result_validation: 'Turn Result Validation',
  gate_semantics: 'Gate Semantics',
  decision_ledger: 'Decision Ledger',
  history: 'History',
  config_schema: 'Config Schema',
  delegation: 'Delegation',
  decision_carryover: 'Decision Carryover',
  parallel_turns: 'Parallel Turns',
  event_lifecycle: 'Event Lifecycle',
  dispatch_manifest: 'Dispatch Manifest',
  hook_audit: 'Hook Audit',
  coordinator: 'Coordinator',
};

function walkFixtures(dir, callback) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      walkFixtures(fullPath, callback);
    } else if (entry.isFile() && entry.name.endsWith('.json')) {
      callback(JSON.parse(readFileSync(fullPath, 'utf8')));
    }
  }
}

function collectFixtureFacts() {
  const operations = new Set();
  const setupKeys = new Set();
  const assertKinds = new Set();
  const assertLiterals = new Set();
  const byTier = new Map();
  let total = 0;

  function visitExpected(node) {
    if (Array.isArray(node)) {
      node.forEach(visitExpected);
      return;
    }
    if (!node || typeof node !== 'object') {
      return;
    }
    if (typeof node.assert === 'string') {
      assertKinds.add(node.assert);
      assertLiterals.add(JSON.stringify(node));
    }
    for (const value of Object.values(node)) {
      visitExpected(value);
    }
  }

  walkFixtures(FIXTURE_ROOT, (fixture) => {
    total += 1;
    operations.add(fixture.input.operation);
    for (const key of Object.keys(fixture.setup || {})) {
      setupKeys.add(key);
    }
    visitExpected(fixture.expected);

    const tier = byTier.get(fixture.tier) || { count: 0, surfaces: new Map() };
    tier.count += 1;
    tier.surfaces.set(fixture.surface, (tier.surfaces.get(fixture.surface) || 0) + 1);
    byTier.set(fixture.tier, tier);
  });

  return { operations, setupKeys, assertKinds, assertLiterals, byTier, total };
}

function extractSection(doc, heading) {
  const escaped = heading.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = doc.match(new RegExp(`## ${escaped}\\n\\n([\\s\\S]*?)(?=\\n## |$)`));
  assert.ok(match, `Missing section "${heading}"`);
  return match[1];
}

describe('Conformance fixtures README contract', () => {
  const facts = collectFixtureFacts();

  it('ships the README and its planning spec', () => {
    assert.ok(existsSync(join(REPO_ROOT, README_PATH)), 'fixtures README must exist');
    assert.match(SPEC, /Conformance Fixtures README Spec/);
    assert.match(SPEC, /\.agentxchain-conformance\/fixtures\/README\.md/);
  });

  it('identifies the shipped corpus as protocol v7, not v2.2', () => {
    assert.match(README, /protocol v7 conformance corpus/i);
    assert.doesNotMatch(README, /holds the v2\.2 protocol conformance corpus/i);
  });

  it('documents the exact fixture-layer operation inventory', () => {
    const section = extractSection(README, 'Fixture-Layer Operations');
    const documented = new Set(
      [...section.matchAll(/- `([^`]+)`/g)].map((match) => match[1])
    );
    assert.deepEqual(documented, facts.operations);
  });

  it('documents the exact setup helper inventory', () => {
    const section = extractSection(README, 'Setup Helpers');
    const documented = new Set(
      [...section.matchAll(/`setup\.([a-z_]+)`/g)].map((match) => match[1])
    );
    assert.deepEqual(documented, facts.setupKeys);
  });

  it('documents the current matcher vocabulary used in expected assertions', () => {
    const section = extractSection(README, 'Assertion Objects');
    const documentedKinds = new Set(
      [...section.matchAll(/"assert": "([^"]+)"/g)].map((match) => match[1])
    );
    assert.deepEqual(documentedKinds, facts.assertKinds);
    assert.match(section, /"value": "run_"/);
    assert.match(section, /"value": "proj_"/);
    assert.match(section, /unordered_array/i);
  });

  it('documents exact tier totals and per-surface counts', () => {
    assert.match(README, new RegExp(`Tier 1 .*\\(${facts.byTier.get(1).count} fixtures\\)`));
    assert.match(README, new RegExp(`Tier 2 .*\\(${facts.byTier.get(2).count} fixtures\\)`));
    assert.match(README, new RegExp(`Tier 3 .*\\(${facts.byTier.get(3).count} fixtures\\)`));
    assert.match(README, new RegExp(`Total shipped corpus: \\*\\*${facts.total} fixtures\\*\\*\\.`));

    for (const [tierNumber, tier] of facts.byTier.entries()) {
      for (const [surface, count] of tier.surfaces.entries()) {
        const label = SURFACE_LABELS[surface];
        assert.ok(label, `Missing label mapping for ${surface}`);
        const rowPattern = new RegExp(`\\| ${label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} \\| ${count} \\|`);
        assert.match(README, rowPattern, `README must include count row for ${surface} in tier ${tierNumber}`);
      }
    }
  });

  it('keeps Tier 3 coordinator scope honest', () => {
    for (const term of [
      'all_repos_accepted',
      'interface_alignment',
      'decision_ids_by_repo',
      'named_decisions',
      'shared_human_gate',
      'ordered_repo_sequence',
      'cross-repo write isolation',
    ]) {
      assert.match(README, new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), `README must mention ${term}`);
    }
  });
});
