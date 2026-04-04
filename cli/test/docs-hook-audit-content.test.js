import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..', '..');

const hookRunnerPath = join(root, 'cli', 'src', 'lib', 'hook-runner.js');
const guidePath = join(root, 'website-v2', 'docs', 'protocol-implementor-guide.mdx');

const hookRunnerSrc = readFileSync(hookRunnerPath, 'utf8');
const guideSrc = readFileSync(guidePath, 'utf8');

/**
 * Extract all orchestrator_action string values from hook-runner.js.
 * Covers both forms:
 *   orchestratorAction = 'value'
 *   orchestrator_action: 'value'
 */
function extractOrchestratorActions() {
  const actions = new Set();
  // camelCase assignment: orchestratorAction = 'value' or ternary
  const assignRe = /orchestratorAction\s*=\s*(?:hookDef\.mode\s*===\s*'blocking'\s*\?\s*)?'([^']+)'/g;
  let m;
  while ((m = assignRe.exec(hookRunnerSrc)) !== null) {
    actions.add(m[1]);
  }
  // ternary second branch: : 'value'
  const ternaryRe = /orchestratorAction\s*=\s*hookDef\.mode\s*===\s*'blocking'\s*\?\s*'[^']+'\s*:\s*'([^']+)'/g;
  while ((m = ternaryRe.exec(hookRunnerSrc)) !== null) {
    actions.add(m[1]);
  }
  // object literal: orchestrator_action: 'value'
  const literalRe = /orchestrator_action:\s*'([^']+)'/g;
  while ((m = literalRe.exec(hookRunnerSrc)) !== null) {
    actions.add(m[1]);
  }
  return actions;
}

const implementationActions = extractOrchestratorActions();

describe('hook_audit docs contract — protocol-implementor-guide.mdx', () => {
  describe('page structure', () => {
    it('has a hook_audit subsection', () => {
      assert.ok(guideSrc.includes('### `hook_audit`'), 'Missing ### `hook_audit` heading');
    });

    it('documents hook_ok field', () => {
      assert.ok(guideSrc.includes('hook_ok'), 'Missing hook_ok documentation');
    });

    it('documents blocked field', () => {
      assert.ok(guideSrc.includes('**`blocked`**'), 'Missing blocked field documentation');
    });

    it('documents audit_entries field', () => {
      assert.ok(guideSrc.includes('audit_entries'), 'Missing audit_entries documentation');
    });

    it('documents orchestrator_action field', () => {
      assert.ok(guideSrc.includes('orchestrator_action'), 'Missing orchestrator_action documentation');
    });
  });

  describe('hook_ok semantics', () => {
    it('states pipeline-proceed semantics, not hook-success', () => {
      assert.ok(
        guideSrc.includes('can the governed pipeline proceed'),
        'hook_ok docs must state "pipeline can proceed" semantics'
      );
    });

    it('documents that advisory failures return hook_ok true', () => {
      assert.ok(
        guideSrc.includes('Advisory hooks that fail'),
        'Must document that advisory failures still have hook_ok: true'
      );
    });

    it('documents tamper as a different halt mechanism from blocked', () => {
      assert.ok(
        guideSrc.includes('Tamper detection sets `hook_ok: false` but `blocked: false`'),
        'Must document tamper vs blocked distinction'
      );
    });

    it('recommends orchestrator_action for disambiguation', () => {
      assert.ok(
        guideSrc.includes('disambiguation signal'),
        'Must recommend orchestrator_action as the disambiguation signal'
      );
    });
  });

  describe('orchestrator_action completeness', () => {
    it('implementation has expected number of actions', () => {
      // Sanity check: we know there are 12 distinct values (13 with mode splits counted once)
      assert.ok(
        implementationActions.size >= 12,
        `Expected at least 12 orchestrator_action values in hook-runner.js, found ${implementationActions.size}: ${[...implementationActions].join(', ')}`
      );
    });

    for (const action of implementationActions) {
      it(`documents orchestrator_action: ${action}`, () => {
        assert.ok(
          guideSrc.includes(action),
          `orchestrator_action "${action}" from hook-runner.js is not documented in the implementor guide`
        );
      });
    }
  });

  describe('hook_ok × blocked truth table', () => {
    // Verify the truth table in docs matches implementation behavior
    const truthTable = [
      { action: 'continued', hook_ok: 'true', blocked: 'false' },
      { action: 'warned', hook_ok: 'true', blocked: 'false' },
      { action: 'downgraded_block_to_warn', hook_ok: 'true', blocked: 'false' },
      { action: 'warned_failure', hook_ok: 'true', blocked: 'false' },
      { action: 'warned_timeout', hook_ok: 'true', blocked: 'false' },
      { action: 'warned_invalid_output', hook_ok: 'true', blocked: 'false' },
      { action: 'blocked', hook_ok: 'false', blocked: 'true' },
      { action: 'blocked_failure', hook_ok: 'false', blocked: 'true' },
      { action: 'blocked_timeout', hook_ok: 'false', blocked: 'true' },
      { action: 'blocked_invalid_output', hook_ok: 'false', blocked: 'true' },
      { action: 'aborted_tamper', hook_ok: 'false', blocked: 'false' },
    ];

    for (const { action, hook_ok, blocked } of truthTable) {
      it(`${action} shows hook_ok=${hook_ok}, blocked=${blocked} in truth table`, () => {
        // Find the row in the markdown table: | `action` | `hook_ok` | `blocked` |
        const rowRe = new RegExp(
          `\\|\\s*\`${action}\`\\s*\\|\\s*\`${hook_ok}\`\\s*\\|\\s*\`${blocked}\`\\s*\\|`
        );
        assert.ok(
          rowRe.test(guideSrc),
          `Truth table row for ${action} must show hook_ok=${hook_ok}, blocked=${blocked}`
        );
      });
    }
  });

  describe('response shape contract', () => {
    it('documents the run_hooks response JSON shape', () => {
      assert.ok(
        guideSrc.includes('"result": "success"') && guideSrc.includes('"hook_ok"'),
        'Must show the run_hooks response shape with result and hook_ok fields'
      );
    });

    it('documents skipped entry characteristics', () => {
      assert.ok(
        guideSrc.includes('verdict: null') && guideSrc.includes('duration_ms: 0'),
        'Must document skipped entry field values'
      );
    });
  });
});
