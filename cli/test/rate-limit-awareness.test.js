/**
 * RB-1: local_cli Rate-Limit Awareness — unit tests.
 *
 * Covers:
 *   - Rate-limit signature detection (Claude, OpenAI, generic patterns)
 *   - Reset time parsing
 *   - Adapter classification (subprocess exit with rate-limit output → classified result)
 *   - Priority ordering (auth failure wins over rate-limit)
 *   - Backoff behavior (rate-limit does not consume max_turn_retries)
 */

import { describe, it } from 'vitest';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, chmodSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomBytes } from 'node:crypto';

import {
  hasProviderRateLimitText,
  hasRateLimitOutput,
  parseRateLimitResetMs,
} from '../src/lib/claude-local-auth.js';

import {
  dispatchLocalCli,
} from '../src/lib/adapters/local-cli-adapter.js';
import {
  getDispatchTurnDir,
  getTurnStagingResultPath,
} from '../src/lib/turn-paths.js';

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeTmpDir() {
  const dir = join(tmpdir(), `axc-ratelimit-test-${randomBytes(6).toString('hex')}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function writeShim(root, name, contents) {
  const shimDir = join(root, 'shim-bin');
  mkdirSync(shimDir, { recursive: true });
  const shimPath = join(shimDir, name);
  writeFileSync(shimPath, contents);
  chmodSync(shimPath, 0o755);
  return shimPath;
}

function scaffoldDispatch(root, turnId) {
  const dispatchDir = join(root, getDispatchTurnDir(turnId));
  mkdirSync(dispatchDir, { recursive: true });
  writeFileSync(join(dispatchDir, 'PROMPT.md'), '# Test prompt');

  const stagingDir = join(root, '.agentxchain', 'staging', turnId);
  mkdirSync(stagingDir, { recursive: true });
}

// ── Component 1: Rate-limit signature detection ─────────────────────────────

describe('hasProviderRateLimitText', () => {
  // AC-1: Claude/Anthropic patterns
  it('AT-RL-001: detects Claude rate_limit_error', () => {
    assert.ok(hasProviderRateLimitText('{"type":"error","error":{"type":"rate_limit_error","message":"Rate limit exceeded"}}'));
  });

  it('AT-RL-002: detects Claude "error":"rate_limit"', () => {
    assert.ok(hasProviderRateLimitText('{"error":"rate_limit"}'));
  });

  it('AT-RL-003: detects "hit your limit"', () => {
    assert.ok(hasProviderRateLimitText("You've hit your limit. Resets in 42s."));
  });

  it('AT-RL-004: detects "usage limit"', () => {
    assert.ok(hasProviderRateLimitText('Usage limit exceeded'));
  });

  it('AT-RL-005: detects "hit-your-limit" with hyphens', () => {
    assert.ok(hasProviderRateLimitText('Error: hit-your-limit'));
  });

  // AC-2: OpenAI/Codex patterns
  it('AT-RL-006: detects OpenAI "rate limit reached"', () => {
    assert.ok(hasProviderRateLimitText('Rate limit reached for model gpt-4o in organization org-abc'));
  });

  it('AT-RL-007: detects OpenAI rate_limit_error type', () => {
    assert.ok(hasProviderRateLimitText('{"error":{"type":"rate_limit_error","message":"Rate limit exceeded"}}'));
  });

  // AC-3: Generic patterns
  it('AT-RL-008: detects "429 Too Many Requests"', () => {
    assert.ok(hasProviderRateLimitText('HTTP 429 Too Many Requests'));
  });

  it('AT-RL-009: detects "too many requests" standalone', () => {
    assert.ok(hasProviderRateLimitText('Error: Too many requests'));
  });

  it('AT-RL-010: detects "rate limited" with space', () => {
    assert.ok(hasProviderRateLimitText('You are rate limited. Please wait.'));
  });

  it('AT-RL-011: detects "rate_limited" with underscore', () => {
    assert.ok(hasProviderRateLimitText('Status: rate_limited'));
  });

  // AC-4: Negative cases
  it('AT-RL-012: rejects normal output', () => {
    assert.ok(!hasProviderRateLimitText('Turn completed successfully'));
  });

  it('AT-RL-013: rejects auth failures', () => {
    assert.ok(!hasProviderRateLimitText('authentication_failed'));
  });

  it('AT-RL-014: rejects generic errors', () => {
    assert.ok(!hasProviderRateLimitText('Error: connection refused'));
  });

  it('AT-RL-015: rejects null/undefined', () => {
    assert.ok(!hasProviderRateLimitText(null));
    assert.ok(!hasProviderRateLimitText(undefined));
    assert.ok(!hasProviderRateLimitText(42));
  });

  it('AT-RL-016: rejects empty string', () => {
    assert.ok(!hasProviderRateLimitText(''));
  });
});

describe('hasRateLimitOutput', () => {
  it('AT-RL-017: detects rate-limit in log array', () => {
    const logs = [
      'Starting subprocess...',
      '{"type":"error","error":{"type":"rate_limit_error","message":"Rate limit exceeded"}}',
      'Subprocess exited.',
    ];
    assert.ok(hasRateLimitOutput(logs));
  });

  it('AT-RL-018: returns false for clean logs', () => {
    const logs = ['Starting subprocess...', 'Turn completed.', 'Exit code 0.'];
    assert.ok(!hasRateLimitOutput(logs));
  });

  it('AT-RL-019: returns false for non-array', () => {
    assert.ok(!hasRateLimitOutput(null));
    assert.ok(!hasRateLimitOutput('rate_limit_error'));
    assert.ok(!hasRateLimitOutput(undefined));
  });
});

// ── Component 1b: Reset time parsing ────────────────────────────────────────

describe('parseRateLimitResetMs', () => {
  // AC-5: Reset time extraction
  it('AT-RL-020: parses "resets in 42s"', () => {
    assert.equal(parseRateLimitResetMs("You've hit your limit. Resets in 42s."), 42000);
  });

  it('AT-RL-021: parses "Retry-After: 30"', () => {
    assert.equal(parseRateLimitResetMs('HTTP 429\nRetry-After: 30'), 30000);
  });

  it('AT-RL-022: parses "wait 60 seconds"', () => {
    assert.equal(parseRateLimitResetMs('Please wait 60 seconds'), 60000);
  });

  it('AT-RL-023: parses "120 seconds" near rate-limit context', () => {
    assert.equal(parseRateLimitResetMs('Rate limited. Try again in 120 seconds.'), 120000);
  });

  it('AT-RL-024: returns null for unparseable text', () => {
    assert.equal(parseRateLimitResetMs('Rate limit exceeded'), null);
  });

  it('AT-RL-025: returns null for non-string', () => {
    assert.equal(parseRateLimitResetMs(null), null);
    assert.equal(parseRateLimitResetMs(42), null);
  });

  it('AT-RL-026: parses "Reset in 5s" (singular reset)', () => {
    assert.equal(parseRateLimitResetMs('Reset in 5s'), 5000);
  });

  it('AT-RL-027: parses "retry-after=10"', () => {
    assert.equal(parseRateLimitResetMs('retry-after=10'), 10000);
  });

  it('AT-RL-028: rejects unreasonable values (> 3600s)', () => {
    assert.equal(parseRateLimitResetMs('Resets in 99999s'), null);
  });
});

// ── Component 2: Adapter classification ─────────────────────────────────────

describe('adapter rate-limit classification', () => {
  // AC-6: Rate-limited subprocess → classified result
  it('AT-RL-029: classifies rate-limited exit as { error_class: rate_limited, retryable: true }', async () => {
    const root = makeTmpDir();
    const turnId = 'turn_rl_test_001';
    scaffoldDispatch(root, turnId);

    const shimPath = writeShim(root, 'claude', `#!/bin/sh
echo '{"type":"error","error":{"type":"rate_limit_error","message":"Rate limit exceeded. Resets in 30s."}}'
exit 1
`);

    const state = {
      run_id: 'run_rl_test',
      phase: 'implementation',
      active_turns: {
        [turnId]: { turn_id: turnId, assigned_role: 'dev', runtime_id: 'test-rt', attempt: 1 },
      },
    };
    const config = {
      runtimes: {
        'test-rt': {
          type: 'local_cli',
          command: [shimPath],
          prompt_transport: 'dispatch_bundle_only',
        },
      },
    };

    const result = await dispatchLocalCli(root, state, config, {
      turnId,
      startupWatchdogMs: 5000,
    });

    assert.equal(result.ok, false);
    assert.equal(result.blocked, true);
    assert.equal(result.classified?.error_class, 'rate_limited');
    assert.equal(result.classified?.retryable, true);
    assert.equal(typeof result.classified?.recovery, 'string');
    assert.ok(result.classified.recovery.includes('rate-limited'));

    rmSync(root, { recursive: true, force: true });
  });

  it('AT-RL-030: includes reset_ms when parseable from output', async () => {
    const root = makeTmpDir();
    const turnId = 'turn_rl_test_002';
    scaffoldDispatch(root, turnId);

    const shimPath = writeShim(root, 'claude', `#!/bin/sh
echo "Rate limited. Resets in 45s."
exit 1
`);

    const state = {
      run_id: 'run_rl_test',
      phase: 'implementation',
      active_turns: {
        [turnId]: { turn_id: turnId, assigned_role: 'dev', runtime_id: 'test-rt', attempt: 1 },
      },
    };
    const config = {
      runtimes: {
        'test-rt': {
          type: 'local_cli',
          command: [shimPath],
          prompt_transport: 'dispatch_bundle_only',
        },
      },
    };

    const result = await dispatchLocalCli(root, state, config, {
      turnId,
      startupWatchdogMs: 5000,
    });

    assert.equal(result.ok, false);
    assert.equal(result.classified?.error_class, 'rate_limited');
    assert.equal(result.classified?.reset_ms, 45000);
    assert.ok(result.classified.recovery.includes('45s'));

    rmSync(root, { recursive: true, force: true });
  });

  it('AT-RL-031: reset_ms is null when no reset time in output', async () => {
    const root = makeTmpDir();
    const turnId = 'turn_rl_test_003';
    scaffoldDispatch(root, turnId);

    const shimPath = writeShim(root, 'claude', `#!/bin/sh
echo "Error: Too many requests"
exit 1
`);

    const state = {
      run_id: 'run_rl_test',
      phase: 'implementation',
      active_turns: {
        [turnId]: { turn_id: turnId, assigned_role: 'dev', runtime_id: 'test-rt', attempt: 1 },
      },
    };
    const config = {
      runtimes: {
        'test-rt': {
          type: 'local_cli',
          command: [shimPath],
          prompt_transport: 'dispatch_bundle_only',
        },
      },
    };

    const result = await dispatchLocalCli(root, state, config, {
      turnId,
      startupWatchdogMs: 5000,
    });

    assert.equal(result.ok, false);
    assert.equal(result.classified?.error_class, 'rate_limited');
    assert.equal(result.classified?.reset_ms, null);

    rmSync(root, { recursive: true, force: true });
  });

  // AC-7: Priority ordering — auth failures take priority over rate-limit
  it('AT-RL-032: auth failure wins over rate-limit when both present (Claude)', async () => {
    const root = makeTmpDir();
    const turnId = 'turn_rl_test_004';
    scaffoldDispatch(root, turnId);

    // Output contains BOTH auth failure and rate-limit text
    const shimPath = writeShim(root, 'claude', `#!/bin/sh
echo "authentication_failed"
echo "rate_limit_error"
exit 1
`);

    const state = {
      run_id: 'run_rl_test',
      phase: 'implementation',
      active_turns: {
        [turnId]: { turn_id: turnId, assigned_role: 'dev', runtime_id: 'test-rt', attempt: 1 },
      },
    };
    const config = {
      runtimes: {
        'test-rt': {
          type: 'local_cli',
          command: [shimPath],
          prompt_transport: 'dispatch_bundle_only',
        },
      },
    };

    const result = await dispatchLocalCli(root, state, config, {
      turnId,
      startupWatchdogMs: 5000,
    });

    // Auth failure should take priority — error_class should be claude_auth_failed, not rate_limited
    assert.equal(result.ok, false);
    assert.equal(result.classified?.error_class, 'claude_auth_failed');

    rmSync(root, { recursive: true, force: true });
  });

  // Provider-agnostic: works for non-Claude runtimes too
  it('AT-RL-033: detects rate-limit for non-Claude runtime (generic shim)', async () => {
    const root = makeTmpDir();
    const turnId = 'turn_rl_test_005';
    scaffoldDispatch(root, turnId);

    // Use a generic command name — not "claude" or "codex"
    const shimPath = writeShim(root, 'my-agent', `#!/bin/sh
echo "HTTP 429 Too Many Requests"
exit 1
`);

    const state = {
      run_id: 'run_rl_test',
      phase: 'implementation',
      active_turns: {
        [turnId]: { turn_id: turnId, assigned_role: 'dev', runtime_id: 'test-rt', attempt: 1 },
      },
    };
    const config = {
      runtimes: {
        'test-rt': {
          type: 'local_cli',
          command: [shimPath],
          prompt_transport: 'dispatch_bundle_only',
        },
      },
    };

    const result = await dispatchLocalCli(root, state, config, {
      turnId,
      startupWatchdogMs: 5000,
    });

    assert.equal(result.ok, false);
    assert.equal(result.blocked, true);
    assert.equal(result.classified?.error_class, 'rate_limited');
    assert.equal(result.classified?.retryable, true);

    rmSync(root, { recursive: true, force: true });
  });
});

// ── Component 3: Backoff behavior ───────────────────────────────────────────

describe('rate-limit backoff invariants', () => {
  // AC-8: Rate-limit does not exhaust max_turn_retries
  // This is a design-level test — we verify the dispatch callback structure:
  // the rate-limit retry loop is inside the dispatch callback, NOT via rejectTurn().

  it('AT-RL-034: classified result has retryable=true for dispatch callback consumption', async () => {
    const root = makeTmpDir();
    const turnId = 'turn_rl_test_006';
    scaffoldDispatch(root, turnId);

    const shimPath = writeShim(root, 'claude', `#!/bin/sh
echo "rate_limit_error"
exit 1
`);

    const state = {
      run_id: 'run_rl_test',
      phase: 'implementation',
      active_turns: {
        [turnId]: { turn_id: turnId, assigned_role: 'dev', runtime_id: 'test-rt', attempt: 1 },
      },
    };
    const config = {
      runtimes: {
        'test-rt': {
          type: 'local_cli',
          command: [shimPath],
          prompt_transport: 'dispatch_bundle_only',
        },
      },
    };

    const result = await dispatchLocalCli(root, state, config, {
      turnId,
      startupWatchdogMs: 5000,
    });

    // The adapter returns classified.retryable = true, signaling run.js dispatch
    // callback to apply backoff instead of consuming max_turn_retries.
    assert.equal(result.classified?.retryable, true);
    assert.equal(result.classified?.error_class, 'rate_limited');
    // blocked: true means the dispatch callback can distinguish this from a generic failure
    assert.equal(result.blocked, true);

    rmSync(root, { recursive: true, force: true });
  });

  it('AT-RL-035: adapter result shape matches api_proxy rate_limited classification', async () => {
    const root = makeTmpDir();
    const turnId = 'turn_rl_test_007';
    scaffoldDispatch(root, turnId);

    // Use a generic shim name (not "codex") to avoid connector-specific validation
    const shimPath = writeShim(root, 'my-openai-agent', `#!/bin/sh
echo "Rate limit reached for model gpt-4o"
exit 1
`);

    const state = {
      run_id: 'run_rl_test',
      phase: 'implementation',
      active_turns: {
        [turnId]: { turn_id: turnId, assigned_role: 'dev', runtime_id: 'test-rt', attempt: 1 },
      },
    };
    const config = {
      runtimes: {
        'test-rt': {
          type: 'local_cli',
          command: [shimPath],
          prompt_transport: 'dispatch_bundle_only',
        },
      },
    };

    const result = await dispatchLocalCli(root, state, config, {
      turnId,
      startupWatchdogMs: 5000,
    });

    // Verify the result shape matches the api_proxy adapter's rate_limited classification
    assert.equal(result.ok, false);
    assert.equal(result.blocked, true);
    assert.equal(result.classified?.error_class, 'rate_limited');
    assert.equal(result.classified?.retryable, true);
    assert.equal(typeof result.classified?.recovery, 'string');
    assert.ok('reset_ms' in result.classified); // field present (may be null)
    assert.ok(result.error.includes('rate-limited'));

    rmSync(root, { recursive: true, force: true });
  });
});
