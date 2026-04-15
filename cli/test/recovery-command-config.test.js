import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const cliRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const stepCommandPath = join(cliRoot, 'src', 'commands', 'step.js');
const acceptTurnCommandPath = join(cliRoot, 'src', 'commands', 'accept-turn.js');
const rejectTurnCommandPath = join(cliRoot, 'src', 'commands', 'reject-turn.js');

describe('recovery command config boundary', () => {
  it('AT-RCC-001: step recovery helpers and call sites pass normalized config', () => {
    const src = readFileSync(stepCommandPath, 'utf8');

    assert.match(
      src,
      /printRecoverySummary\(state,\s*'This run is awaiting approval\.',\s*config\)/,
      'step approval recovery output must pass config into the summary helper',
    );
    assert.match(
      src,
      /printRecoverySummary\(state,\s*'This run is blocked on a retained turn\.',\s*config\)/,
      'step blocked-turn recovery output must pass config into the summary helper',
    );
    assert.match(
      src,
      /function printRecoverySummary\(state,\s*heading,\s*config\)\s*\{\s*const recovery = deriveRecoveryDescriptor\(state,\s*config\)/s,
      'step recovery summary helper must pass config into deriveRecoveryDescriptor',
    );
    assert.match(
      src,
      /function printLifecycleHookFailure\(title,\s*result,\s*\{ turnId,\s*roleId,\s*action,\s*config \}\)\s*\{\s*const recovery = deriveRecoveryDescriptor\(result\.state,\s*config\)/s,
      'step lifecycle hook recovery output must pass config into deriveRecoveryDescriptor',
    );
    assert.match(
      src,
      /function printAssignmentHookFailure\(result,\s*roleId,\s*config\)\s*\{\s*const recovery = deriveRecoveryDescriptor\(result\.state,\s*config\)/s,
      'step assignment-hook recovery output must pass config into deriveRecoveryDescriptor',
    );
    assert.match(
      src,
      /function printAcceptedHookFailure\(result,\s*config\)\s*\{\s*const recovery = deriveRecoveryDescriptor\(result\.state,\s*config\)/s,
      'step accepted-hook recovery output must pass config into deriveRecoveryDescriptor',
    );
    assert.match(
      src,
      /function printAcceptSummary\(result,\s*config\)\s*\{\s*const accepted = result\.accepted;\s*const recovery = deriveRecoveryDescriptor\(result\.state,\s*config\)/s,
      'step acceptance summary must pass config into deriveRecoveryDescriptor',
    );
    assert.match(
      src,
      /function printEscalationSummary\(result,\s*config\)\s*\{\s*const recovery = deriveRecoveryDescriptor\(result\.state,\s*config\)/s,
      'step rejection-escalation summary must pass config into deriveRecoveryDescriptor',
    );
  });

  it('AT-RCC-002: accept-turn recovery surfaces pass normalized config', () => {
    const src = readFileSync(acceptTurnCommandPath, 'utf8');

    assert.match(
      src,
      /deriveRecoveryDescriptor\(result\.state,\s*config\)/,
      'accept-turn must use config-aware recovery rendering',
    );
    const deriveCalls = src.match(/deriveRecoveryDescriptor\(result\.state,\s*config\)/g) || [];
    assert.ok(
      deriveCalls.length >= 4,
      'accept-turn should pass config into every operator-facing recovery render',
    );
  });

  it('AT-RCC-003: reject-turn escalated recovery surfaces pass normalized config', () => {
    const src = readFileSync(rejectTurnCommandPath, 'utf8');

    assert.match(
      src,
      /deriveRecoveryDescriptor\(result\.state,\s*config\)/,
      'reject-turn escalation recovery output must pass config into deriveRecoveryDescriptor',
    );
  });
});
