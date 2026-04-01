import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  detectConfigVersion,
  validateV4Config,
  normalizeV3,
  normalizeV4,
  loadNormalizedConfig,
} from '../src/lib/normalized-config.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const loadFixture = (name) => JSON.parse(readFileSync(join(__dirname, 'fixtures', name), 'utf8'));

// --- detectConfigVersion ---

describe('detectConfigVersion', () => {
  it('detects legacy v3', () => {
    assert.equal(detectConfigVersion({ version: 3, project: 'x', agents: {} }), 3);
  });

  it('detects governed v4 with schema_version string', () => {
    assert.equal(detectConfigVersion({ schema_version: '1.0', project: {} }), 4);
  });

  it('detects governed v4 with schema_version number', () => {
    assert.equal(detectConfigVersion({ schema_version: 4, project: {} }), 4);
  });

  it('returns null for unrecognized', () => {
    assert.equal(detectConfigVersion({ version: 2 }), null);
    assert.equal(detectConfigVersion(null), null);
    assert.equal(detectConfigVersion({}), null);
  });
});

// --- validateV4Config ---

describe('validateV4Config', () => {
  it('validates a correct v4 config fixture', () => {
    const fixture = loadFixture('config-v4-governed.json');
    const result = validateV4Config(fixture);
    assert.equal(result.ok, true, `Unexpected errors: ${result.errors.join(', ')}`);
  });

  it('rejects missing project', () => {
    const result = validateV4Config({ schema_version: '1.0', roles: {}, runtimes: {} });
    assert.equal(result.ok, false);
    assert.ok(result.errors.some(e => e.includes('project')));
  });

  it('rejects role with invalid write_authority', () => {
    const result = validateV4Config({
      schema_version: '1.0',
      project: { id: 'x', name: 'X' },
      roles: { dev: { title: 'Dev', mandate: 'Build', write_authority: 'god_mode', runtime: 'r1' } },
      runtimes: { r1: { type: 'manual' } },
    });
    assert.equal(result.ok, false);
    assert.ok(result.errors.some(e => e.includes('write_authority')));
  });

  it('rejects role referencing unknown runtime', () => {
    const result = validateV4Config({
      schema_version: '1.0',
      project: { id: 'x', name: 'X' },
      roles: { dev: { title: 'Dev', mandate: 'Build', write_authority: 'authoritative', runtime: 'nonexistent' } },
      runtimes: {},
    });
    assert.equal(result.ok, false);
    assert.ok(result.errors.some(e => e.includes('unknown runtime')));
  });

  it('rejects invalid prompt_transport for local_cli runtime', () => {
    const result = validateV4Config({
      schema_version: '1.0',
      project: { id: 'test', name: 'Test' },
      roles: { dev: { title: 'Dev', mandate: 'Build.', write_authority: 'authoritative', runtime: 'local-dev' } },
      runtimes: { 'local-dev': { type: 'local_cli', command: ['claude'], prompt_transport: 'magic_pipe' } },
    });
    assert.equal(result.ok, false);
    assert.ok(result.errors.some(e => e.includes('prompt_transport')));
  });

  it('rejects argv transport without {prompt} placeholder', () => {
    const result = validateV4Config({
      schema_version: '1.0',
      project: { id: 'test', name: 'Test' },
      roles: { dev: { title: 'Dev', mandate: 'Build.', write_authority: 'authoritative', runtime: 'local-dev' } },
      runtimes: { 'local-dev': { type: 'local_cli', command: ['claude', '--print'], prompt_transport: 'argv' } },
    });
    assert.equal(result.ok, false);
    assert.ok(result.errors.some(e => e.includes('{prompt}')));
  });

  it('accepts valid argv transport with {prompt} placeholder', () => {
    const result = validateV4Config({
      schema_version: '1.0',
      project: { id: 'test', name: 'Test' },
      roles: { dev: { title: 'Dev', mandate: 'Build.', write_authority: 'authoritative', runtime: 'local-dev' } },
      runtimes: { 'local-dev': { type: 'local_cli', command: ['claude', '--print', '-p', '{prompt}'], prompt_transport: 'argv' } },
    });
    assert.equal(result.ok, true, `Unexpected errors: ${result.errors.join(', ')}`);
  });

  it('accepts stdin transport without {prompt} placeholder', () => {
    const result = validateV4Config({
      schema_version: '1.0',
      project: { id: 'test', name: 'Test' },
      roles: { dev: { title: 'Dev', mandate: 'Build.', write_authority: 'authoritative', runtime: 'local-dev' } },
      runtimes: { 'local-dev': { type: 'local_cli', command: ['claude', '--print'], prompt_transport: 'stdin' } },
    });
    assert.equal(result.ok, true, `Unexpected errors: ${result.errors.join(', ')}`);
  });

  it('accepts local_cli without prompt_transport (backwards compat)', () => {
    const result = validateV4Config({
      schema_version: '1.0',
      project: { id: 'test', name: 'Test' },
      roles: { dev: { title: 'Dev', mandate: 'Build.', write_authority: 'authoritative', runtime: 'local-dev' } },
      runtimes: { 'local-dev': { type: 'local_cli', command: ['claude', '--print'] } },
    });
    assert.equal(result.ok, true, `Unexpected errors: ${result.errors.join(', ')}`);
  });

  it('rejects review_only role with local_cli runtime', () => {
    const result = validateV4Config({
      schema_version: '1.0',
      project: { id: 'x', name: 'X' },
      roles: { qa: { title: 'QA', mandate: 'Test', write_authority: 'review_only', runtime: 'local-qa' } },
      runtimes: { 'local-qa': { type: 'local_cli' } },
    });
    assert.equal(result.ok, false);
    assert.ok(result.errors.some(e => e.includes('review_only') && e.includes('local_cli')));
  });

  it('rejects routing referencing unknown role', () => {
    const result = validateV4Config({
      schema_version: '1.0',
      project: { id: 'x', name: 'X' },
      roles: { dev: { title: 'Dev', mandate: 'Build', write_authority: 'authoritative', runtime: 'r1' } },
      runtimes: { r1: { type: 'manual' } },
      routing: { planning: { entry_role: 'ghost', allowed_next_roles: ['dev'] } },
    });
    assert.equal(result.ok, false);
    assert.ok(result.errors.some(e => e.includes('ghost')));
  });

  it('allows human in routing allowed_next_roles', () => {
    const result = validateV4Config({
      schema_version: '1.0',
      project: { id: 'x', name: 'X' },
      roles: { dev: { title: 'Dev', mandate: 'Build', write_authority: 'authoritative', runtime: 'r1' } },
      runtimes: { r1: { type: 'manual' } },
      routing: { planning: { entry_role: 'dev', allowed_next_roles: ['human'] } },
    });
    assert.equal(result.ok, true, `Unexpected errors: ${result.errors.join(', ')}`);
  });
});

