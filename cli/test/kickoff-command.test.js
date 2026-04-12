import { strict as assert } from 'node:assert';
import { afterEach, describe, it } from 'node:test';
import { spawnSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI_BIN = join(__dirname, '..', 'bin', 'agentxchain.js');

const tempDirs = new Set();

function createProject(opts = {}) {
  const dir = join(tmpdir(), `agentxchain-kickoff-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  tempDirs.add(dir);

  const config = {
    version: 3,
    project: opts.project ?? 'Kickoff Test',
    agents: opts.agents ?? {
      pm: { name: 'Product Manager', mandate: 'Plan work' },
      dev: { name: 'Developer', mandate: 'Build work' },
    },
    talk_file: 'TALK.md',
    state_file: 'state.md',
    history_file: 'history.jsonl',
  };

  writeFileSync(join(dir, 'agentxchain.json'), JSON.stringify(config, null, 2));
  writeFileSync(join(dir, 'TALK.md'), '');
  writeFileSync(join(dir, 'state.md'), '');
  writeFileSync(join(dir, 'history.jsonl'), '');

  return dir;
}

function runKickoff(cwd, args = []) {
  const result = spawnSync(process.execPath, [CLI_BIN, 'kickoff', ...args], {
    encoding: 'utf8',
    timeout: 15000,
    cwd,
    env: { ...process.env, FORCE_COLOR: '0' },
    // No stdin → inquirer will fail/hang, but early exits happen before prompts
    input: '',
  });
  return {
    stdout: result.stdout || '',
    stderr: result.stderr || '',
    status: result.status,
    combined: (result.stdout || '') + (result.stderr || ''),
  };
}

afterEach(() => {
  for (const d of tempDirs) {
    try { rmSync(d, { recursive: true, force: true }); } catch {}
  }
  tempDirs.clear();
});

describe('agentxchain kickoff', () => {
  it('AT-KICKOFF-001: missing project root exits non-zero', () => {
    const emptyDir = join(tmpdir(), `agentxchain-kickoff-empty-${Date.now()}`);
    mkdirSync(emptyDir, { recursive: true });
    tempDirs.add(emptyDir);

    const { status, combined } = runKickoff(emptyDir);
    assert.notStrictEqual(status, 0, `Expected non-zero exit but got ${status}`);
    assert.ok(
      combined.includes('agentxchain.json') || combined.includes('init'),
      `Expected init guidance but got:\n${combined}`
    );
  });

  it('AT-KICKOFF-002: empty agents exits non-zero', () => {
    const dir = createProject({ agents: {} });
    const { status, combined } = runKickoff(dir);
    assert.notStrictEqual(status, 0, `Expected non-zero exit but got ${status}`);
    assert.ok(
      combined.includes('No agents'),
      `Expected "No agents" message but got:\n${combined}`
    );
  });

  it('AT-KICKOFF-003: banner shows project name and PM agent ID', () => {
    const dir = createProject({ project: 'Kickoff Banner Test' });
    // kickoff will print the banner before hitting the interactive prompt
    // Since we pipe empty stdin, it will crash at inquirer, but we can still
    // check the banner output
    const { combined } = runKickoff(dir);
    assert.ok(
      combined.includes('Kickoff Banner Test'),
      `Expected project name in banner but got:\n${combined}`
    );
    assert.ok(
      combined.includes('pm'),
      `Expected PM agent ID in banner but got:\n${combined}`
    );
  });

  it('AT-KICKOFF-004: PM agent selection falls back to first agent when no pm key', () => {
    const dir = createProject({
      project: 'Fallback PM Test',
      agents: {
        lead: { name: 'Lead Engineer', mandate: 'Lead work' },
        qa: { name: 'QA', mandate: 'Test work' },
      },
    });
    const { combined } = runKickoff(dir);
    // Should pick 'lead' as first agent since no 'pm' key and no 'product manager' name
    assert.ok(
      combined.includes('lead'),
      `Expected fallback PM "lead" in banner but got:\n${combined}`
    );
  });
});
