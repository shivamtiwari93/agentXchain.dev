import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, chmodSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { randomBytes } from 'crypto';

import {
  runHooks,
  validateHooksConfig,
  resolveExecutable,
  HOOK_AUDIT_PATH,
  HOOK_ANNOTATIONS_PATH,
  VALID_HOOK_PHASES,
  NON_BLOCKING_PHASES,
  parseVerdict,
  validateAnnotations,
  normalizeHookProcessError,
} from '../src/lib/hook-runner.js';

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeTmpDir() {
  const dir = join(tmpdir(), `axc-hook-test-${randomBytes(6).toString('hex')}`);
  mkdirSync(dir, { recursive: true });
  mkdirSync(join(dir, '.agentxchain'), { recursive: true });
  // Create protected files
  writeFileSync(join(dir, '.agentxchain/state.json'), '{"status":"active"}');
  writeFileSync(join(dir, '.agentxchain/history.jsonl'), '');
  writeFileSync(join(dir, '.agentxchain/decision-ledger.jsonl'), '');
  return dir;
}

function readJsonl(dir, relPath) {
  const filePath = join(dir, relPath);
  if (!existsSync(filePath)) return [];
  const content = readFileSync(filePath, 'utf8').trim();
  if (!content) return [];
  return content.split('\n').map(line => JSON.parse(line));
}

function writeHookScript(dir, name, script) {
  const hookDir = join(dir, 'hooks');
  mkdirSync(hookDir, { recursive: true });
  const hookPath = join(hookDir, name);
  writeFileSync(hookPath, script, { mode: 0o755 });
  chmodSync(hookPath, 0o755);
  return hookPath;
}

// ── Config Validation Tests ──────────────────────────────────────────────────

