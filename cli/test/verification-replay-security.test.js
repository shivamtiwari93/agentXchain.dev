/**
 * Verification-replay security hardening (RCE).
 *
 * Agent-declared machine_evidence commands are UNTRUSTED. They must never run
 * through a shell (no chaining/piping/expansion/substitution), and must not be
 * executed at all unless the operator explicitly opts in.
 */

import { describe, it } from 'vitest';
import assert from 'node:assert/strict';
import { existsSync, rmSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import {
  tokenizeCommand,
  resolveEvidenceArgv,
  replayVerificationMachineEvidence,
} from '../src/lib/verification-replay.js';

describe('tokenizeCommand (no shell expansion)', () => {
  it('AT-VRP-001: splits simple commands', () => {
    assert.deepEqual(tokenizeCommand('echo ok'), ['echo', 'ok']);
  });
  it('AT-VRP-002: honors double and single quotes', () => {
    assert.deepEqual(tokenizeCommand('node -e "process.exit(1)"'), ['node', '-e', 'process.exit(1)']);
    assert.deepEqual(tokenizeCommand("echo 'a b c'"), ['echo', 'a b c']);
  });
  it('AT-VRP-003: shell metacharacters are literal tokens, never interpreted', () => {
    assert.deepEqual(tokenizeCommand('a ; b'), ['a', ';', 'b']);
    assert.deepEqual(tokenizeCommand('a | b'), ['a', '|', 'b']);
    assert.deepEqual(tokenizeCommand('echo $HOME'), ['echo', '$HOME']);
  });
});

describe('resolveEvidenceArgv', () => {
  it('AT-VRP-004: prefers a structured argv array', () => {
    assert.deepEqual(resolveEvidenceArgv({ argv: ['node', '-v'], command: 'ignored' }), ['node', '-v']);
  });
  it('AT-VRP-005: falls back to tokenizing command', () => {
    assert.deepEqual(resolveEvidenceArgv({ command: 'echo ok' }), ['echo', 'ok']);
  });
  it('AT-VRP-006: empty for missing/blank entries', () => {
    assert.deepEqual(resolveEvidenceArgv({}), []);
    assert.deepEqual(resolveEvidenceArgv({ command: '   ' }), []);
    assert.deepEqual(resolveEvidenceArgv({ argv: [] }), []);
  });
});

describe('replayVerificationMachineEvidence — security', () => {
  it('AT-VRP-007: fail-safe default — does NOT execute without opt-in', () => {
    const verification = { machine_evidence: [{ command: 'echo ok', exit_code: 0 }] };
    const payload = replayVerificationMachineEvidence({ root: process.cwd(), verification });
    assert.equal(payload.overall, 'not_executed');
    assert.equal(payload.commands[0].executed, false);
    assert.match(payload.reason, /not executed unless explicitly enabled/i);
  });

  it('AT-VRP-008: with opt-in, executes via argv and matches the declared exit code', () => {
    const root = mkdtempSync(join(tmpdir(), 'axc-vrp-sec-'));
    try {
      const verification = { machine_evidence: [{ argv: [process.execPath, '-e', 'process.exit(0)'], exit_code: 0 }] };
      const payload = replayVerificationMachineEvidence({ root, verification, allowCommandExecution: true });
      assert.equal(payload.commands[0].executed, true);
      assert.equal(payload.commands[0].actual_exit_code, 0);
      assert.equal(payload.commands[0].matched, true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('AT-VRP-009: shell injection is neutralized — chaining cannot create a file', () => {
    const root = mkdtempSync(join(tmpdir(), 'axc-vrp-inj-'));
    try {
      // With shell:true this would chain `touch PWNED`. With shell:false + tokenization,
      // `true` runs with the rest as literal argv, so no PWNED file is ever created.
      const verification = { machine_evidence: [{ command: 'true ; touch PWNED', exit_code: 0 }] };
      replayVerificationMachineEvidence({ root, verification, allowCommandExecution: true });
      assert.equal(existsSync(join(root, 'PWNED')), false, 'shell injection must not create a file');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
