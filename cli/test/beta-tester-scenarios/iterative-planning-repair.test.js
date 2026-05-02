/**
 * BUG-33 beta-tester coverage: iterative planning repair on durable
 * planning artifacts must accept cleanly across repeated PM turns.
 */

import { describe, it, afterEach } from 'vitest';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execSync } from 'node:child_process';

import {
  initializeGovernedRun,
  assignGovernedTurn,
  acceptGovernedTurn,
  normalizeGovernedStateShape,
} from '../../src/lib/governed-state.js';
import { getTurnStagingResultPath } from '../../src/lib/turn-paths.js';
import {
  evaluateWorkflowGateSemantics,
  evaluateArtifactSemantics,
} from '../../src/lib/workflow-gate-semantics.js';

const tempDirs = [];

function makeConfig() {
  return {
    schema_version: 4,
    protocol_mode: 'governed',
    project: { id: 'iterative-planning-repair', name: 'Iterative Planning Repair', default_branch: 'main' },
    roles: {
      pm: {
        title: 'PM',
        mandate: 'Plan',
        write_authority: 'authoritative',
        runtime_class: 'local_cli',
        runtime_id: 'local-pm',
      },
    },
    runtimes: {
      'local-pm': { type: 'local_cli', command: ['echo', 'pm'], prompt_transport: 'dispatch_bundle_only' },
    },
    phases: [{ id: 'planning', name: 'Planning' }],
    routing: {
      planning: {
        entry_role: 'pm',
        allowed_next_roles: ['pm'],
        exit_gate: 'planning_signoff',
      },
    },
    gates: {
      planning_signoff: {
        requires_files: ['.planning/SYSTEM_SPEC.md', '.planning/command-surface.md'],
      },
    },
    workflow_kit: {
      phases: {
        planning: {
          artifacts: [
            { path: '.planning/SYSTEM_SPEC.md', required: true, semantics: 'system_spec', owned_by: 'pm' },
            {
              path: '.planning/command-surface.md',
              required: true,
              semantics: 'section_check',
              semantics_config: {
                required_sections: ['## Primary Commands', '## Flags And Options', '## Failure UX'],
              },
              owned_by: 'pm',
            },
          ],
        },
      },
    },
  };
}

function createProject(config) {
  const root = mkdtempSync(join(tmpdir(), 'axc-iterative-planning-'));
  tempDirs.push(root);
  mkdirSync(join(root, '.agentxchain', 'staging'), { recursive: true });
  mkdirSync(join(root, '.planning'), { recursive: true });
  writeFileSync(join(root, 'agentxchain.json'), JSON.stringify(config, null, 2));
  writeFileSync(join(root, 'README.md'), '# Test\n');
  execSync('git init && git config user.email "test@test.com" && git config user.name "Test"', { cwd: root, stdio: 'ignore' });
  execSync('git add -A && git commit -m "init"', { cwd: root, stdio: 'ignore' });
  return root;
}

function readState(root) {
  return normalizeGovernedStateShape(JSON.parse(readFileSync(join(root, '.agentxchain', 'state.json'), 'utf8'))).state;
}

function stagePmTurn(root, state, turnId, summary, filesChanged) {
  mkdirSync(join(root, '.agentxchain', 'staging', turnId), { recursive: true });
  writeFileSync(join(root, getTurnStagingResultPath(turnId)), JSON.stringify({
    schema_version: '1.0',
    run_id: state.run_id,
    turn_id: turnId,
    role: 'pm',
    runtime_id: 'local-pm',
    status: 'completed',
    summary,
    decisions: [],
    objections: [],
    files_changed: filesChanged,
    verification: { status: 'pass' },
    artifact: { type: 'workspace', ref: null },
    proposed_next_role: 'pm',
  }, null, 2));
}

function checkpointWorkspace(root, message) {
  execSync('git add -A', { cwd: root, stdio: 'ignore' });
  execSync(`git commit -m ${JSON.stringify(message)}`, { cwd: root, stdio: 'ignore' });
}

afterEach(() => {
  while (tempDirs.length > 0) {
    try { rmSync(tempDirs.pop(), { recursive: true, force: true }); } catch {}
  }
});

