import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..', '..');

const SPEC_PATH = '.planning/PROTOCOL_V7_SPEC.md';
const SPEC = readFileSync(join(REPO_ROOT, SPEC_PATH), 'utf8');
const ROOT_PROTOCOL = readFileSync(join(REPO_ROOT, 'PROTOCOL-v7.md'), 'utf8');

const readFixture = (...parts) =>
  JSON.parse(readFileSync(join(REPO_ROOT, '.agentxchain-conformance', 'fixtures', ...parts), 'utf8'));

const countJsonFiles = (...parts) =>
  readdirSync(join(REPO_ROOT, '.agentxchain-conformance', 'fixtures', ...parts)).filter((entry) =>
    entry.endsWith('.json'),
  ).length;

describe('Protocol v7 delta spec', () => {
  it('ships the durable planning spec with the required sections', () => {
    assert.ok(existsSync(join(REPO_ROOT, SPEC_PATH)), 'PROTOCOL_V7_SPEC.md must exist');
    for (const heading of ['## Purpose', '## Interface', '## Behavior', '## Error Cases', '## Acceptance Tests']) {
      assert.match(SPEC, new RegExp(heading.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    }
  });

  it('keeps the fixture-count summary aligned to the shipped corpus', () => {
    const newSurfaceCount =
      countJsonFiles('1', 'delegation') +
      countJsonFiles('1', 'decision_carryover') +
      countJsonFiles('1', 'parallel_turns') +
      countJsonFiles('1', 'event_lifecycle');
    const totalCount =
      newSurfaceCount +
      countJsonFiles('1', 'state_machine') +
      countJsonFiles('1', 'turn_result_validation') +
      countJsonFiles('1', 'gate_semantics') +
      countJsonFiles('1', 'decision_ledger') +
      countJsonFiles('1', 'history') +
      countJsonFiles('1', 'config_schema') +
      countJsonFiles('2', 'dispatch_manifest') +
      countJsonFiles('2', 'hook_audit') +
      countJsonFiles('3', 'coordinator');

    assert.equal(newSurfaceCount, 27, 'v7 additions should contribute 27 fixtures');
    assert.equal(totalCount, 108, 'shipped conformance corpus should contain 108 fixtures');
    assert.match(SPEC, /81 to 108/);
    assert.match(SPEC, /27 new fixtures/);
  });

  it('describes the tricky decision, parallel, and event fixtures from the actual corpus', () => {
    for (const [surface, fixtureId] of [
      ['decision_carryover', 'DC-003'],
      ['decision_carryover', 'DC-004'],
      ['decision_carryover', 'DC-005'],
      ['parallel_turns', 'PT-002'],
      ['parallel_turns', 'PT-003'],
      ['parallel_turns', 'PT-004'],
      ['parallel_turns', 'PT-005'],
      ['parallel_turns', 'PT-006'],
      ['event_lifecycle', 'EL-005'],
      ['event_lifecycle', 'EL-006'],
      ['event_lifecycle', 'EL-007'],
      ['event_lifecycle', 'EL-008'],
    ]) {
      const fixture = readFixture('1', surface, `${fixtureId}.json`);
      const expectedRow = `${fixtureId} | ${fixture.type} | ${fixture.description}`;
      assert.ok(SPEC.includes(expectedRow), `PROTOCOL_V7_SPEC.md must include "${expectedRow}"`);
    }
  });
});

describe('Protocol v7 root reference', () => {
  it('keeps the versioned reference aligned to the v7 proof surfaces and continuity artifacts', () => {
    for (const term of [
      'delegation',
      'decision_carryover',
      'parallel_turns',
      'event_lifecycle',
      '.agentxchain/events.jsonl',
      '.agentxchain/run-history.jsonl',
      'durability: "run"',
      'durability: "repo"',
      'overrides',
    ]) {
      assert.ok(ROOT_PROTOCOL.includes(term), `PROTOCOL-v7.md must mention ${term}`);
    }
  });
});