// --- normalizeV3 ---

describe('normalizeV3', () => {
  it('normalizes the v3 fixture to internal shape', () => {
    const fixture = loadFixture('config-v3-legacy.json');
    const normalized = normalizeV3(fixture);

    assert.equal(normalized.schema_version, 3);
    assert.equal(normalized.protocol_mode, 'legacy');
    assert.equal(normalized.project.name, 'Baby Tracker');
    assert.equal(normalized.project.id, 'baby-tracker');

    // Roles preserved
    assert.ok(normalized.roles.pm);
    assert.ok(normalized.roles.dev);
    assert.ok(normalized.roles.qa);
    assert.ok(normalized.roles.ux);

    // Write authority inferred
    assert.equal(normalized.roles.pm.write_authority, 'review_only');
    assert.equal(normalized.roles.dev.write_authority, 'authoritative');
    assert.equal(normalized.roles.qa.write_authority, 'review_only');
    assert.equal(normalized.roles.ux.write_authority, 'review_only');

    // Legacy compat flags
    assert.equal(normalized.compat.next_owner_source, 'talk-md');
    assert.equal(normalized.compat.lock_based_coordination, true);
    assert.equal(normalized.compat.original_version, 3);

    // Rules carried forward
    assert.equal(normalized.rules.max_consecutive_claims, 2);
    assert.equal(normalized.rules.verify_command, 'npm test');
    assert.equal(normalized.rules.compress_after_words, 5000);

    // Files mapped
    assert.equal(normalized.files.talk, 'TALK.md');
    assert.equal(normalized.files.history, 'history.jsonl');
  });
});

// --- normalizeV4 ---

describe('normalizeV4', () => {
  it('normalizes the v4 fixture to internal shape', () => {
    const fixture = loadFixture('config-v4-governed.json');
    const normalized = normalizeV4(fixture);

    assert.equal(normalized.schema_version, 4);
    assert.equal(normalized.protocol_mode, 'governed');
    assert.equal(normalized.project.id, 'baby-tracker');
    assert.equal(normalized.project.name, 'Baby Tracker');

    // Roles
    assert.ok(normalized.roles.pm);
    assert.ok(normalized.roles.dev);
    assert.ok(normalized.roles.qa);
    assert.ok(normalized.roles.eng_director);

    // Write authority explicit from config
    assert.equal(normalized.roles.pm.write_authority, 'review_only');
    assert.equal(normalized.roles.dev.write_authority, 'authoritative');

    // Runtime class resolved from runtimes table
    assert.equal(normalized.roles.pm.runtime_class, 'manual');
    assert.equal(normalized.roles.dev.runtime_class, 'local_cli');
    assert.equal(normalized.roles.qa.runtime_class, 'api_proxy');

    // Governed compat flags
    assert.equal(normalized.compat.next_owner_source, 'state-json');
    assert.equal(normalized.compat.lock_based_coordination, false);
    assert.equal(normalized.compat.original_version, 4);

    // Budget
    assert.equal(normalized.budget.per_turn_max_usd, 2.0);
    assert.equal(normalized.budget.per_run_max_usd, 50.0);

    // Files
    assert.equal(normalized.files.state, '.agentxchain/state.json');
    assert.equal(normalized.files.history, '.agentxchain/history.jsonl');
  });
});

