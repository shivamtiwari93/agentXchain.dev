import { describe, it } from 'vitest';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..', '..');
const RESULTS_PATH = join(REPO_ROOT, '.planning', 'MODEL_COMPATIBILITY_RESULTS.json');
const SPEC_PATH = join(REPO_ROOT, '.planning', 'MODEL_COMPATIBILITY_MATRIX_SPEC.md');
const PROBE_SCRIPT = join(REPO_ROOT, 'cli', 'scripts', 'model-compatibility-probe.mjs');

describe('Model Compatibility Matrix — contract guard', () => {
  it('AT-MCM-GUARD-001: spec exists', () => {
    assert.ok(existsSync(SPEC_PATH), 'MODEL_COMPATIBILITY_MATRIX_SPEC.md must exist');
    const spec = readFileSync(SPEC_PATH, 'utf8');
    assert.ok(spec.includes('api_proxy'), 'spec must mention api_proxy');
    assert.ok(spec.includes('proposed'), 'spec must mention proposed write authority');
    assert.ok(spec.includes('reliable'), 'spec must define reliable classification');
    assert.ok(spec.includes('inconsistent'), 'spec must define inconsistent classification');
    assert.ok(spec.includes('unsupported'), 'spec must define unsupported classification');
  });

  it('AT-MCM-GUARD-002: probe script exists and is executable', () => {
    assert.ok(existsSync(PROBE_SCRIPT), 'model-compatibility-probe.mjs must exist');
    const script = readFileSync(PROBE_SCRIPT, 'utf8');
    assert.ok(script.includes('extractTurnResult'), 'probe must use extraction logic');
    assert.ok(script.includes('proposed_changes'), 'probe must validate proposed_changes');
    assert.ok(script.includes('classification'), 'probe must classify results');
    assert.ok(script.includes('MODEL_COMPATIBILITY_RESULTS.json'), 'probe must write results to .planning/');
  });

  it('AT-MCM-GUARD-003: results file exists and has valid structure', () => {
    assert.ok(existsSync(RESULTS_PATH), 'MODEL_COMPATIBILITY_RESULTS.json must exist');
    const results = JSON.parse(readFileSync(RESULTS_PATH, 'utf8'));
    assert.equal(results.probe_version, '1.0');
    assert.equal(results.write_authority, 'proposed');
    assert.ok(Array.isArray(results.models), 'models must be an array');
    assert.ok(results.models.length >= 2, 'must have at least 2 model results');
    assert.ok(typeof results.timestamp === 'string', 'must have timestamp');
    assert.ok(typeof results.total_cost_usd === 'number', 'must have total_cost_usd');
  });

  it('AT-MCM-GUARD-004: each model result has required fields', () => {
    const results = JSON.parse(readFileSync(RESULTS_PATH, 'utf8'));
    for (const m of results.models) {
      assert.ok(typeof m.model === 'string', `model id must be string: ${JSON.stringify(m)}`);
      assert.ok(typeof m.extraction_success === 'boolean', `extraction_success must be boolean for ${m.model}`);
      assert.ok(typeof m.schema_valid === 'boolean', `schema_valid must be boolean for ${m.model}`);
      assert.ok(typeof m.proposed_changes_present === 'boolean', `proposed_changes_present must be boolean for ${m.model}`);
      assert.ok(typeof m.proposed_changes_well_formed === 'boolean', `proposed_changes_well_formed must be boolean for ${m.model}`);
      assert.ok(typeof m.latency_ms === 'number', `latency_ms must be number for ${m.model}`);
      assert.ok(typeof m.cost_usd === 'number', `cost_usd must be number for ${m.model}`);
      assert.ok(['reliable', 'inconsistent', 'unsupported'].includes(m.classification), `classification must be valid for ${m.model}`);
    }
  });

  it('AT-MCM-GUARD-005: Anthropic Haiku result exists', () => {
    const results = JSON.parse(readFileSync(RESULTS_PATH, 'utf8'));
    const haiku = results.models.find(m => m.model.includes('haiku'));
    assert.ok(haiku, 'Haiku result must be present');
  });

  it('AT-MCM-GUARD-006: Anthropic Sonnet result exists', () => {
    const results = JSON.parse(readFileSync(RESULTS_PATH, 'utf8'));
    const sonnet = results.models.find(m => m.model.includes('sonnet'));
    assert.ok(sonnet, 'Sonnet result must be present');
  });
});
