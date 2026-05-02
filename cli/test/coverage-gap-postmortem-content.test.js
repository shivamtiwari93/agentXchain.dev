import { describe, it } from 'vitest';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..', '..');
const read = (rel) => readFileSync(resolve(ROOT, rel), 'utf8');

describe('BUG 31-33 coverage postmortem contract', () => {
  it('preserves the startup-path matrix across every dispatch-capable entrypoint', () => {
    const doc = read('.planning/BUG_31_33_COVERAGE_GAP_POSTMORTEM.md');

    assert.match(doc, /## Startup Path Coverage Matrix/);
    assert.match(doc, /`run` \(new run initialization\)/);
    assert.match(doc, /`run --continue-from \.\.\. --continuous`/);
    assert.match(doc, /Schedule-owned continuous session startup/);
    assert.match(doc, /`resume`/);
    assert.match(doc, /`step --resume`/);
    assert.match(doc, /`restart`/);
    assert.match(doc, /Any new startup path.*must add one row to this matrix/s);
  });

  it('preserves the role, write_authority, and runtime matrix required by BUG-46', () => {
    const doc = read('.planning/BUG_31_33_COVERAGE_GAP_POSTMORTEM.md');

    assert.match(doc, /## Role × Authority × Runtime Matrix/);
    assert.match(doc, /role charter/);
    assert.match(doc, /`write_authority`/);
    assert.match(doc, /runtime type/);
    assert.match(doc, /\*\*QA with code-writing authority\*\*/);
    assert.match(doc, /\*\*`authoritative`\*\*/);
    assert.match(doc, /\*\*`local_cli`\*\*/);
    assert.match(doc, /bug-46-post-acceptance-deadlock\.test\.js/);
    assert.match(doc, /Arbitrary role with code-writing authority/);
    assert.match(doc, /Proposed patch author/);
    assert.match(doc, /the tester-sequence suite must name that tuple directly/i);
  });

  it('preserves retained-turn reconciliation as a first-class lifecycle dimension', () => {
    const doc = read('.planning/BUG_31_33_COVERAGE_GAP_POSTMORTEM.md');

    assert.match(doc, /## Dispatch Path × Lifecycle Matrix/);
    assert.match(doc, /\| Dispatch path \| Initial dispatch \| Retry dispatch \| Cross-run \/ restart \/ resume migration \| Acceptance guard \| Phase-boundary behavior \| Retained-turn reconciliation \|/);
    assert.match(doc, /bug-45-retained-turn-stale-intent-coverage\.test\.js/);
    assert.match(doc, /intent completed between dispatch and acceptance/i);
    assert.match(doc, /intent contract changed between dispatch and acceptance/i);
    assert.match(doc, /intent retired by phase advance between dispatch and acceptance/i);
    assert.match(doc, /New dispatch paths or recovery commands must add an explicit row and command-level proof/i);
  });

  it('preserves the BUG-52 gate-resolution matrix across unblock and pre-dispatch reconcile paths', () => {
    const doc = read('.planning/BUG_31_33_COVERAGE_GAP_POSTMORTEM.md');

    assert.match(doc, /## BUG-52 Gate Resolution × Phase-Advance Matrix/);
    assert.match(doc, /`planning_signoff` -> `implementation`/);
    assert.match(doc, /`unblock <hesc_\*>`/);
    assert.match(doc, /`resume` \/ `step --resume`/);
    assert.match(doc, /`reconcilePhaseAdvanceBeforeDispatch\(\)`/);
    assert.match(doc, /`trigger: "reconciled_before_dispatch"`/);
    assert.match(doc, /`qa_ship_verdict` -> `launch`/);
    assert.doesNotMatch(doc, /still lacks a dedicated beta-tester scenario/i);
    assert.match(doc, /BUG-52 happened[\s\S]*?pre-dispatch reconciliation were not owned as separate\s+proof rows/i);
  });

  it('preserves the BUG-53 continuation matrix across CLI, schedule-owned, and packaged proof modes', () => {
    const doc = read('.planning/BUG_31_33_COVERAGE_GAP_POSTMORTEM.md');

    assert.match(doc, /## BUG-53 Session Continuation × Completion Mode Matrix/);
    assert.match(doc, /CLI-owned `run --continuous` with remaining vision candidates/);
    assert.match(doc, /CLI-owned `run --continuous` with no remaining vision candidates/);
    assert.match(doc, /Schedule-owned continuous session \(`schedule daemon`\)/);
    assert.match(doc, /Packaged tarball release boundary/);
    assert.match(doc, /`session_continuation`/);
    assert.match(doc, /`idle_exit` \/ `completed`/);
    assert.match(doc, /BUG-53 lived in the[\s\S]*?"the run finished"[\s\S]*?"the session truthfully kept going\."/i);
  });
});
