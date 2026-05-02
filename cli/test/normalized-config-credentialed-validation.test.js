import { describe, it } from 'vitest';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import Ajv2020 from 'ajv/dist/2020.js';

import { validateV4Config } from '../src/lib/normalized-config.js';

const ROOT = join(import.meta.dirname, '..');
const SCHEMA_PATH = join(ROOT, 'src', 'lib', 'schemas', 'agentxchain-config.schema.json');
const schema = JSON.parse(readFileSync(SCHEMA_PATH, 'utf8'));
const ajv = new Ajv2020({ strict: false, allErrors: true });
const validateSchema = ajv.compile(schema);

function baseConfig(overrides = {}) {
  return {
    schema_version: '1.0',
    project: { id: 'bug59', name: 'BUG-59 Fixture' },
    roles: {
      pm: { title: 'PM', mandate: 'Plan.', write_authority: 'proposed', runtime: 'manual' },
      qa: { title: 'QA', mandate: 'Verify.', write_authority: 'review_only', runtime: 'manual' },
    },
    runtimes: {
      manual: { type: 'manual' },
    },
    routing: {
      planning: { entry_role: 'pm', allowed_next_roles: ['pm'], exit_gate: 'planning_signoff' },
      qa: { entry_role: 'qa', allowed_next_roles: ['qa'], exit_gate: 'qa_ship_verdict' },
      launch: { entry_role: 'qa', allowed_next_roles: ['qa'] },
    },
    gates: {
      planning_signoff: { requires_human_approval: true, credentialed: false },
      qa_ship_verdict: {
        requires_human_approval: true,
        requires_verification_pass: true,
        credentialed: false,
      },
    },
    approval_policy: {
      phase_transitions: {
        default: 'require_human',
        rules: [
          {
            from_phase: 'planning',
            to_phase: 'qa',
            action: 'auto_approve',
            when: { gate_passed: true, credentialed_gate: false },
          },
        ],
      },
      run_completion: {
        action: 'auto_approve',
        when: { gate_passed: true, all_phases_visited: true, credentialed_gate: false },
      },
    },
    ...overrides,
  };
}

function assertSchemaValid(config) {
  assert.equal(validateSchema(config), true, JSON.stringify(validateSchema.errors, null, 2));
}

function assertSchemaInvalid(config, pattern) {
  assert.equal(validateSchema(config), false, 'schema should reject invalid BUG-59 config');
  assert.match(JSON.stringify(validateSchema.errors), pattern);
}

describe('BUG-59 credentialed gate config validation', () => {
  it('accepts explicit non-credentialed gates and credentialed_gate: false policy guards', () => {
    const config = baseConfig();

    assertSchemaValid(config);
    const result = validateV4Config(config);

    assert.equal(result.ok, true, `Unexpected errors: ${result.errors.join(', ')}`);
  });

  it('rejects non-boolean gate credentialed values in schema and normalized validation', () => {
    const config = baseConfig({
      gates: {
        planning_signoff: { requires_human_approval: true, credentialed: 'yes' },
      },
    });

    assertSchemaInvalid(config, /credentialed/);
    const result = validateV4Config(config);

    assert.equal(result.ok, false);
    assert.ok(result.errors.some((error) => error.includes('gates.planning_signoff.credentialed must be a boolean')));
  });

  it('rejects credentialed_gate: true with the BUG-59 negative-only decision ID', () => {
    const config = baseConfig({
      approval_policy: {
        phase_transitions: {
          rules: [
            {
              from_phase: 'planning',
              to_phase: 'qa',
              action: 'auto_approve',
              when: { credentialed_gate: true },
            },
          ],
        },
      },
    });

    assertSchemaInvalid(config, /credentialed_gate/);
    const result = validateV4Config(config);

    assert.equal(result.ok, false);
    assert.ok(result.errors.some((error) => (
      error.includes('approval_policy.phase_transitions.rules[0].when.credentialed_gate must be false')
      && error.includes('DEC-BUG59-CREDENTIALED-GATE-PREDICATE-NEGATIVE-ONLY-001')
    )));
  });

  it('rejects non-boolean credentialed_gate values in normalized validation', () => {
    const config = baseConfig({
      approval_policy: {
        run_completion: {
          action: 'auto_approve',
          when: { credentialed_gate: 'false' },
        },
      },
    });

    assertSchemaInvalid(config, /credentialed_gate/);
    const result = validateV4Config(config);

    assert.equal(result.ok, false);
    assert.ok(result.errors.some((error) => error.includes('approval_policy.run_completion.when.credentialed_gate must be a boolean')));
  });
});
