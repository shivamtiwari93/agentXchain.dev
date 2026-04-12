import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..', '..');

const CLI_DOCS = readFileSync(join(REPO_ROOT, 'website-v2', 'docs', 'cli.mdx'), 'utf8');
const GETTING_STARTED = readFileSync(join(REPO_ROOT, 'website-v2', 'docs', 'getting-started.mdx'), 'utf8');
const PROBE_SPEC = readFileSync(join(REPO_ROOT, '.planning', 'CONNECTOR_PROBE_COMMAND_SPEC.md'), 'utf8');
const README = readFileSync(join(REPO_ROOT, 'README.md'), 'utf8');
const INIT_CMD = readFileSync(join(REPO_ROOT, 'cli', 'src', 'commands', 'init.js'), 'utf8');
const DEMO_CMD = readFileSync(join(REPO_ROOT, 'cli', 'src', 'commands', 'demo.js'), 'utf8');

describe('connector check docs/content surface', () => {
  it('AT-CCP-008: docs distinguish doctor readiness from connector live probes', () => {
    assert.match(CLI_DOCS, /`connector check` \| Readiness \| Run live connector probes/);
    assert.match(CLI_DOCS, /`doctor` is a static readiness check/i);
    assert.match(CLI_DOCS, /Use `agentxchain connector check` when you want a real live probe/i);
    assert.match(GETTING_STARTED, /agentxchain connector check/);
    assert.match(GETTING_STARTED, /`doctor` checks config, binaries, env vars, and repo state/i);
  });

  it('governed front door surfaces include connector check between doctor and first turn', () => {
    // init.js next-step output
    assert.match(INIT_CMD, /agentxchain connector check/,
      'init --governed next-step output must include connector check');
    // demo.js handoff output
    assert.match(DEMO_CMD, /agentxchain connector check/,
      'demo handoff next-steps must include connector check');
    // README quick start
    assert.match(README, /agentxchain connector check/,
      'README quick start must include connector check');
  });

  it('ships a standalone connector probe spec', () => {
    assert.match(PROBE_SPEC, /Connector Probe Command Spec/);
    assert.match(PROBE_SPEC, /AT-CCP-001/);
    assert.match(PROBE_SPEC, /AT-CCP-008/);
  });
});
