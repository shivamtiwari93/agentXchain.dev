import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
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
  const dir = mkdtempSync(join(tmpdir(), 'agentxchain-phase-'));
  const init = runCli(ROOT, ['init', '--governed', '--dir', dir, '-y', ...extraArgs]);
  assert.equal(init.status, 0, init.stderr || init.stdout);
  return dir;
}

describe('agentxchain phase command', () => {
  it('AT-PHASE-001: phase list prints routing-ordered phases and marks the current phase', () => {
    const dir = createGovernedProject();
    try {
      const result = runCli(dir, ['phase', 'list']);
      assert.equal(result.status, 0, result.stderr || result.stdout);
      assert.match(result.stdout, /Phases \(3\)/);
      assert.match(result.stdout, /planning.*\[current\]/);
      assert.match(result.stdout, /implementation/);
      assert.match(result.stdout, /qa/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('AT-PHASE-002: phase list --json emits current phase plus structured phase entries', () => {
    const dir = createGovernedProject();
    try {
      const result = runCli(dir, ['phase', 'list', '--json']);
      assert.equal(result.status, 0, result.stderr || result.stdout);
      const payload = JSON.parse(result.stdout);
      assert.equal(payload.current_phase, 'planning');
      assert.deepEqual(payload.phases.map((phase) => phase.id), ['planning', 'implementation', 'qa']);
      assert.equal(payload.phases[0].is_current, true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('AT-PHASE-003: phase show --json defaults to the current phase and exposes default workflow-kit artifacts', () => {
    const dir = createGovernedProject();
    try {
      const result = runCli(dir, ['phase', 'show', '--json']);
      assert.equal(result.status, 0, result.stderr || result.stdout);
      const payload = JSON.parse(result.stdout);
      assert.equal(payload.id, 'planning');
      assert.equal(payload.is_current, true);
      assert.equal(payload.workflow_kit.source, 'default');
      assert.ok(payload.workflow_kit.artifacts.length > 0, 'default workflow-kit artifacts must be visible');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('AT-PHASE-004: phase show <phase> --json exposes explicit workflow-kit template and ownership', () => {
    const dir = createGovernedProject(['--template', 'enterprise-app']);
    try {
      const result = runCli(dir, ['phase', 'show', 'architecture', '--json']);
      assert.equal(result.status, 0, result.stderr || result.stdout);
      const payload = JSON.parse(result.stdout);
      assert.equal(payload.id, 'architecture');
      assert.equal(payload.workflow_kit.source, 'explicit');
      assert.equal(payload.workflow_kit.template, 'architecture-review');
      assert.equal(payload.workflow_kit.artifacts[0].owned_by, 'architect');
      assert.equal(payload.workflow_kit.artifacts[0].owner_resolution, 'explicit');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('AT-PHASE-005: phase show <unknown> exits 1 with available phase ids', () => {
    const dir = createGovernedProject();
    try {
      const result = runCli(dir, ['phase', 'show', 'nonexistent']);
      assert.equal(result.status, 1);
      assert.match(result.stdout, /Unknown phase: nonexistent/);
      assert.match(result.stdout, /Available: planning, implementation, qa/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('AT-PHASE-006: phase commands fail closed on legacy v3 repos with a governed message', () => {
    const dir = mkdtempSync(join(tmpdir(), 'agentxchain-phase-legacy-'));
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

      const listResult = runCli(dir, ['phase', 'list']);
      assert.equal(listResult.status, 1);
      assert.match(listResult.stdout, /v4 config|governed/i);

      const showResult = runCli(dir, ['phase', 'show', 'planning']);
      assert.equal(showResult.status, 1);
      assert.match(showResult.stdout, /v4 config|governed/i);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
