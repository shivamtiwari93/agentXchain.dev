import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  compressContextSections,
  COMPRESSION_STEPS,
} from '../src/lib/context-compressor.js';
import { parseContextSections } from '../src/lib/context-section-parser.js';

/**
 * Build a full CONTEXT.md string with the current section set.
 */
function makeFullContextMd() {
  return [
    '# Execution Context',
    '',
    '## Current State',
    '',
    '- **Run:** run_123',
    '- **Status:** active',
    '- **Phase:** qa',
    '- **Integration ref:** git:abc123',
    '- **Budget spent:** $12.34',
    '- **Budget remaining:** $37.66',
    '',
    '## Project Goal',
    '',
    'Ship a governed release pipeline without silent context loss.',
    '',
    '## Inherited Run Context',
    '',
    '- **Parent run:** run_100',
    '- **Parent status:** completed',
    '',
    '## Last Accepted Turn',
    '',
    '- **Turn:** turn_456',
    '- **Role:** pm',
    '- **Summary:** Defined MVP scope and froze the release gate with a long description that exceeds the truncation threshold when we need to compress it down to fit within the context window budget. This additional text ensures the summary is well over two hundred and forty characters so the compressor actually triggers the truncation step before dropping the section entirely.',
    '- **Decisions:**',
    '  - DEC-001: Freeze the API surface.',
    '  - DEC-002: Defer plugin hooks to post-v1.',
    '- **Objections:**',
    '  - OBJ-001 (medium): Retry policy needs operator messaging.',
    '',
    '## Decision History',
    '',
    '| ID | Phase | Role | Statement |',
    '|----|-------|------|-----------|',
    '| DEC-001 | planning | pm | Use PostgreSQL for persistence |',
    '| DEC-002 | planning | architect | REST over GraphQL for v1 API |',
    '',
    '## Blockers',
    '',
    '- **Blocked on:** escalation:retries-exhausted:qa',
    '',
    '## Escalation',
    '',
    '- **From:** qa',
    '- **Reason:** retries_exhausted',
    '',
    '## Workflow Artifacts',
    '',
    '| Artifact | Required | Semantics | Owner | Status |',
    '|----------|----------|-----------|-------|--------|',
    '| `.planning/spec.md` | yes | `design_spec` | architect | exists |',
    '| `.planning/test-plan.md` | yes | `test_plan` | qa | MISSING |',
    '',
    '## Gate Required Files',
    '',
    '- `.planning/ship-verdict.md` — exists',
    '- `.planning/acceptance-matrix.md` — MISSING',
    '',
    '## Phase Gate Status',
    '',
    '- `qa_ship_verdict`: pending',
    '',
    '',
  ].join('\n');
}

function getAction(result, id) {
  return result.actions.find((a) => a.id === id);
}

