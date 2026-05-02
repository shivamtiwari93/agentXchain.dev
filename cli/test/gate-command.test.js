import { strict as assert } from 'node:assert';
import { describe, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..');
const CLI_BIN = join(ROOT, 'cli', 'bin', 'agentxchain.js');

function runCli(cwd, args) {
  return spawnSync(process.execPath, [CLI_BIN, ...args], {
    cwd,
    encoding: 'utf8',
    timeout: 15000,
  });
}

function createGovernedProject(extraArgs = []) {
  const dir = mkdtempSync(join(tmpdir(), 'agentxchain-gate-'));
  const init = runCli(ROOT, ['init', '--governed', '--dir', dir, '-y', ...extraArgs]);
  assert.equal(init.status, 0, init.stderr || init.stdout);
  return dir;
}

function writeConfig(dir, mutate) {
  const configPath = join(dir, 'agentxchain.json');
  const config = JSON.parse(readFileSync(configPath, 'utf8'));
  mutate(config);
  writeFileSync(configPath, JSON.stringify(config, null, 2));
}

describe('agentxchain gate command', () => {
  it('AT-GATE-001: gate list prints all defined gates with phase linkage', () => {
    const dir = createGovernedProject();
    try {
      const result = runCli(dir, ['gate', 'list']);
      assert.equal(result.status, 0, result.stderr || result.stdout);
      assert.match(result.stdout, /Gates \(3\)/);
      assert.match(result.stdout, /planning_signoff/);
      assert.match(result.stdout, /implementation_complete/);
      assert.match(result.stdout, /qa_ship_verdict/);
      assert.match(result.stdout, /planning/);
      assert.match(result.stdout, /human-approval/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('AT-GATE-002: gate list --json returns array with correct gate IDs and linked phases', () => {
    const dir = createGovernedProject();
    try {
      const result = runCli(dir, ['gate', 'list', '--json']);
      assert.equal(result.status, 0, result.stderr || result.stdout);
      const payload = JSON.parse(result.stdout);
      assert.ok(Array.isArray(payload.gates));
      const ids = payload.gates.map((g) => g.id);
      assert.ok(ids.includes('planning_signoff'));
      assert.ok(ids.includes('implementation_complete'));
      assert.ok(ids.includes('qa_ship_verdict'));

      const planningGate = payload.gates.find((g) => g.id === 'planning_signoff');
      assert.equal(planningGate.linked_phase, 'planning');
      assert.equal(planningGate.requires_human_approval, true);
      assert.ok(Array.isArray(planningGate.requires_files));
      assert.ok(planningGate.requires_files.length > 0);

      const implGate = payload.gates.find((g) => g.id === 'implementation_complete');
      assert.equal(implGate.linked_phase, 'implementation');
      assert.equal(implGate.requires_verification_pass, true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('AT-GATE-003: gate show <id> text output shows predicates, phase, and approval', () => {
    const dir = createGovernedProject();
    try {
      const result = runCli(dir, ['gate', 'show', 'planning_signoff']);
      assert.equal(result.status, 0, result.stderr || result.stdout);
      assert.match(result.stdout, /Gate: planning_signoff/);
      assert.match(result.stdout, /Linked phase:.*planning/);
      assert.match(result.stdout, /Human approval:.*yes/);
      assert.match(result.stdout, /Effective artifacts:/);
      assert.match(result.stdout, /PM_SIGNOFF\.md/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('AT-GATE-004: gate show <id> --json returns structured gate object', () => {
    const dir = createGovernedProject();
    try {
      const result = runCli(dir, ['gate', 'show', 'qa_ship_verdict', '--json']);
      assert.equal(result.status, 0, result.stderr || result.stdout);
      const gate = JSON.parse(result.stdout);
      assert.equal(gate.id, 'qa_ship_verdict');
      assert.equal(gate.linked_phase, 'qa');
      assert.equal(gate.requires_human_approval, true);
      assert.ok(gate.requires_files.includes('.planning/acceptance-matrix.md'));
      assert.ok(gate.requires_files.includes('.planning/ship-verdict.md'));
      assert.ok(gate.requires_files.includes('.planning/RELEASE_NOTES.md'));
      // Gate status may be 'pending' (initialized by scaffold) or null
      assert.ok(gate.status === null || gate.status === 'pending', `unexpected gate status: ${gate.status}`);
      assert.equal(gate.last_failure, null);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('AT-GATE-005: gate show <id> --evaluate reflects semantic and ownership failures from the real gate contract', () => {
    const dir = createGovernedProject();
    try {
      const result = runCli(dir, ['gate', 'show', 'planning_signoff', '--evaluate', '--json']);
      assert.equal(result.status, 0, result.stderr || result.stdout);
      const gate = JSON.parse(result.stdout);
      assert.ok(gate.evaluation, 'evaluation field must be present with --evaluate');
      assert.ok(Array.isArray(gate.evaluation.artifacts));
      assert.equal(gate.evaluation.passed, false, 'fresh scaffold planning gate should not evaluate as passed');
      assert.ok(Array.isArray(gate.evaluation.semantic_failures));
      assert.ok(
        gate.evaluation.semantic_failures.some((reason) => /Approved: NO|Approved: YES/i.test(reason)),
        `expected PM signoff semantic failure, got: ${gate.evaluation.semantic_failures.join('\n')}`,
      );

      const pmSignoff = gate.evaluation.artifacts.find((f) => f.path === '.planning/PM_SIGNOFF.md');
      assert.ok(pmSignoff, 'PM_SIGNOFF.md must appear in evaluation');
      assert.equal(pmSignoff.exists, true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('AT-GATE-006: unknown gate ID exits 1 with available gate list', () => {
    const dir = createGovernedProject();
    try {
      const result = runCli(dir, ['gate', 'show', 'nonexistent']);
      assert.equal(result.status, 1);
      assert.match(result.stdout, /Unknown gate: nonexistent/);
      assert.match(result.stdout, /Available:.*planning_signoff/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('AT-GATE-007: gate commands fail closed on repos without governed config', () => {
    const dir = mkdtempSync(join(tmpdir(), 'agentxchain-gate-ungov-'));
    try {
      // No agentxchain.json at all
      const listResult = runCli(dir, ['gate', 'list']);
      assert.equal(listResult.status, 1);
      assert.match(listResult.stdout, /No agentxchain\.json|init/i);

      const showResult = runCli(dir, ['gate', 'show', 'planning_signoff']);
      assert.equal(showResult.status, 1);
      assert.match(showResult.stdout, /No agentxchain\.json|init/i);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('AT-GATE-008: legacy v3 repo exits 1 with "requires v4 config" message', () => {
    const dir = mkdtempSync(join(tmpdir(), 'agentxchain-gate-legacy-'));
    try {
      writeFileSync(join(dir, 'agentxchain.json'), JSON.stringify({
        version: 3,
        project: 'legacy-test',
        agents: { dev: { name: 'Developer', mandate: 'Write code' } },
        log: '.agentxchain/log.md',
        talk_file: 'TALK.md',
        state_file: '.agentxchain/state.json',
        history_file: '.agentxchain/history.jsonl',
        rules: { max_consecutive_claims: 3 },
      }));

      const listResult = runCli(dir, ['gate', 'list']);
      assert.equal(listResult.status, 1);
      assert.match(listResult.stdout, /v4 config|governed/i);

      const showResult = runCli(dir, ['gate', 'show', 'planning_signoff']);
      assert.equal(showResult.status, 1);
      assert.match(showResult.stdout, /v4 config|governed/i);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('AT-GATE-009: gate inspection includes workflow-kit additive artifacts beyond gates.requires_files', () => {
    const dir = createGovernedProject();
    try {
      writeConfig(dir, (config) => {
        config.workflow_kit = config.workflow_kit || {};
        config.workflow_kit.phases = config.workflow_kit.phases || {};
        config.workflow_kit.phases.planning = config.workflow_kit.phases.planning || {};
        config.workflow_kit.phases.planning.artifacts = [
          ...(config.workflow_kit.phases.planning.artifacts || []),
          {
            path: '.planning/ARCHITECTURE.md',
            required: true,
            owned_by: 'pm',
            semantics: 'section_check',
            semantics_config: {
              required_sections: ['## Purpose'],
            },
          },
        ];
      });

      mkdirSync(join(dir, '.planning'), { recursive: true });
      writeFileSync(join(dir, '.planning', 'ARCHITECTURE.md'), '# Architecture\n');

      const result = runCli(dir, ['gate', 'show', 'planning_signoff', '--evaluate', '--json']);
      assert.equal(result.status, 0, result.stderr || result.stdout);

      const gate = JSON.parse(result.stdout);
      assert.ok(
        gate.effective_artifacts.some((artifact) => artifact.path === '.planning/ARCHITECTURE.md'),
        'effective artifact contract must include workflow-kit additive artifact',
      );
      assert.ok(
        gate.evaluation.artifacts.some((artifact) => artifact.path === '.planning/ARCHITECTURE.md'),
        'evaluated artifact list must include workflow-kit additive artifact',
      );
      assert.ok(
        gate.evaluation.semantic_failures.some((reason) => /Document must contain sections: ## Purpose/i.test(reason)),
        `expected additive semantic failure, got: ${gate.evaluation.semantic_failures.join('\n')}`,
      );
      assert.ok(
        gate.evaluation.ownership_failures.some((reason) => /requires participation from role "pm"/i.test(reason)),
        `expected additive ownership failure, got: ${gate.evaluation.ownership_failures.join('\n')}`,
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
