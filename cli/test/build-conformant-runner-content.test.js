import { strict as assert } from 'node:assert';
import { describe, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..', '..');

const read = (rel) => readFileSync(join(REPO_ROOT, rel), 'utf8');

const PAGE_PATH = 'website-v2/docs/build-conformant-runner.mdx';
const PAGE = read(PAGE_PATH);
const SIDEBARS = read('website-v2/sidebars.ts');
const DOCS_SURFACE_SPEC = read('.planning/DOCS_SURFACE_SPEC.md');
const SPEC = read('.planning/BUILD_CONFORMANT_RUNNER_TUTORIAL_SPEC.md');

describe('Build a conformant runner tutorial', () => {
  it('AT-BCR-001: ships the page, sidebar entry, docs surface declaration, and spec', () => {
    assert.ok(existsSync(join(REPO_ROOT, PAGE_PATH)), 'tutorial page must exist');
    assert.ok(
      existsSync(join(REPO_ROOT, '.planning/BUILD_CONFORMANT_RUNNER_TUTORIAL_SPEC.md')),
      'tutorial spec must exist',
    );
    assert.match(SIDEBARS, /'build-conformant-runner'/);
    assert.match(DOCS_SURFACE_SPEC, /\/docs\/build-conformant-runner/);
    assert.match(SPEC, /\/docs\/build-conformant-runner/);
  });

  it('AT-BCR-002: distinguishes library-backed runners from independent protocol implementations', () => {
    assert.match(PAGE, /agentxchain\/runner-interface/);
    assert.match(PAGE, /independent runner/i);
    assert.match(PAGE, /non-reference AgentXchain runner/i);
    assert.match(PAGE, /protocol behavior/i);
    assert.match(PAGE, /Protocol Implementor Guide/);
  });

  it('AT-BCR-003: documents the minimum viable protocol surface', () => {
    for (const term of [
      'governed state changes',
      'every turn is assigned',
      'staged turn results are validated',
      'acceptance writes history',
      'phase transitions',
      'run completion',
      'blocked runs recover',
      'event order',
      'decision evidence',
    ]) {
      assert.match(PAGE, new RegExp(term, 'i'), `page must document ${term}`);
    }
  });

  it('AT-BCR-004: includes concrete examples for protocol implementation steps', () => {
    for (const symbol of [
      'const state =',
      'function assignTurn',
      'function validateTurnResult',
      'function acceptTurn',
      'function approvePhaseGate',
      'function blockRun',
      'function resolveBlocker',
      'function appendEvent',
      'executeFixture',
      'stdio-fixture-v1',
    ]) {
      assert.ok(PAGE.includes(symbol), `page must include ${symbol}`);
    }
  });

  it('AT-BCR-005: maps tutorial work to conformance surfaces and fixture tiers', () => {
    for (const surface of [
      'state_machine',
      'turn_result_validation',
      'gate_semantics',
      'decision_ledger',
      'history',
      'config_schema',
      'event_lifecycle',
    ]) {
      assert.ok(PAGE.includes(surface), `page must mention ${surface}`);
    }

    assert.match(PAGE, /agentxchain conformance check --tier 1 --target \./);
    assert.match(PAGE, /Tier 1/);
    assert.match(PAGE, /Tier 2/);
    assert.match(PAGE, /Tier 3/);
  });

  it('AT-BCR-006: warns against false-conformance traps and status collapse', () => {
    for (const term of [
      'accepting a result whose `turn_id` is no longer active',
      'without a gate approval',
      'mutating history',
      'needs_human',
      'ordered lifecycle events',
      'returning `pass`',
      'fail',
      'error',
      'not_implemented',
    ]) {
      assert.match(PAGE, new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'));
    }
  });
});
