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

function createGovernedProject() {
  const dir = mkdtempSync(join(tmpdir(), 'agentxchain-role-'));
  const init = runCli(ROOT, ['init', '--governed', '--dir', dir, '-y']);
  assert.equal(init.status, 0, init.stderr || init.stdout);
  return dir;
}

describe('agentxchain role command', () => {
  it('AT-ROLE-001: role list shows all roles with title, authority, and runtime', () => {
    const dir = createGovernedProject();
    try {
      const result = runCli(dir, ['role', 'list']);
      assert.equal(result.status, 0, result.stderr || result.stdout);
      assert.match(result.stdout, /Roles \(\d+\)/);
      assert.match(result.stdout, /pm/);
      assert.match(result.stdout, /dev/);
      assert.match(result.stdout, /qa/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('AT-ROLE-002: role list --json returns valid JSON array with correct fields', () => {
    const dir = createGovernedProject();
    try {
      const result = runCli(dir, ['role', 'list', '--json']);
      assert.equal(result.status, 0, result.stderr || result.stdout);

      const roles = JSON.parse(result.stdout);
      assert.ok(Array.isArray(roles));
      assert.ok(roles.length >= 3, 'should have at least pm, dev, qa');

      for (const role of roles) {
        assert.ok(role.id, 'each role must have an id');
        assert.ok(role.title, 'each role must have a title');
        assert.ok(role.mandate, 'each role must have a mandate');
        assert.ok(role.write_authority, 'each role must have write_authority');
        assert.ok(role.runtime, 'each role must have a runtime');
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('AT-ROLE-003: role show <id> shows detailed role information', () => {
    const dir = createGovernedProject();
    try {
      const result = runCli(dir, ['role', 'show', 'dev']);
      assert.equal(result.status, 0, result.stderr || result.stdout);
      assert.match(result.stdout, /Role:.*dev/);
      assert.match(result.stdout, /Title:/);
      assert.match(result.stdout, /Mandate:/);
      assert.match(result.stdout, /Authority:/);
      assert.match(result.stdout, /Runtime:/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('AT-ROLE-004: role show <id> --json returns valid JSON object', () => {
    const dir = createGovernedProject();
    try {
      const result = runCli(dir, ['role', 'show', 'dev', '--json']);
      assert.equal(result.status, 0, result.stderr || result.stdout);

      const role = JSON.parse(result.stdout);
      assert.equal(role.id, 'dev');
      assert.ok(role.title);
      assert.ok(role.mandate);
      assert.ok(role.write_authority);
      assert.ok(role.runtime);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('AT-ROLE-005: role show <unknown> exits 1 with helpful error', () => {
    const dir = createGovernedProject();
    try {
      const result = runCli(dir, ['role', 'show', 'nonexistent']);
      assert.equal(result.status, 1);
      assert.match(result.stdout, /Unknown role: nonexistent/);
      assert.match(result.stdout, /Available:/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('AT-ROLE-006: role commands fail on repos with no config file', () => {
    const dir = mkdtempSync(join(tmpdir(), 'agentxchain-role-ungoverned-'));
    try {
      const result = runCli(dir, ['role', 'list']);
      assert.equal(result.status, 1);
      assert.match(result.stdout, /No agentxchain\.json found/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('AT-ROLE-007: role commands fail on legacy v3 repos with clear version message', () => {
    const dir = mkdtempSync(join(tmpdir(), 'agentxchain-role-legacy-'));
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

      const listResult = runCli(dir, ['role', 'list']);
      assert.equal(listResult.status, 1, 'role list should exit 1 on legacy repo');
      assert.match(listResult.stdout, /v4 config|governed/i, 'should mention v4 or governed requirement');

      const showResult = runCli(dir, ['role', 'show', 'dev']);
      assert.equal(showResult.status, 1, 'role show should exit 1 on legacy repo');
      assert.match(showResult.stdout, /v4 config|governed/i, 'should mention v4 or governed requirement');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
