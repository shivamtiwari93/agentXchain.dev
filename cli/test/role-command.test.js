import { strict as assert } from 'node:assert';
import { describe, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
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

function createDecisionAuthorityProject() {
  const dir = createGovernedProject();
  const configPath = join(dir, 'agentxchain.json');
  const config = JSON.parse(readFileSync(configPath, 'utf8'));
  config.roles.dev.decision_authority = 20;
  writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n');
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
      assert.equal(role.runtime_contract.transport, 'manual');
      assert.equal(role.runtime_contract.can_write_files, 'direct');
      assert.equal(role.effective_runtime_contract.effective_write_path, 'direct');
      assert.equal(role.effective_runtime_contract.workflow_artifact_ownership, 'yes');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('AT-ROLE-004B: role show surfaces proposal-only runtime truth for remote review roles', () => {
    const dir = createGovernedProject();
    try {
      const configPath = join(dir, 'agentxchain.json');
      const config = JSON.parse(readFileSync(configPath, 'utf8'));
      config.runtimes['remote-qa'] = { type: 'remote_agent', url: 'https://example.com/turn' };
      config.roles.qa.runtime = 'remote-qa';
      config.roles.qa.write_authority = 'review_only';
      writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n');

      const result = runCli(dir, ['role', 'show', 'qa', '--json']);
      assert.equal(result.status, 0, result.stderr || result.stdout);
      const role = JSON.parse(result.stdout);
      assert.equal(role.runtime_contract.transport, 'remote_http');
      assert.equal(role.runtime_contract.workflow_artifact_ownership, 'proposal_apply_required');
      assert.equal(role.effective_runtime_contract.effective_write_path, 'review_artifact_only');
      assert.equal(role.effective_runtime_contract.workflow_artifact_ownership, 'no');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('AT-ROLE-004E: role show surfaces declared direct-write MCP truth for authoritative roles', () => {
    const dir = createGovernedProject();
    try {
      const configPath = join(dir, 'agentxchain.json');
      const config = JSON.parse(readFileSync(configPath, 'utf8'));
      config.runtimes['mcp-dev'] = {
        type: 'mcp',
        command: ['node', '-e', 'process.exit(0)'],
        capabilities: {
          can_write_files: 'direct',
          workflow_artifact_ownership: 'yes',
        },
      };
      config.roles.dev.runtime = 'mcp-dev';
      config.roles.dev.write_authority = 'authoritative';
      writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n');

      const result = runCli(dir, ['role', 'show', 'dev', '--json']);
      assert.equal(result.status, 0, result.stderr || result.stdout);
      const role = JSON.parse(result.stdout);
      assert.equal(role.runtime_contract.transport, 'mcp_stdio');
      assert.equal(role.runtime_contract.can_write_files, 'direct');
      assert.equal(role.effective_runtime_contract.effective_write_path, 'direct');
      assert.equal(role.effective_runtime_contract.workflow_artifact_ownership, 'yes');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('AT-ROLE-004A: role show prints decision authority when configured', () => {
    const dir = createDecisionAuthorityProject();
    try {
      const result = runCli(dir, ['role', 'show', 'dev']);
      assert.equal(result.status, 0, result.stderr || result.stdout);
      assert.match(result.stdout, /Decision:\s+20/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('AT-ROLE-004C: role list --json returns normalized decision authority when configured', () => {
    const dir = createDecisionAuthorityProject();
    try {
      const result = runCli(dir, ['role', 'list', '--json']);
      assert.equal(result.status, 0, result.stderr || result.stdout);

      const roles = JSON.parse(result.stdout);
      const dev = roles.find((role) => role.id === 'dev');
      assert.ok(dev, 'dev role should be present');
      assert.equal(dev.decision_authority, 20);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('AT-ROLE-004D: role show --json returns normalized decision authority when configured', () => {
    const dir = createDecisionAuthorityProject();
    try {
      const result = runCli(dir, ['role', 'show', 'dev', '--json']);
      assert.equal(result.status, 0, result.stderr || result.stdout);

      const role = JSON.parse(result.stdout);
      assert.equal(role.id, 'dev');
      assert.equal(role.decision_authority, 20);
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