// --- loadNormalizedConfig (integration) ---

describe('loadNormalizedConfig', () => {
  it('loads and normalizes v3 fixture', () => {
    const fixture = loadFixture('config-v3-legacy.json');
    const result = loadNormalizedConfig(fixture);
    assert.equal(result.ok, true, `Errors: ${result.errors.join(', ')}`);
    assert.equal(result.version, 3);
    assert.equal(result.normalized.protocol_mode, 'legacy');
  });

  it('loads and normalizes v4 fixture', () => {
    const fixture = loadFixture('config-v4-governed.json');
    const result = loadNormalizedConfig(fixture);
    assert.equal(result.ok, true, `Errors: ${result.errors.join(', ')}`);
    assert.equal(result.version, 4);
    assert.equal(result.normalized.protocol_mode, 'governed');
  });

  it('rejects unrecognized config', () => {
    const result = loadNormalizedConfig({ version: 99 });
    assert.equal(result.ok, false);
    assert.equal(result.version, null);
  });

  it('rejects invalid v3 config', () => {
    const result = loadNormalizedConfig({ version: 3, project: '', agents: {} });
    assert.equal(result.ok, false);
    assert.equal(result.version, 3);
  });

  it('rejects invalid v4 config', () => {
    const result = loadNormalizedConfig({ schema_version: '1.0' });
    assert.equal(result.ok, false);
    assert.equal(result.version, 4);
  });

  // Cross-generation consistency: both fixtures produce the same internal shape keys
  it('both v3 and v4 produce the same top-level keys', () => {
    const v3 = loadNormalizedConfig(loadFixture('config-v3-legacy.json'));
    const v4 = loadNormalizedConfig(loadFixture('config-v4-governed.json'));
    assert.ok(v3.ok);
    assert.ok(v4.ok);

    const v3Keys = Object.keys(v3.normalized).sort();
    const v4Keys = Object.keys(v4.normalized).sort();
    assert.deepEqual(v3Keys, v4Keys, 'v3 and v4 normalized configs must have identical top-level keys');
  });

  it('both v3 and v4 have consistent role shape', () => {
    const v3 = loadNormalizedConfig(loadFixture('config-v3-legacy.json'));
    const v4 = loadNormalizedConfig(loadFixture('config-v4-governed.json'));

    const v3RoleKeys = Object.keys(Object.values(v3.normalized.roles)[0]).sort();
    const v4RoleKeys = Object.keys(Object.values(v4.normalized.roles)[0]).sort();
    assert.deepEqual(v3RoleKeys, v4RoleKeys, 'Role objects must have the same shape across versions');
  });
});

// --- api_proxy config validation (Session #19) ---

describe('validateV4Config — api_proxy validation', () => {
  const baseConfig = (runtimeOverrides = {}, roleOverrides = {}) => ({
    schema_version: '1.0',
    project: { id: 'test', name: 'Test' },
    roles: {
      qa: {
        title: 'QA',
        mandate: 'Test.',
        write_authority: 'review_only',
        runtime: 'api-qa',
        ...roleOverrides,
      },
    },
    runtimes: {
      'api-qa': {
        type: 'api_proxy',
        provider: 'anthropic',
        model: 'claude-sonnet-4-6',
        auth_env: 'ANTHROPIC_API_KEY',
        ...runtimeOverrides,
      },
    },
  });

  it('accepts valid api_proxy config with all required fields', () => {
    const result = validateV4Config(baseConfig());
    assert.equal(result.ok, true, `Unexpected errors: ${result.errors.join(', ')}`);
  });

  it('rejects api_proxy missing provider', () => {
    const result = validateV4Config(baseConfig({ provider: undefined }));
    assert.equal(result.ok, false);
    assert.ok(result.errors.some(e => e.includes('provider')));
  });

  it('rejects api_proxy missing model', () => {
    const result = validateV4Config(baseConfig({ model: undefined }));
    assert.equal(result.ok, false);
    assert.ok(result.errors.some(e => e.includes('model')));
  });

  it('rejects api_proxy missing auth_env', () => {
    const result = validateV4Config(baseConfig({ auth_env: undefined }));
    assert.equal(result.ok, false);
    assert.ok(result.errors.some(e => e.includes('auth_env')));
  });

  it('rejects api_proxy bound to authoritative role in v1', () => {
    const result = validateV4Config(baseConfig({}, { write_authority: 'authoritative' }));
    assert.equal(result.ok, false);
    assert.ok(result.errors.some(e => e.includes('v1 api_proxy only supports review_only')));
  });

  it('rejects api_proxy bound to proposed role in v1', () => {
    const result = validateV4Config(baseConfig({}, { write_authority: 'proposed' }));
    assert.equal(result.ok, false);
    assert.ok(result.errors.some(e => e.includes('v1 api_proxy only supports review_only')));
  });
});