describe('BUG-33 beta-tester coverage: iterative planning repair flow', () => {
  it('accepts repeated PM repairs on SYSTEM_SPEC.md and command-surface.md without conflict', () => {
    const config = makeConfig();
    const root = createProject(config);

    const initResult = initializeGovernedRun(root, config);
    assert.ok(initResult.ok, `Init failed: ${initResult.error}`);

    const initialAssign = assignGovernedTurn(root, config, 'pm');
    assert.ok(initialAssign.ok, `Initial assign failed: ${initialAssign.error}`);

    writeFileSync(
      join(root, '.planning', 'SYSTEM_SPEC.md'),
      '# System Spec\n\n## Purpose\n\nPlan the slice.\n\n## Acceptance Tests\n\n- [ ] Planning is defined.\n',
    );
    writeFileSync(
      join(root, '.planning', 'command-surface.md'),
      '# Command Surface\n\n## Primary Commands\n\n- `agentxchain run`\n',
    );
    stagePmTurn(
      root,
      initialAssign.state,
      initialAssign.turn.turn_id,
      'Created initial planning artifacts.',
      ['.planning/SYSTEM_SPEC.md', '.planning/command-surface.md'],
    );
    checkpointWorkspace(root, 'pm initial planning');

    const firstAccept = acceptGovernedTurn(root, config, { turnId: initialAssign.turn.turn_id });
    assert.ok(firstAccept.ok, `Initial accept failed: ${firstAccept.error}`);
    assert.equal(evaluateWorkflowGateSemantics(root, '.planning/SYSTEM_SPEC.md').ok, false, 'initial SYSTEM_SPEC must fail the planning semantics check');
    assert.equal(
      evaluateArtifactSemantics(root, {
        path: '.planning/command-surface.md',
        semantics: 'section_check',
        semantics_config: { required_sections: ['## Primary Commands', '## Flags And Options', '## Failure UX'] },
      }).ok,
      false,
      'initial command-surface must fail the planning semantics check',
    );

    const repairAssign = assignGovernedTurn(root, config, 'pm');
    assert.ok(repairAssign.ok, `Repair assign failed: ${repairAssign.error}`);

    writeFileSync(
      join(root, '.planning', 'SYSTEM_SPEC.md'),
      '# System Spec\n\n## Purpose\n\nPlan the slice.\n\n## Interface\n\n- Governed planning artifacts.\n\n## Acceptance Tests\n\n- [ ] Planning is defined.\n',
    );
    writeFileSync(
      join(root, '.planning', 'command-surface.md'),
      '# Command Surface\n\n## Primary Commands\n\n- `agentxchain run`\n\n## Flags And Options\n\n- `--phase`\n\n## Failure UX\n\n- Report actionable errors.\n',
    );
    stagePmTurn(
      root,
      repairAssign.state,
      repairAssign.turn.turn_id,
      'Repaired the planning artifacts to satisfy the gate.',
      ['.planning/SYSTEM_SPEC.md', '.planning/command-surface.md'],
    );
    checkpointWorkspace(root, 'pm planning repair');

    const repairAccept = acceptGovernedTurn(root, config, { turnId: repairAssign.turn.turn_id });
    assert.ok(repairAccept.ok, `Repair accept failed: ${repairAccept.error}`);

    const secondRepairAssign = assignGovernedTurn(root, config, 'pm');
    assert.ok(secondRepairAssign.ok, `Second repair assign failed: ${secondRepairAssign.error}`);

    writeFileSync(
      join(root, '.planning', 'SYSTEM_SPEC.md'),
      '# System Spec\n\n## Purpose\n\nPlan the slice.\n\n## Interface\n\n- Governed planning artifacts.\n- Recovery path for repeated PM repairs.\n\n## Acceptance Tests\n\n- [ ] Planning is defined.\n',
    );
    stagePmTurn(
      root,
      secondRepairAssign.state,
      secondRepairAssign.turn.turn_id,
      'Extended the planning artifact again in a later PM repair turn.',
      ['.planning/SYSTEM_SPEC.md'],
    );
    checkpointWorkspace(root, 'pm planning repair v2');

    const secondRepairAccept = acceptGovernedTurn(root, config, { turnId: secondRepairAssign.turn.turn_id });
    assert.ok(secondRepairAccept.ok, `Second repair accept failed: ${secondRepairAccept.error}`);

    const history = readFileSync(join(root, '.agentxchain', 'history.jsonl'), 'utf8')
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line));
    assert.equal(history.length, 3, 'all three PM turns must accept cleanly');
  });
});
