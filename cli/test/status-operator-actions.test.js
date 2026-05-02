import assert from 'node:assert/strict';
import { describe, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deriveConflictedTurnResolutionActions } from '../src/lib/conflict-actions.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const statusSource = readFileSync(join(__dirname, '..', 'src', 'commands', 'status.js'), 'utf8');
const stepSource = readFileSync(join(__dirname, '..', 'src', 'commands', 'step.js'), 'utf8');

describe('status operator action source contract', () => {
  it('AT-SOAS-001: conflicted-turn actions come from the shared helper', () => {
    assert.match(statusSource, /deriveConflictedTurnResolutionActions/);
    assert.match(stepSource, /deriveConflictedTurnResolutionActions/);
  });

  it('AT-SOAS-002: status no longer hardcodes pending approval action copy', () => {
    assert.doesNotMatch(statusSource, /Run \$\{chalk\.cyan\('agentxchain approve-transition'\)\} to advance/);
    assert.doesNotMatch(statusSource, /Run \$\{chalk\.cyan\('agentxchain approve-completion'\)\} to finalize/);
  });

  it('AT-SOAS-003: conflicted-turn helper returns both supported resolution commands', () => {
    const actions = deriveConflictedTurnResolutionActions('turn_conflict_01');
    assert.deepEqual(actions, [
      {
        command: 'agentxchain reject-turn --turn turn_conflict_01 --reassign',
        description: 'reject and re-dispatch with conflict context',
      },
      {
        command: 'agentxchain accept-turn --turn turn_conflict_01 --resolution human_merge',
        description: 'manually merge and re-accept',
      },
    ]);
  });
});
