import { describe, it } from 'vitest';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

import { validateV4Config } from '../src/lib/normalized-config.js';

// Read the source to verify the runtime type is registered
const configSrc = readFileSync(join(__dirname, '..', 'src', 'lib', 'normalized-config.js'), 'utf8');

function makeValidConfig(runtimeOverrides = {}) {
  return {
    schema_version: 4,
    protocol_mode: 'governed',
    project: { id: 'test', name: 'Test', default_branch: 'main' },
    roles: {
      reviewer: {
        title: 'Reviewer',
        mandate: 'Review.',
        write_authority: 'review_only',
        runtime: 'remote-review',
      },
    },
    runtimes: {
      'remote-review': {
        type: 'remote_agent',
        url: 'https://agent.example.com/turn',
        ...runtimeOverrides,
      },
    },
    routing: { implementation: { entry_role: 'reviewer' } },
    gates: {},
    budget: { per_turn_max_usd: 2, per_run_max_usd: 10 },
    rules: { challenge_required: false },
    files: { talk: 'TALK.md', history: '.agentxchain/history.jsonl', state: '.agentxchain/state.json' },
  };
}

function makeRoleConfig(writeAuthority) {
  const config = makeValidConfig();
  config.roles.reviewer.write_authority = writeAuthority;
  return config;
}

describe('remote_agent config validation', () => {
  it('remote_agent is in VALID_RUNTIME_TYPES', () => {
    assert.ok(
      configSrc.includes("'remote_agent'"),
      'normalized-config.js must include remote_agent in VALID_RUNTIME_TYPES',
    );
  });

  it('accepts a valid remote_agent runtime config', () => {
    const config = makeValidConfig();
    const result = validateV4Config(config);
    assert.ok(result.ok, `Expected valid, got errors: ${JSON.stringify(result.errors)}`);
  });

  it('accepts remote_agent with optional headers', () => {
    const config = makeValidConfig({
      headers: {
        authorization: 'Bearer token123',
        'x-custom': 'value',
      },
    });
    const result = validateV4Config(config);
    assert.ok(result.ok, `Expected valid, got errors: ${JSON.stringify(result.errors)}`);
  });

  it('accepts remote_agent with optional timeout_ms', () => {
    const config = makeValidConfig({ timeout_ms: 60000 });
    const result = validateV4Config(config);
    assert.ok(result.ok, `Expected valid, got errors: ${JSON.stringify(result.errors)}`);
  });

  it('accepts remote_agent with proposed write authority', () => {
    const config = makeRoleConfig('proposed');
    const result = validateV4Config(config);
    assert.ok(result.ok, `Expected valid, got errors: ${JSON.stringify(result.errors)}`);
  });

  it('rejects remote_agent with authoritative write authority', () => {
    const config = makeRoleConfig('authoritative');
    const result = validateV4Config(config);
    assert.equal(result.ok, false);
    assert.ok(result.errors.some(e => e.includes('remote_agent only supports review_only and proposed roles')));
  });

  it('rejects remote_agent without url', () => {
    const config = makeValidConfig();
    delete config.runtimes['remote-review'].url;
    const result = validateV4Config(config);
    assert.equal(result.ok, false);
    assert.ok(result.errors.some(e => e.includes('requires "url"')));
  });

  it('rejects remote_agent with empty url', () => {
    const config = makeValidConfig({ url: '' });
    const result = validateV4Config(config);
    assert.equal(result.ok, false);
    assert.ok(result.errors.some(e => e.includes('requires "url"')));
  });

  it('rejects remote_agent with non-http url', () => {
    const config = makeValidConfig({ url: 'ftp://agent.example.com/turn' });
    const result = validateV4Config(config);
    assert.equal(result.ok, false);
    assert.ok(result.errors.some(e => e.includes('http or https')));
  });

  it('rejects remote_agent with invalid url', () => {
    const config = makeValidConfig({ url: 'not a url' });
    const result = validateV4Config(config);
    assert.equal(result.ok, false);
    assert.ok(result.errors.some(e => e.includes('valid absolute URL')));
  });

  it('rejects remote_agent with non-object headers', () => {
    const config = makeValidConfig({ headers: 'bad' });
    const result = validateV4Config(config);
    assert.equal(result.ok, false);
    assert.ok(result.errors.some(e => e.includes('headers must be an object')));
  });

  it('rejects remote_agent with non-string header values', () => {
    const config = makeValidConfig({ headers: { 'x-key': 123 } });
    const result = validateV4Config(config);
    assert.equal(result.ok, false);
    assert.ok(result.errors.some(e => e.includes('headers["x-key"]')));
  });

  it('rejects remote_agent with non-integer timeout_ms', () => {
    const config = makeValidConfig({ timeout_ms: 1.5 });
    const result = validateV4Config(config);
    assert.equal(result.ok, false);
    assert.ok(result.errors.some(e => e.includes('timeout_ms must be a positive integer')));
  });

  it('rejects remote_agent with zero timeout_ms', () => {
    const config = makeValidConfig({ timeout_ms: 0 });
    const result = validateV4Config(config);
    assert.equal(result.ok, false);
    assert.ok(result.errors.some(e => e.includes('timeout_ms must be a positive integer')));
  });

  it('rejects remote_agent with negative timeout_ms', () => {
    const config = makeValidConfig({ timeout_ms: -1000 });
    const result = validateV4Config(config);
    assert.equal(result.ok, false);
    assert.ok(result.errors.some(e => e.includes('timeout_ms must be a positive integer')));
  });
});