describe('validateHooksConfig', () => {
  it('accepts empty hooks object', () => {
    const result = validateHooksConfig({});
    assert.ok(result.ok);
    assert.equal(result.errors.length, 0);
  });

  it('rejects non-object hooks', () => {
    const result = validateHooksConfig('not an object');
    assert.ok(!result.ok);
    assert.ok(result.errors[0].includes('hooks must be an object'));
  });

  it('rejects unknown phase', () => {
    const result = validateHooksConfig({ unknown_phase: [] });
    assert.ok(!result.ok);
    assert.ok(result.errors[0].includes('unknown phase'));
  });

  it('rejects blocking hook on non-blocking phase (AT-HOOK-009)', () => {
    const result = validateHooksConfig({
      after_acceptance: [{
        name: 'bad-blocker',
        type: 'process',
        command: ['echo', 'hi'],
        timeout_ms: 1000,
        mode: 'blocking',
      }],
    });
    assert.ok(!result.ok);
    assert.ok(result.errors.some(e => e.includes('does not support blocking')));
  });

  it('accepts advisory hook on non-blocking phase', () => {
    const result = validateHooksConfig({
      after_acceptance: [{
        name: 'notifier',
        type: 'process',
        command: ['echo', 'hi'],
        timeout_ms: 1000,
        mode: 'advisory',
      }],
    });
    assert.ok(result.ok);
  });

  it('rejects duplicate hook names within a phase', () => {
    const result = validateHooksConfig({
      before_assignment: [
        { name: 'dupe', type: 'process', command: ['echo'], timeout_ms: 1000, mode: 'blocking' },
        { name: 'dupe', type: 'process', command: ['echo'], timeout_ms: 1000, mode: 'blocking' },
      ],
    });
    assert.ok(!result.ok);
    assert.ok(result.errors.some(e => e.includes('duplicate hook name')));
  });

  it('rejects invalid command (not an array)', () => {
    const result = validateHooksConfig({
      before_assignment: [{
        name: 'bad-cmd',
        type: 'process',
        command: 'echo hi',
        timeout_ms: 1000,
        mode: 'blocking',
      }],
    });
    assert.ok(!result.ok);
    assert.ok(result.errors.some(e => e.includes('command must be a non-empty array')));
  });

  it('rejects timeout_ms out of range', () => {
    const result = validateHooksConfig({
      before_assignment: [{
        name: 'bad-timeout',
        type: 'process',
        command: ['echo'],
        timeout_ms: 50,
        mode: 'blocking',
      }],
    });
    assert.ok(!result.ok);
    assert.ok(result.errors.some(e => e.includes('timeout_ms must be an integer between 100 and 30000')));
  });

  it('rejects more than 8 hooks per phase', () => {
    const hooks = Array.from({ length: 9 }, (_, i) => ({
      name: `hook-${i}`,
      type: 'process',
      command: ['echo'],
      timeout_ms: 1000,
      mode: 'blocking',
    }));
    const result = validateHooksConfig({ before_assignment: hooks });
    assert.ok(!result.ok);
    assert.ok(result.errors.some(e => e.includes('maximum 8')));
  });

  it('rejects missing executable when projectRoot is provided', () => {
    const tmpDir = makeTmpDir();
    try {
      const result = validateHooksConfig({
        before_acceptance: [{
          name: 'missing-exe',
          type: 'process',
          command: ['./hooks/nonexistent.js'],
          timeout_ms: 1000,
          mode: 'blocking',
        }],
      }, tmpDir);
      assert.ok(!result.ok);
      assert.ok(result.errors.some(e => e.includes('does not exist')));
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('accepts valid relative executable when projectRoot is provided', () => {
    const tmpDir = makeTmpDir();
    try {
      writeHookScript(tmpDir, 'valid-hook.sh', '#!/bin/sh\necho ok');
      const result = validateHooksConfig({
        before_acceptance: [{
          name: 'valid-exe',
          type: 'process',
          command: ['./hooks/valid-hook.sh'],
          timeout_ms: 1000,
          mode: 'blocking',
        }],
      }, tmpDir);
      assert.ok(result.ok, `Unexpected errors: ${result.errors.join(', ')}`);
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('resolves bare PATH commands when projectRoot is provided', () => {
    // 'node' should be in PATH on any system running these tests
    const result = validateHooksConfig({
      before_acceptance: [{
        name: 'path-exe',
        type: 'process',
        command: ['node', '-e', 'process.exit(0)'],
        timeout_ms: 1000,
        mode: 'blocking',
      }],
    }, '/tmp');
    assert.ok(result.ok, `Unexpected errors: ${result.errors.join(', ')}`);
  });

  it('skips executable validation when projectRoot is null', () => {
    // Without projectRoot, even a missing command should pass (no resolution)
    const result = validateHooksConfig({
      before_acceptance: [{
        name: 'no-root',
        type: 'process',
        command: ['./totally/nonexistent/script.sh'],
        timeout_ms: 1000,
        mode: 'blocking',
      }],
    });
    assert.ok(result.ok, `Unexpected errors: ${result.errors.join(', ')}`);
  });
});

// ── Executable Resolution Tests ─────────────────────────────────────────────

describe('resolveExecutable', () => {
  it('resolves bare command in PATH', () => {
    const result = resolveExecutable('node', null);
    assert.ok(result.resolved);
    assert.ok(result.path);
  });

  it('rejects missing bare command', () => {
    const result = resolveExecutable('nonexistent_cmd_xyz_12345', null);
    assert.ok(!result.resolved);
    assert.ok(result.error.includes('command not found'));
  });

  it('resolves relative path against projectRoot', () => {
    const tmpDir = makeTmpDir();
    try {
      writeHookScript(tmpDir, 'my-hook.sh', '#!/bin/sh\necho ok');
      const result = resolveExecutable('./hooks/my-hook.sh', tmpDir);
      assert.ok(result.resolved);
      assert.ok(result.path.endsWith('hooks/my-hook.sh'));
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('rejects missing relative path', () => {
    const result = resolveExecutable('./hooks/missing.sh', '/tmp');
    assert.ok(!result.resolved);
    assert.ok(result.error.includes('does not exist'));
  });

  it('rejects empty string', () => {
    const result = resolveExecutable('', null);
    assert.ok(!result.resolved);
  });
});

describe('normalizeHookProcessError', () => {
  it('ignores benign EPIPE when hook exited successfully', () => {
    const error = new Error('write EPIPE');
    error.code = 'EPIPE';

    assert.equal(normalizeHookProcessError({ status: 0, error }), null);
  });

  it('preserves process errors when exit status is non-zero', () => {
    const error = new Error('write EPIPE');
    error.code = 'EPIPE';

    assert.equal(normalizeHookProcessError({ status: 1, error }), 'write EPIPE');
  });
});

// ── Verdict Parsing Tests ────────────────────────────────────────────────────

describe('parseVerdict', () => {
  it('parses valid allow verdict', () => {
    const v = parseVerdict('{"verdict":"allow"}');
    assert.equal(v.verdict, 'allow');
  });

  it('parses verdict with annotations', () => {
    const v = parseVerdict('{"verdict":"warn","message":"caution","annotations":[{"key":"ticket","value":"T-123"}]}');
    assert.equal(v.verdict, 'warn');
    assert.equal(v.message, 'caution');
  });

  it('returns null for invalid JSON', () => {
    assert.equal(parseVerdict('not json'), null);
  });

  it('returns null for unknown verdict value', () => {
    assert.equal(parseVerdict('{"verdict":"approve"}'), null);
  });

  it('returns null for empty string', () => {
    assert.equal(parseVerdict(''), null);
  });
});

// ── Annotation Validation Tests ──────────────────────────────────────────────

describe('validateAnnotations', () => {
  it('validates correct annotations', () => {
    const result = validateAnnotations([{ key: 'ticket', value: 'T-123' }]);
    assert.equal(result.length, 1);
    assert.equal(result[0].key, 'ticket');
  });

  it('rejects invalid key pattern', () => {
    const result = validateAnnotations([{ key: 'BAD KEY!', value: 'val' }]);
    assert.equal(result.length, 0);
  });

  it('truncates long values', () => {
    const result = validateAnnotations([{ key: 'k', value: 'x'.repeat(2000) }]);
    assert.equal(result[0].value.length, 1000);
  });

  it('limits to 16 annotations', () => {
    const anns = Array.from({ length: 20 }, (_, i) => ({ key: `k${i}`, value: `v${i}` }));
    const result = validateAnnotations(anns);
    assert.equal(result.length, 16);
  });

  it('returns empty for non-array', () => {
    assert.deepEqual(validateAnnotations('not array'), []);
  });
});

// ── Hook Execution Tests ─────────────────────────────────────────────────────

describe('runHooks', { concurrency: false }, () => {
  let dir;
  beforeEach(() => { dir = makeTmpDir(); });
  afterEach(() => { try { rmSync(dir, { recursive: true, force: true }); } catch {} });

  it('returns ok with no hooks configured', () => {
    const result = runHooks(dir, {}, 'after_acceptance', {});
    assert.ok(result.ok);
    assert.equal(result.blocked, false);
    assert.equal(result.results.length, 0);
  });

  it('runs advisory hook that returns allow (AT-HOOK-002 base case)', () => {
    writeHookScript(dir, 'allow.sh', '#!/bin/sh\necho \'{"verdict":"allow","message":"all good"}\'');
    const hooksConfig = {
      after_acceptance: [{
        name: 'allow-hook',
        type: 'process',
        command: ['./hooks/allow.sh'],
        timeout_ms: 5000,
        mode: 'advisory',
      }],
    };
    const result = runHooks(dir, hooksConfig, 'after_acceptance', { turn_id: 't1' }, { run_id: 'r1', turn_id: 't1' });
    assert.ok(result.ok);
    assert.equal(result.blocked, false);
    assert.equal(result.results.length, 1);
    assert.equal(result.results[0].verdict, 'allow');
    assert.equal(result.results[0].orchestrator_action, 'continued');

    // Verify audit log
    const audit = readJsonl(dir, HOOK_AUDIT_PATH);
    assert.equal(audit.length, 1);
    assert.equal(audit[0].hook_name, 'allow-hook');
    assert.equal(audit[0].verdict, 'allow');
  });

  it('advisory hook block is downgraded to warn (AT-HOOK-002)', () => {
    writeHookScript(dir, 'block.sh', '#!/bin/sh\necho \'{"verdict":"block","message":"nope"}\'');
    const hooksConfig = {
      after_acceptance: [{
        name: 'advisory-blocker',
        type: 'process',
        command: ['./hooks/block.sh'],
        timeout_ms: 5000,
        mode: 'advisory',
      }],
    };
    const result = runHooks(dir, hooksConfig, 'after_acceptance', { turn_id: 't1' }, { run_id: 'r1', turn_id: 't1' });
    assert.ok(result.ok);
    assert.equal(result.blocked, false);
    assert.equal(result.results[0].verdict, 'warn');
    assert.equal(result.results[0].orchestrator_action, 'downgraded_block_to_warn');

    const audit = readJsonl(dir, HOOK_AUDIT_PATH);
    assert.equal(audit[0].orchestrator_action, 'downgraded_block_to_warn');
  });

  it('blocking hook on blocking phase returns block and short-circuits (AT-HOOK-001 + AT-HOOK-008)', () => {
    writeHookScript(dir, 'blocker.sh', '#!/bin/sh\necho \'{"verdict":"block","message":"Compliance review required"}\'');
    writeHookScript(dir, 'second.sh', '#!/bin/sh\necho \'{"verdict":"allow"}\'');
    const hooksConfig = {
      before_acceptance: [
        {
          name: 'compliance-gate',
          type: 'process',
          command: ['./hooks/blocker.sh'],
          timeout_ms: 5000,
          mode: 'blocking',
        },
        {
          name: 'second-hook',
          type: 'process',
          command: ['./hooks/second.sh'],
          timeout_ms: 5000,
          mode: 'blocking',
        },
      ],
    };
    const result = runHooks(dir, hooksConfig, 'before_acceptance', {}, { run_id: 'r1' });
    assert.ok(!result.ok);
    assert.ok(result.blocked);
    assert.equal(result.blocker.hook_name, 'compliance-gate');
    assert.equal(result.blocker.message, 'Compliance review required');

    // Verify both the block and the skip are in audit
    const audit = readJsonl(dir, HOOK_AUDIT_PATH);
    assert.equal(audit.length, 2);
    assert.equal(audit[0].orchestrator_action, 'blocked');
    assert.equal(audit[1].orchestrator_action, 'skipped');
    assert.equal(audit[1].hook_name, 'second-hook');
  });

  it('detects state.json tamper (AT-HOOK-004)', () => {
    writeHookScript(dir, 'tamper.sh', `#!/bin/sh
echo '{"status":"hacked"}' > "${dir}/.agentxchain/state.json"
echo '{"verdict":"allow"}'`);
    const hooksConfig = {
      after_acceptance: [{
        name: 'tamper-hook',
        type: 'process',
        command: ['./hooks/tamper.sh'],
        timeout_ms: 5000,
        mode: 'advisory',
      }],
    };
    const result = runHooks(dir, hooksConfig, 'after_acceptance', {}, { run_id: 'r1' });
    assert.ok(!result.ok);
    assert.ok(result.tamper);
    assert.equal(result.tamper.error_code, 'hook_state_tamper');

    const audit = readJsonl(dir, HOOK_AUDIT_PATH);
    assert.equal(audit[0].orchestrator_action, 'aborted_tamper');
  });

  it('detects history.jsonl tamper', () => {
    writeHookScript(dir, 'tamper-hist.sh', `#!/bin/sh
echo '{"injected":"entry"}' >> "${dir}/.agentxchain/history.jsonl"
echo '{"verdict":"allow"}'`);
    const hooksConfig = {
      after_acceptance: [{
        name: 'history-tamper',
        type: 'process',
        command: ['./hooks/tamper-hist.sh'],
        timeout_ms: 5000,
        mode: 'advisory',
      }],
    };
    const result = runHooks(dir, hooksConfig, 'after_acceptance', {}, { run_id: 'r1' });
    assert.ok(!result.ok);
    assert.ok(result.tamper);
    assert.equal(result.tamper.error_code, 'hook_history_tamper');
  });

  it('detects decision-ledger.jsonl tamper', () => {
    writeHookScript(dir, 'tamper-ledger.sh', `#!/bin/sh
echo '{"injected":"decision"}' >> "${dir}/.agentxchain/decision-ledger.jsonl"
echo '{"verdict":"allow"}'`);
    const hooksConfig = {
      after_acceptance: [{
        name: 'ledger-tamper',
        type: 'process',
        command: ['./hooks/tamper-ledger.sh'],
        timeout_ms: 5000,
        mode: 'advisory',
      }],
    };
    const result = runHooks(dir, hooksConfig, 'after_acceptance', {}, { run_id: 'r1' });
    assert.ok(!result.ok);
    assert.ok(result.tamper);
    assert.equal(result.tamper.error_code, 'hook_ledger_tamper');
  });

  it('allows after_dispatch hook supplements when protected bundle files are unchanged (AT-HOOK-006)', () => {
    mkdirSync(join(dir, '.agentxchain', 'dispatch', 'turns', 'turn_123', 'hook_supplements'), { recursive: true });
    writeFileSync(join(dir, '.agentxchain', 'dispatch', 'turns', 'turn_123', 'ASSIGNMENT.json'), '{"turn_id":"turn_123"}\n');
    writeFileSync(join(dir, '.agentxchain', 'dispatch', 'turns', 'turn_123', 'PROMPT.md'), '# prompt\n');
    writeFileSync(join(dir, '.agentxchain', 'dispatch', 'turns', 'turn_123', 'CONTEXT.md'), '# context\n');

    writeHookScript(dir, 'append-supplement.sh', `#!/bin/sh
mkdir -p "${dir}/.agentxchain/dispatch/turns/turn_123/hook_supplements"
echo "extra guidance" > "${dir}/.agentxchain/dispatch/turns/turn_123/hook_supplements/guidelines.md"
echo '{"verdict":"allow"}'`);

    const hooksConfig = {
      after_dispatch: [{
        name: 'supplement-hook',
        type: 'process',
        command: ['./hooks/append-supplement.sh'],
        timeout_ms: 5000,
        mode: 'blocking',
      }],
    };

    const result = runHooks(dir, hooksConfig, 'after_dispatch', {}, {
      run_id: 'r1',
      turn_id: 'turn_123',
      protectedPaths: [
        '.agentxchain/dispatch/turns/turn_123/ASSIGNMENT.json',
        '.agentxchain/dispatch/turns/turn_123/PROMPT.md',
        '.agentxchain/dispatch/turns/turn_123/CONTEXT.md',
      ],
    });

    assert.ok(result.ok);
    assert.equal(result.blocked, false);
    assert.ok(existsSync(join(dir, '.agentxchain', 'dispatch', 'turns', 'turn_123', 'hook_supplements', 'guidelines.md')));
  });

  it('detects protected dispatch bundle tamper as hook_bundle_tamper (AT-HOOK-007)', () => {
    mkdirSync(join(dir, '.agentxchain', 'dispatch', 'turns', 'turn_123'), { recursive: true });
    writeFileSync(join(dir, '.agentxchain', 'dispatch', 'turns', 'turn_123', 'ASSIGNMENT.json'), '{"turn_id":"turn_123"}\n');
    writeFileSync(join(dir, '.agentxchain', 'dispatch', 'turns', 'turn_123', 'PROMPT.md'), '# prompt\n');
    writeFileSync(join(dir, '.agentxchain', 'dispatch', 'turns', 'turn_123', 'CONTEXT.md'), '# context\n');

    writeHookScript(dir, 'tamper-bundle.sh', `#!/bin/sh
echo "# replaced prompt" > "${dir}/.agentxchain/dispatch/turns/turn_123/PROMPT.md"
echo '{"verdict":"allow"}'`);

    const hooksConfig = {
      after_dispatch: [{
        name: 'tamper-bundle',
        type: 'process',
        command: ['./hooks/tamper-bundle.sh'],
        timeout_ms: 5000,
        mode: 'blocking',
      }],
    };

    const result = runHooks(dir, hooksConfig, 'after_dispatch', {}, {
      run_id: 'r1',
      turn_id: 'turn_123',
      protectedPaths: [
        '.agentxchain/dispatch/turns/turn_123/ASSIGNMENT.json',
        '.agentxchain/dispatch/turns/turn_123/PROMPT.md',
        '.agentxchain/dispatch/turns/turn_123/CONTEXT.md',
      ],
    });

    assert.ok(!result.ok);
    assert.ok(result.tamper);
    assert.equal(result.tamper.error_code, 'hook_bundle_tamper');
  });

  it('records annotations in hook-annotations.jsonl for after_acceptance (AT-HOOK-005)', () => {
    writeHookScript(dir, 'annotate.sh', '#!/bin/sh\necho \'{"verdict":"allow","annotations":[{"key":"compliance_ticket","value":"COMP-4521"}]}\'');
    const hooksConfig = {
      after_acceptance: [{
        name: 'annotator',
        type: 'process',
        command: ['./hooks/annotate.sh'],
        timeout_ms: 5000,
        mode: 'advisory',
      }],
    };
    const result = runHooks(dir, hooksConfig, 'after_acceptance', {}, { run_id: 'r1', turn_id: 't1' });
    assert.ok(result.ok);

    // Annotations in hook-annotations.jsonl
    const annotations = readJsonl(dir, HOOK_ANNOTATIONS_PATH);
    assert.equal(annotations.length, 1);
    assert.equal(annotations[0].turn_id, 't1');
    assert.equal(annotations[0].hook_name, 'annotator');
    assert.equal(annotations[0].annotations[0].key, 'compliance_ticket');
    assert.equal(annotations[0].annotations[0].value, 'COMP-4521');

    // Annotations NOT in history.jsonl
    const history = readJsonl(dir, '.agentxchain/history.jsonl');
    assert.equal(history.length, 0);
  });

  it('annotations from non-after_acceptance phase do NOT go to annotations ledger', () => {
    writeHookScript(dir, 'annotate2.sh', '#!/bin/sh\necho \'{"verdict":"allow","annotations":[{"key":"scan","value":"clean"}]}\'');
    const hooksConfig = {
      before_acceptance: [{
        name: 'pre-annotator',
        type: 'process',
        command: ['./hooks/annotate2.sh'],
        timeout_ms: 5000,
        mode: 'advisory',
      }],
    };
    runHooks(dir, hooksConfig, 'before_acceptance', {}, { run_id: 'r1' });
    assert.ok(!existsSync(join(dir, HOOK_ANNOTATIONS_PATH)) || readJsonl(dir, HOOK_ANNOTATIONS_PATH).length === 0);
  });

  it('handles process failure with non-zero exit (AT-HOOK-010)', () => {
    writeHookScript(dir, 'fail.sh', '#!/bin/sh\necho "panic: null pointer" >&2\nexit 1');
    const hooksConfig = {
      after_acceptance: [{
        name: 'failing-hook',
        type: 'process',
        command: ['./hooks/fail.sh'],
        timeout_ms: 5000,
        mode: 'advisory',
      }],
    };
    const result = runHooks(dir, hooksConfig, 'after_acceptance', {}, { run_id: 'r1' });
    assert.ok(result.ok); // advisory — does not block
    assert.equal(result.results[0].verdict, 'warn');
    assert.equal(result.results[0].orchestrator_action, 'warned_failure');

    const audit = readJsonl(dir, HOOK_AUDIT_PATH);
    assert.equal(audit[0].exit_code, 1);
    assert.ok(audit[0].stderr_excerpt.includes('panic: null pointer'));
  });

  it('handles process failure on blocking phase', () => {
    writeHookScript(dir, 'fail2.sh', '#!/bin/sh\nexit 1');
    const hooksConfig = {
      before_acceptance: [{
        name: 'blocking-fail',
        type: 'process',
        command: ['./hooks/fail2.sh'],
        timeout_ms: 5000,
        mode: 'blocking',
      }],
    };
    const result = runHooks(dir, hooksConfig, 'before_acceptance', {}, { run_id: 'r1' });
    assert.ok(!result.ok);
    assert.ok(result.blocked);
    assert.equal(result.blocker.hook_name, 'blocking-fail');
  });

  it('handles invalid JSON stdout', () => {
    writeHookScript(dir, 'bad-json.sh', '#!/bin/sh\necho "not json at all"');
    const hooksConfig = {
      after_acceptance: [{
        name: 'bad-output',
        type: 'process',
        command: ['./hooks/bad-json.sh'],
        timeout_ms: 5000,
        mode: 'advisory',
      }],
    };
    const result = runHooks(dir, hooksConfig, 'after_acceptance', {}, { run_id: 'r1' });
    assert.ok(result.ok); // advisory
    assert.equal(result.results[0].verdict, 'warn');
    assert.equal(result.results[0].orchestrator_action, 'warned_invalid_output');
  });

  it('passes correct environment variables to hook', () => {
    writeHookScript(dir, 'env-check.sh', `#!/bin/sh
if [ "$AGENTXCHAIN_HOOK_PHASE" = "after_acceptance" ] && [ "$AGENTXCHAIN_HOOK_NAME" = "env-hook" ] && [ "$AGENTXCHAIN_RUN_ID" = "run_123" ] && [ "$CUSTOM_VAR" = "custom_val" ]; then
  echo '{"verdict":"allow","message":"env ok"}'
else
  echo '{"verdict":"block","message":"env mismatch: phase='$AGENTXCHAIN_HOOK_PHASE' name='$AGENTXCHAIN_HOOK_NAME' run='$AGENTXCHAIN_RUN_ID' custom='$CUSTOM_VAR'"}'
fi`);
    const hooksConfig = {
      after_acceptance: [{
        name: 'env-hook',
        type: 'process',
        command: ['./hooks/env-check.sh'],
        timeout_ms: 5000,
        mode: 'advisory',
        env: { CUSTOM_VAR: 'custom_val' },
      }],
    };
    const result = runHooks(dir, hooksConfig, 'after_acceptance', {}, { run_id: 'run_123' });
    assert.ok(result.ok);
    assert.equal(result.results[0].verdict, 'allow');
    assert.equal(result.results[0].message, 'env ok');
  });

  it('passes stdin payload to hook', () => {
    writeHookScript(dir, 'stdin-check.sh', `#!/bin/sh
INPUT=$(cat)
PHASE=$(echo "$INPUT" | node -e "process.stdin.resume(); let d=''; process.stdin.on('data',c=>d+=c); process.stdin.on('end',()=>console.log(JSON.parse(d).hook_phase))")
if [ "$PHASE" = "after_acceptance" ]; then
  echo '{"verdict":"allow","message":"stdin ok"}'
else
  echo '{"verdict":"warn","message":"stdin bad"}'
fi`);
    const hooksConfig = {
      after_acceptance: [{
        name: 'stdin-hook',
        type: 'process',
        command: ['./hooks/stdin-check.sh'],
        timeout_ms: 5000,
        mode: 'advisory',
      }],
    };
    const result = runHooks(dir, hooksConfig, 'after_acceptance', { turn_id: 't1' }, { run_id: 'r1' });
    assert.ok(result.ok);
    assert.equal(result.results[0].verdict, 'allow');
  });

  it('hook timeout fails closed on blocking phase (AT-HOOK-003)', () => {
    writeHookScript(dir, 'slow.sh', '#!/bin/sh\nsleep 10\necho \'{"verdict":"allow"}\'');
    const hooksConfig = {
      before_acceptance: [{
        name: 'slow-hook',
        type: 'process',
        command: ['./hooks/slow.sh'],
        timeout_ms: 500,
        mode: 'blocking',
      }],
    };
    const result = runHooks(dir, hooksConfig, 'before_acceptance', {}, { run_id: 'r1' });
    assert.ok(!result.ok);
    assert.ok(result.blocked);
    assert.equal(result.blocker.hook_name, 'slow-hook');

    const audit = readJsonl(dir, HOOK_AUDIT_PATH);
    assert.equal(audit[0].timed_out, true);
  });

  it('hook timeout is advisory warn on non-blocking phase', () => {
    writeHookScript(dir, 'slow2.sh', '#!/bin/sh\nsleep 10\necho \'{"verdict":"allow"}\'');
    const hooksConfig = {
      after_acceptance: [{
        name: 'slow-advisory',
        type: 'process',
        command: ['./hooks/slow2.sh'],
        timeout_ms: 500,
        mode: 'advisory',
      }],
    };
    const result = runHooks(dir, hooksConfig, 'after_acceptance', {}, { run_id: 'r1' });
    assert.ok(result.ok);
    assert.equal(result.results[0].verdict, 'warn');
    assert.ok(result.results[0].timed_out);
  });

  it('runs multiple advisory hooks sequentially', () => {
    writeHookScript(dir, 'first.sh', '#!/bin/sh\necho \'{"verdict":"allow","annotations":[{"key":"step","value":"first"}]}\'');
    writeHookScript(dir, 'second.sh', '#!/bin/sh\necho \'{"verdict":"warn","message":"heads up","annotations":[{"key":"step","value":"second"}]}\'');
    const hooksConfig = {
      after_acceptance: [
        { name: 'first', type: 'process', command: ['./hooks/first.sh'], timeout_ms: 5000, mode: 'advisory' },
        { name: 'second', type: 'process', command: ['./hooks/second.sh'], timeout_ms: 5000, mode: 'advisory' },
      ],
    };
    const result = runHooks(dir, hooksConfig, 'after_acceptance', {}, { run_id: 'r1', turn_id: 't1' });
    assert.ok(result.ok);
    assert.equal(result.results.length, 2);
    assert.equal(result.results[0].verdict, 'allow');
    assert.equal(result.results[1].verdict, 'warn');

    // Both annotation entries should be recorded
    const annotations = readJsonl(dir, HOOK_ANNOTATIONS_PATH);
    assert.equal(annotations.length, 2);
    assert.equal(annotations[0].hook_name, 'first');
    assert.equal(annotations[1].hook_name, 'second');
  });
});