describe('context-compressor', () => {
  it('returns all sections as kept when context already fits', () => {
    const sections = parseContextSections(makeFullContextMd());
    const result = compressContextSections(sections, () => true);

    assert.equal(result.exhausted, false);
    assert.equal(result.steps_applied, 0);
    for (const action of result.actions) {
      assert.equal(action.action, 'kept', `${action.id} should be kept`);
    }
    assert.equal(result.sections.length, sections.length);
  });

  it('drops budget first when one compression step is needed', () => {
    const sections = parseContextSections(makeFullContextMd());
    let calls = 0;
    const result = compressContextSections(sections, () => {
      calls += 1;
      // Fit after first compression step (drop budget)
      return calls > 1;
    });

    assert.equal(result.exhausted, false);
    assert.equal(result.steps_applied, 1);
    assert.equal(getAction(result, 'budget').action, 'dropped');
    assert.equal(getAction(result, 'current_state').action, 'kept');
    assert.equal(getAction(result, 'phase_gate_status').action, 'kept');
    assert.ok(!result.sections.find((s) => s.id === 'budget'));
  });

  it('follows the exact compression order from the spec', () => {
    const sections = parseContextSections(makeFullContextMd());
    const droppedOrder = [];

    const result = compressContextSections(sections, () => false);

    // Should have exhausted all steps
    assert.equal(result.exhausted, true);

    // Verify the non-kept actions follow spec order
    const expectedDropped = ['budget', 'phase_gate_status', 'decision_history', 'workflow_artifacts', 'gate_required_files', 'last_turn_objections', 'last_turn_decisions', 'last_turn_summary'];
    for (const id of expectedDropped) {
      const action = getAction(result, id);
      assert.ok(action, `action for ${id} should exist`);
      assert.ok(
        action.action === 'dropped' || action.action === 'truncated',
        `${id} should be dropped or truncated, got ${action.action}`
      );
    }
  });

  it('drops phase_gate_status second, decision_history third, workflow_artifacts fourth, gate_required_files fifth', () => {
    const sections = parseContextSections(makeFullContextMd());
    let calls = 0;
    const result = compressContextSections(sections, () => {
      calls += 1;
      // Fit after 5 steps: drop budget, phase_gate_status, decision_history, workflow_artifacts, gate_required_files
      return calls > 5;
    });

    assert.equal(result.exhausted, false);
    assert.equal(result.steps_applied, 5);
    assert.equal(getAction(result, 'budget').action, 'dropped');
    assert.equal(getAction(result, 'phase_gate_status').action, 'dropped');
    assert.equal(getAction(result, 'decision_history').action, 'dropped');
    assert.equal(getAction(result, 'workflow_artifacts').action, 'dropped');
    assert.equal(getAction(result, 'gate_required_files').action, 'dropped');
    assert.equal(getAction(result, 'last_turn_objections').action, 'kept');
  });

  it('truncates last_turn_summary to 240 chars before dropping it', () => {
    const sections = parseContextSections(makeFullContextMd());
    let calls = 0;
    const result = compressContextSections(sections, () => {
      calls += 1;
      // Fit after 8 steps (budget, phase_gate, decision_history, workflow_artifacts, gate_req, objections, decisions, truncate summary)
      return calls > 8;
    });

    assert.equal(result.exhausted, false);
    assert.equal(getAction(result, 'last_turn_summary').action, 'truncated');
    const summarySection = result.sections.find((s) => s.id === 'last_turn_summary');
    assert.ok(summarySection, 'summary section should still be present when truncated');
    assert.ok(summarySection.content.length <= 240, `truncated summary should be <= 240 chars, got ${summarySection.content.length}`);
  });

  it('drops last_turn_summary entirely as the final step', () => {
    const sections = parseContextSections(makeFullContextMd());
    let calls = 0;
    const result = compressContextSections(sections, () => {
      calls += 1;
      // Fit after 9 steps (all compression steps including dropping summary)
      return calls > 9;
    });

    assert.equal(result.exhausted, false);
    assert.equal(getAction(result, 'last_turn_summary').action, 'dropped');
    assert.ok(!result.sections.find((s) => s.id === 'last_turn_summary'));
  });

  it('never drops sticky/required sections', () => {
    const sections = parseContextSections(makeFullContextMd());
    const result = compressContextSections(sections, () => false);

    assert.equal(result.exhausted, true);

    // Sticky sections must survive all compression
    const stickyIds = [
      'current_state',
      'project_goal',
      'inherited_run_context',
      'last_turn_header',
      'blockers',
      'escalation',
    ];
    for (const id of stickyIds) {
      const action = getAction(result, id);
      assert.ok(action, `${id} should have an action entry`);
      assert.equal(action.action, 'kept', `sticky section ${id} must remain kept`);
      assert.equal(action.required, true, `${id} should be marked required`);
      assert.ok(result.sections.find((s) => s.id === id), `${id} should still be in sections`);
    }
  });

  it('does not mutate the original sections array', () => {
    const sections = parseContextSections(makeFullContextMd());
    const originalIds = sections.map((s) => s.id);
    const originalContents = sections.map((s) => s.content);

    compressContextSections(sections, () => false);

    assert.deepEqual(sections.map((s) => s.id), originalIds);
    assert.deepEqual(sections.map((s) => s.content), originalContents);
  });

  it('skips missing sections without counting as applied steps', () => {
    // Context with only current_state — no budget, no last turn, no gates
    const minimalMd = [
      '# Execution Context',
      '',
      '## Current State',
      '',
      '- **Run:** run_123',
      '- **Status:** active',
      '- **Phase:** planning',
      '- **Integration ref:** none',
      '',
      '',
    ].join('\n');

    const sections = parseContextSections(minimalMd);
    const result = compressContextSections(sections, () => false);

    assert.equal(result.exhausted, true);
    assert.equal(result.steps_applied, 0);
    assert.equal(result.actions.length, 1);
    assert.equal(getAction(result, 'current_state').action, 'kept');
  });

  it('produces valid renderable markdown after compression', () => {
    const sections = parseContextSections(makeFullContextMd());
    const result = compressContextSections(sections, () => false);

    // The effective context should be parseable back into sections
    const reparsed = parseContextSections(result.effective_context);
    const reparsedIds = reparsed.map((s) => s.id);

    // Only sticky sections should remain
    assert.ok(reparsedIds.includes('current_state'));
    assert.ok(reparsedIds.includes('project_goal'));
    assert.ok(reparsedIds.includes('inherited_run_context'));
    assert.ok(reparsedIds.includes('last_turn_header'));
    assert.ok(reparsedIds.includes('blockers'));
    assert.ok(reparsedIds.includes('escalation'));
    assert.ok(!reparsedIds.includes('budget'));
    assert.ok(!reparsedIds.includes('decision_history'));
    assert.ok(!reparsedIds.includes('workflow_artifacts'));
    assert.ok(!reparsedIds.includes('phase_gate_status'));
  });

  it('exports COMPRESSION_STEPS matching the spec order', () => {
    assert.equal(COMPRESSION_STEPS.length, 9);
    assert.deepEqual(COMPRESSION_STEPS[0], { id: 'budget', action: 'drop' });
    assert.deepEqual(COMPRESSION_STEPS[1], { id: 'phase_gate_status', action: 'drop' });
    assert.deepEqual(COMPRESSION_STEPS[2], { id: 'decision_history', action: 'drop' });
    assert.deepEqual(COMPRESSION_STEPS[3], { id: 'workflow_artifacts', action: 'drop' });
    assert.deepEqual(COMPRESSION_STEPS[4], { id: 'gate_required_files', action: 'drop' });
    assert.deepEqual(COMPRESSION_STEPS[5], { id: 'last_turn_objections', action: 'drop' });
    assert.deepEqual(COMPRESSION_STEPS[6], { id: 'last_turn_decisions', action: 'drop' });
    assert.deepEqual(COMPRESSION_STEPS[7], { id: 'last_turn_summary', action: 'truncate', max_chars: 240 });
    assert.deepEqual(COMPRESSION_STEPS[8], { id: 'last_turn_summary', action: 'drop' });
  });
});
