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

  it('accepts integer decision_authority from fixture', () => {
    const fixture = loadFixture('decision-authority-v4.json');
    const result = validateV4Config(fixture);
    assert.equal(result.ok, true, `Unexpected errors: ${result.errors.join(', ')}`);
  });

  it('rejects non-integer decision_authority', () => {
    const fixture = loadFixture('decision-authority-v4.json');
    fixture.roles.dev.decision_authority = 20.5;
    const result = validateV4Config(fixture);
    assert.equal(result.ok, false);
    assert.ok(result.errors.some((e) => e.includes('decision_authority must be an integer between 0 and 99')));
  });

  it('rejects out-of-range decision_authority', () => {
    const fixture = loadFixture('decision-authority-v4.json');
    fixture.roles.pm.decision_authority = 100;
    const result = validateV4Config(fixture);
    assert.equal(result.ok, false);
    assert.ok(result.errors.some((e) => e.includes('decision_authority must be an integer between 0 and 99')));
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

  it('rejects non-numeric budget limits', () => {
    const result = validateV4Config({
      schema_version: '1.0',
      project: { id: 'test', name: 'Test' },
      roles: { dev: { title: 'Dev', mandate: 'Build.', write_authority: 'authoritative', runtime: 'local-dev' } },
      runtimes: { 'local-dev': { type: 'local_cli', command: ['claude', '--print'] } },
      budget: { per_turn_max_usd: 'banana', per_run_max_usd: 10.0 },
    });
    assert.equal(result.ok, false);
    assert.ok(result.errors.some(e => e.includes('budget.per_turn_max_usd must be a finite number')));
  });

  it('rejects impossible per-turn budget larger than per-run budget', () => {
    const result = validateV4Config({
      schema_version: '1.0',
      project: { id: 'test', name: 'Test' },
      roles: { dev: { title: 'Dev', mandate: 'Build.', write_authority: 'authoritative', runtime: 'local-dev' } },
      runtimes: { 'local-dev': { type: 'local_cli', command: ['claude', '--print'] } },
      budget: { per_turn_max_usd: 11.0, per_run_max_usd: 10.0 },
    });
    assert.equal(result.ok, false);
    assert.ok(result.errors.some(e => e.includes('less than or equal to budget.per_run_max_usd')));
  });

  it('rejects unsupported budget on_exceed modes', () => {
    const result = validateV4Config({
      schema_version: '1.0',
      project: { id: 'test', name: 'Test' },
      roles: { dev: { title: 'Dev', mandate: 'Build.', write_authority: 'authoritative', runtime: 'local-dev' } },
      runtimes: { 'local-dev': { type: 'local_cli', command: ['claude', '--print'] } },
      budget: { per_turn_max_usd: 2.0, per_run_max_usd: 10.0, on_exceed: 'abort' },
    });
    assert.equal(result.ok, false);
    assert.ok(result.errors.some(e => e.includes('on_exceed must be one of')));
  });

  it('rejects malformed budget.cost_rates entries', () => {
    const result = validateV4Config({
      schema_version: '1.0',
      project: { id: 'test', name: 'Test' },
      roles: { dev: { title: 'Dev', mandate: 'Build.', write_authority: 'authoritative', runtime: 'local-dev' } },
      runtimes: { 'local-dev': { type: 'local_cli', command: ['claude', '--print'] } },
      budget: {
        per_turn_max_usd: 2.0,
        per_run_max_usd: 10.0,
        cost_rates: {
          'gpt-4o': { input_per_1m: -1, output_per_1m: 'oops' },
        },
      },
    });
    assert.equal(result.ok, false);
    assert.ok(result.errors.some(e => e.includes('budget.cost_rates.gpt-4o.input_per_1m')));
    assert.ok(result.errors.some(e => e.includes('budget.cost_rates.gpt-4o.output_per_1m')));
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

  it('accepts review_only role with mcp runtime without false binding errors', () => {
    const result = validateV4Config({
      schema_version: '1.0',
      project: { id: 'x', name: 'X' },
      roles: { qa: { title: 'QA', mandate: 'Test', write_authority: 'review_only', runtime: 'mcp-qa' } },
      runtimes: { 'mcp-qa': { type: 'mcp', command: ['node', '-e', 'process.exit(0)'] } },
    });
    assert.equal(result.ok, true, `Unexpected errors: ${result.errors.join(', ')}`);
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

  it('accepts a valid api_proxy retry_policy', () => {
    const result = validateV4Config({
      schema_version: '1.0',
      project: { id: 'x', name: 'X' },
      roles: {
        qa: { title: 'QA', mandate: 'Review', write_authority: 'review_only', runtime: 'api-qa' },
      },
      runtimes: {
        'api-qa': {
          type: 'api_proxy',
          provider: 'anthropic',
          model: 'claude-sonnet-4-6',
          auth_env: 'ANTHROPIC_API_KEY',
          retry_policy: {
            enabled: true,
            max_attempts: 3,
            base_delay_ms: 100,
            max_delay_ms: 500,
            backoff_multiplier: 2,
            jitter: 'none',
            retry_on: ['rate_limited', 'timeout'],
          },
        },
      },
    });
    assert.equal(result.ok, true, `Unexpected errors: ${result.errors.join(', ')}`);
  });

  it('accepts OpenAI as a valid api_proxy provider', () => {
    const result = validateV4Config({
      schema_version: '1.0',
      project: { id: 'x', name: 'X' },
      roles: {
        qa: { title: 'QA', mandate: 'Review', write_authority: 'review_only', runtime: 'api-qa' },
      },
      runtimes: {
        'api-qa': {
          type: 'api_proxy',
          provider: 'openai',
          model: 'gpt-4o-mini',
          auth_env: 'OPENAI_API_KEY',
        },
      },
    });
    assert.equal(result.ok, true, `Unexpected errors: ${result.errors.join(', ')}`);
  });

  it('accepts Google as a valid api_proxy provider', () => {
    const result = validateV4Config({
      schema_version: '1.0',
      project: { id: 'x', name: 'X' },
      roles: {
        qa: { title: 'QA', mandate: 'Review', write_authority: 'review_only', runtime: 'api-qa' },
      },
      runtimes: {
        'api-qa': {
          type: 'api_proxy',
          provider: 'google',
          model: 'gemini-2.5-flash',
          auth_env: 'GOOGLE_API_KEY',
        },
      },
    });
    assert.equal(result.ok, true, `Unexpected errors: ${result.errors.join(', ')}`);
  });

  it('accepts a valid api_proxy base_url override', () => {
    const result = validateV4Config({
      schema_version: '1.0',
      project: { id: 'x', name: 'X' },
      roles: {
        qa: { title: 'QA', mandate: 'Review', write_authority: 'review_only', runtime: 'api-qa' },
      },
      runtimes: {
        'api-qa': {
          type: 'api_proxy',
          provider: 'openai',
          model: 'gpt-4o-mini',
          auth_env: 'OPENAI_API_KEY',
          base_url: 'http://127.0.0.1:4318/v1/chat/completions',
        },
      },
    });
    assert.equal(result.ok, true, `Unexpected errors: ${result.errors.join(', ')}`);
  });

  it('accepts a valid notifications.webhooks block', () => {
    const result = validateV4Config({
      schema_version: '1.0',
      project: { id: 'x', name: 'X' },
      roles: {
        dev: { title: 'Dev', mandate: 'Build', write_authority: 'authoritative', runtime: 'manual-dev' },
      },
      runtimes: {
        'manual-dev': { type: 'manual' },
      },
      notifications: {
        webhooks: [
          {
            name: 'ops_webhook',
            url: 'https://example.com/agentxchain',
            events: ['run_blocked', 'run_completed'],
            timeout_ms: 5000,
            headers: {
              Authorization: 'Bearer ${TEST_NOTIFICATION_TOKEN}',
            },
            env: {
              TEST_NOTIFICATION_TOKEN: 'secret-token',
            },
          },
        ],
      },
    });
    assert.equal(result.ok, true, `Unexpected errors: ${result.errors.join(', ')}`);
  });

  it('accepts a valid schedules block', () => {
    const result = validateV4Config({
      schema_version: '1.0',
      project: { id: 'x', name: 'X' },
      roles: {
        pm: { title: 'PM', mandate: 'Plan', write_authority: 'authoritative', runtime: 'manual-pm' },
      },
      runtimes: {
        'manual-pm': { type: 'manual' },
      },
      schedules: {
        nightly_governed_run: {
          every_minutes: 60,
          auto_approve: true,
          max_turns: 10,
          initial_role: 'pm',
        },
      },
    });
    assert.equal(result.ok, true, `Unexpected errors: ${result.errors.join(', ')}`);
  });

  it('rejects schedule with invalid cadence', () => {
    const result = validateV4Config({
      schema_version: '1.0',
      project: { id: 'x', name: 'X' },
      roles: {
        pm: { title: 'PM', mandate: 'Plan', write_authority: 'authoritative', runtime: 'manual-pm' },
      },
      runtimes: {
        'manual-pm': { type: 'manual' },
      },
      schedules: {
        nightly_governed_run: {
          every_minutes: 0,
        },
      },
    });
    assert.equal(result.ok, false);
    assert.ok(result.errors.some((e) => e.includes('every_minutes')));
  });

  it('rejects schedule referencing unknown initial_role', () => {
    const result = validateV4Config({
      schema_version: '1.0',
      project: { id: 'x', name: 'X' },
      roles: {
        pm: { title: 'PM', mandate: 'Plan', write_authority: 'authoritative', runtime: 'manual-pm' },
      },
      runtimes: {
        'manual-pm': { type: 'manual' },
      },
      schedules: {
        nightly_governed_run: {
          every_minutes: 60,
          initial_role: 'ghost',
        },
      },
    });
    assert.equal(result.ok, false);
    assert.ok(result.errors.some((e) => e.includes('initial_role')));
  });

  it('rejects unknown notification events', () => {
    const result = validateV4Config({
      schema_version: '1.0',
      project: { id: 'x', name: 'X' },
      roles: {
        dev: { title: 'Dev', mandate: 'Build', write_authority: 'authoritative', runtime: 'manual-dev' },
      },
      runtimes: {
        'manual-dev': { type: 'manual' },
      },
      notifications: {
        webhooks: [
          {
            name: 'ops_webhook',
            url: 'https://example.com/agentxchain',
            events: ['run_blocked', 'imaginary_event'],
            timeout_ms: 5000,
          },
        ],
      },
    });
    assert.equal(result.ok, false);
    assert.ok(result.errors.some((e) => e.includes('unknown event "imaginary_event"')));
  });

  it('accepts a valid mcp runtime config', () => {
    const result = validateV4Config({
      schema_version: '1.0',
      project: { id: 'x', name: 'X' },
      roles: {
        dev: { title: 'Dev', mandate: 'Build', write_authority: 'authoritative', runtime: 'mcp-dev' },
      },
      runtimes: {
        'mcp-dev': {
          type: 'mcp',
          command: 'node',
          args: ['./scripts/mcp-agent.js'],
          tool_name: 'agentxchain_turn',
        },
      },
    });
    assert.equal(result.ok, true, `Unexpected errors: ${result.errors.join(', ')}`);
  });

  it('rejects mcp runtime without a command', () => {
    const result = validateV4Config({
      schema_version: '1.0',
      project: { id: 'x', name: 'X' },
      roles: {
        dev: { title: 'Dev', mandate: 'Build', write_authority: 'authoritative', runtime: 'mcp-dev' },
      },
      runtimes: {
        'mcp-dev': {
          type: 'mcp',
          tool_name: 'agentxchain_turn',
        },
      },
    });
    assert.equal(result.ok, false);
    assert.ok(result.errors.some((e) => e.includes('mcp requires "command"')));
  });

  it('rejects invalid mcp args and tool_name', () => {
    const result = validateV4Config({
      schema_version: '1.0',
      project: { id: 'x', name: 'X' },
      roles: {
        dev: { title: 'Dev', mandate: 'Build', write_authority: 'authoritative', runtime: 'mcp-dev' },
      },
      runtimes: {
        'mcp-dev': {
          type: 'mcp',
          command: ['node', ''],
          args: 'not-an-array',
          tool_name: '',
        },
      },
    });
    assert.equal(result.ok, false);
    assert.ok(result.errors.some((e) => e.includes('command array')));
    assert.ok(result.errors.some((e) => e.includes('args')));
    assert.ok(result.errors.some((e) => e.includes('tool_name')));
  });

  it('accepts a valid streamable_http mcp runtime config', () => {
    const result = validateV4Config({
      schema_version: '1.0',
      project: { id: 'x', name: 'X' },
      roles: {
        dev: { title: 'Dev', mandate: 'Build', write_authority: 'authoritative', runtime: 'mcp-dev' },
      },
      runtimes: {
        'mcp-dev': {
          type: 'mcp',
          transport: 'streamable_http',
          url: 'http://127.0.0.1:8787/mcp',
          tool_name: 'agentxchain_turn',
          headers: {
            'x-agentxchain-project': 'demo',
          },
        },
      },
    });
    assert.equal(result.ok, true, `Unexpected errors: ${result.errors.join(', ')}`);
  });

  it('rejects streamable_http mcp runtime without url', () => {
    const result = validateV4Config({
      schema_version: '1.0',
      project: { id: 'x', name: 'X' },
      roles: {
        dev: { title: 'Dev', mandate: 'Build', write_authority: 'authoritative', runtime: 'mcp-dev' },
      },
      runtimes: {
        'mcp-dev': {
          type: 'mcp',
          transport: 'streamable_http',
        },
      },
    });
    assert.equal(result.ok, false);
    assert.ok(result.errors.some((e) => e.includes('requires "url"')));
  });

  it('rejects streamable_http mcp runtime with stdio-only fields', () => {
    const result = validateV4Config({
      schema_version: '1.0',
      project: { id: 'x', name: 'X' },
      roles: {
        dev: { title: 'Dev', mandate: 'Build', write_authority: 'authoritative', runtime: 'mcp-dev' },
      },
      runtimes: {
        'mcp-dev': {
          type: 'mcp',
          transport: 'streamable_http',
          url: 'http://127.0.0.1:8787/mcp',
          command: 'node',
          args: ['./server.js'],
          cwd: '.',
        },
      },
    });
    assert.equal(result.ok, false);
    assert.ok(result.errors.some((e) => e.includes('does not accept "command"')));
    assert.ok(result.errors.some((e) => e.includes('does not accept "args"')));
    assert.ok(result.errors.some((e) => e.includes('does not accept "cwd"')));
  });

  it('rejects stdio mcp runtime with remote-only fields', () => {
    const result = validateV4Config({
      schema_version: '1.0',
      project: { id: 'x', name: 'X' },
      roles: {
        dev: { title: 'Dev', mandate: 'Build', write_authority: 'authoritative', runtime: 'mcp-dev' },
      },
      runtimes: {
        'mcp-dev': {
          type: 'mcp',
          command: 'node',
          url: 'http://127.0.0.1:8787/mcp',
          headers: {
            'x-test': 'demo',
          },
        },
      },
    });
    assert.equal(result.ok, false);
    assert.ok(result.errors.some((e) => e.includes('stdio does not accept "url"')));
    assert.ok(result.errors.some((e) => e.includes('stdio does not accept "headers"')));
  });

  it('rejects invalid api_proxy retry_policy values', () => {
    const result = validateV4Config({
      schema_version: '1.0',
      project: { id: 'x', name: 'X' },
      roles: {
        qa: { title: 'QA', mandate: 'Review', write_authority: 'review_only', runtime: 'api-qa' },
      },
      runtimes: {
        'api-qa': {
          type: 'api_proxy',
          provider: 'anthropic',
          model: 'claude-sonnet-4-6',
          auth_env: 'ANTHROPIC_API_KEY',
          retry_policy: {
            enabled: true,
            max_attempts: 0,
            jitter: 'randomized',
            retry_on: ['rate_limited', 'not_real'],
          },
        },
      },
    });
    assert.equal(result.ok, false);
    assert.ok(result.errors.some(e => e.includes('max_attempts')));
    assert.ok(result.errors.some(e => e.includes('jitter')));
    assert.ok(result.errors.some(e => e.includes('not_real')));
  });

  it('rejects unknown api_proxy retry_policy fields and invalid delay ranges', () => {
    const result = validateV4Config({
      schema_version: '1.0',
      project: { id: 'x', name: 'X' },
      roles: {
        qa: { title: 'QA', mandate: 'Review', write_authority: 'review_only', runtime: 'api-qa' },
      },
      runtimes: {
        'api-qa': {
          type: 'api_proxy',
          provider: 'anthropic',
          model: 'claude-sonnet-4-6',
          auth_env: 'ANTHROPIC_API_KEY',
          retry_policy: {
            enabled: true,
            base_delay_ms: 500,
            max_delay_ms: 100,
            custom_field: true,
          },
        },
      },
    });
    assert.equal(result.ok, false);
    assert.ok(result.errors.some(e => e.includes('unknown field "custom_field"')));
    assert.ok(result.errors.some(e => e.includes('max_delay_ms must be >= retry_policy.base_delay_ms')));
  });

  it('accepts provider_overloaded in api_proxy retry_policy.retry_on', () => {
    const result = validateV4Config({
      schema_version: '1.0',
      project: { id: 'x', name: 'X' },
      roles: {
        qa: { title: 'QA', mandate: 'Review', write_authority: 'review_only', runtime: 'api-qa' },
      },
      runtimes: {
        'api-qa': {
          type: 'api_proxy',
          provider: 'anthropic',
          model: 'claude-sonnet-4-6',
          auth_env: 'ANTHROPIC_API_KEY',
          retry_policy: {
            enabled: true,
            retry_on: ['provider_overloaded'],
          },
        },
      },
    });
    assert.equal(result.ok, true, `Unexpected errors: ${result.errors.join(', ')}`);
  });

  it('rejects invalid_request in api_proxy retry_policy.retry_on', () => {
    const result = validateV4Config({
      schema_version: '1.0',
      project: { id: 'x', name: 'X' },
      roles: {
        qa: { title: 'QA', mandate: 'Review', write_authority: 'review_only', runtime: 'api-qa' },
      },
      runtimes: {
        'api-qa': {
          type: 'api_proxy',
          provider: 'anthropic',
          model: 'claude-sonnet-4-6',
          auth_env: 'ANTHROPIC_API_KEY',
          retry_policy: {
            enabled: true,
            retry_on: ['invalid_request'],
          },
        },
      },
    });
    assert.equal(result.ok, false);
    assert.ok(result.errors.some(e => e.includes('invalid_request')));
  });

  it('accepts a valid api_proxy preflight_tokenization config', () => {
    const result = validateV4Config({
      schema_version: '1.0',
      project: { id: 'x', name: 'X' },
      roles: {
        qa: { title: 'QA', mandate: 'Review', write_authority: 'review_only', runtime: 'api-qa' },
      },
      runtimes: {
        'api-qa': {
          type: 'api_proxy',
          provider: 'anthropic',
          model: 'claude-sonnet-4-6',
          auth_env: 'ANTHROPIC_API_KEY',
          max_output_tokens: 4096,
          context_window_tokens: 200000,
          preflight_tokenization: {
            enabled: true,
            tokenizer: 'provider_local',
            safety_margin_tokens: 2048,
          },
        },
      },
    });
    assert.equal(result.ok, true, `Unexpected errors: ${result.errors.join(', ')}`);
  });

  it('rejects invalid api_proxy preflight_tokenization values', () => {
    const result = validateV4Config({
      schema_version: '1.0',
      project: { id: 'x', name: 'X' },
      roles: {
        qa: { title: 'QA', mandate: 'Review', write_authority: 'review_only', runtime: 'api-qa' },
      },
      runtimes: {
        'api-qa': {
          type: 'api_proxy',
          provider: 'anthropic',
          model: 'claude-sonnet-4-6',
          auth_env: 'ANTHROPIC_API_KEY',
          context_window_tokens: 0,
          preflight_tokenization: {
            enabled: true,
            tokenizer: 'heuristic',
            safety_margin_tokens: -1,
            custom_field: true,
          },
        },
      },
    });
    assert.equal(result.ok, false);
    assert.ok(result.errors.some(e => e.includes('context_window_tokens must be a positive integer')));
    assert.ok(result.errors.some(e => e.includes('tokenizer must be one of: provider_local')));
    assert.ok(result.errors.some(e => e.includes('safety_margin_tokens must be an integer >= 0')));
    assert.ok(result.errors.some(e => e.includes('unknown field "custom_field"')));
  });

  it('rejects enabled preflight tokenization without a sufficient context window', () => {
    const result = validateV4Config({
      schema_version: '1.0',
      project: { id: 'x', name: 'X' },
      roles: {
        qa: { title: 'QA', mandate: 'Review', write_authority: 'review_only', runtime: 'api-qa' },
      },
      runtimes: {
        'api-qa': {
          type: 'api_proxy',
          provider: 'anthropic',
          model: 'claude-sonnet-4-6',
          auth_env: 'ANTHROPIC_API_KEY',
          max_output_tokens: 4096,
          context_window_tokens: 5000,
          preflight_tokenization: {
            enabled: true,
            safety_margin_tokens: 2048,
          },
        },
      },
    });
    assert.equal(result.ok, false);
    assert.ok(
      result.errors.some(e => e.includes('context_window_tokens must be greater than max_output_tokens + preflight_tokenization.safety_margin_tokens'))
    );
  });

  it('rejects OpenAI preflight tokenization until a provider_local tokenizer exists', () => {
    const result = validateV4Config({
      schema_version: '1.0',
      project: { id: 'x', name: 'X' },
      roles: {
        qa: { title: 'QA', mandate: 'Review', write_authority: 'review_only', runtime: 'api-qa' },
      },
      runtimes: {
        'api-qa': {
          type: 'api_proxy',
          provider: 'openai',
          model: 'gpt-4o-mini',
          auth_env: 'OPENAI_API_KEY',
          max_output_tokens: 4096,
          context_window_tokens: 128000,
          preflight_tokenization: {
            enabled: true,
            tokenizer: 'provider_local',
            safety_margin_tokens: 2048,
          },
        },
      },
    });
    assert.equal(result.ok, false);
    assert.ok(result.errors.some(e => e.includes('provider_local') && e.includes('openai')));
  });

  it('rejects Google preflight tokenization until a provider_local tokenizer exists', () => {
    const result = validateV4Config({
      schema_version: '1.0',
      project: { id: 'x', name: 'X' },
      roles: {
        qa: { title: 'QA', mandate: 'Review', write_authority: 'review_only', runtime: 'api-qa' },
      },
      runtimes: {
        'api-qa': {
          type: 'api_proxy',
          provider: 'google',
          model: 'gemini-2.5-flash',
          auth_env: 'GOOGLE_API_KEY',
          max_output_tokens: 4096,
          context_window_tokens: 1048576,
          preflight_tokenization: {
            enabled: true,
            tokenizer: 'provider_local',
            safety_margin_tokens: 2048,
          },
        },
      },
    });
    assert.equal(result.ok, false);
    assert.ok(result.errors.some(e => e.includes('provider_local') && e.includes('google')));
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

  it('preserves role decision_authority in normalized governed config', () => {
    const normalized = normalizeV4({
      schema_version: '1.0',
      project: { id: 'x', name: 'X' },
      roles: {
        architect: {
          title: 'Architect',
          mandate: 'Set direction',
          write_authority: 'review_only',
          decision_authority: 40,
          runtime: 'manual-architect',
        },
        dev: {
          title: 'Developer',
          mandate: 'Build',
          write_authority: 'authoritative',
          runtime: 'manual-dev',
        },
      },
      runtimes: {
        'manual-architect': { type: 'manual' },
        'manual-dev': { type: 'manual' },
      },
    });

    assert.equal(normalized.roles.architect.decision_authority, 40);
    assert.equal(
      Object.prototype.hasOwnProperty.call(normalized.roles.dev, 'decision_authority'),
      false,
    );
  });

  it('preserves explicit workflow-kit phase templates in normalized governed config', () => {
    const normalized = normalizeV4({
      schema_version: '1.0',
      project: { id: 'x', name: 'X' },
      roles: {
        architect: {
          title: 'Architect',
          mandate: 'Design the system',
          write_authority: 'review_only',
          runtime: 'manual-architect',
        },
      },
      runtimes: {
        'manual-architect': { type: 'manual' },
      },
      routing: {
        architecture: { entry_role: 'architect' },
      },
      workflow_kit: {
        phases: {
          architecture: {
            template: 'architecture-review',
          },
        },
      },
    });

    assert.equal(normalized.workflow_kit._explicit, true);
    assert.equal(normalized.workflow_kit.phases.architecture.template, 'architecture-review');
  });

  it('normalizes schedules with lights-out defaults', () => {
    const normalized = normalizeV4({
      schema_version: '1.0',
      project: { id: 'x', name: 'X' },
      roles: {
        pm: { title: 'PM', mandate: 'Plan', write_authority: 'authoritative', runtime: 'manual-pm' },
      },
      runtimes: {
        'manual-pm': { type: 'manual' },
      },
      schedules: {
        nightly_governed_run: {
          every_minutes: 60,
        },
      },
    });

    assert.deepEqual(normalized.schedules.nightly_governed_run, {
      enabled: true,
      every_minutes: 60,
      auto_approve: true,
      max_turns: 50,
      initial_role: null,
      trigger_reason: 'schedule:nightly_governed_run',
      continuous: null,
    });
  });
});

// --- normalizeV4 template field ---

describe('normalizeV4 — template read path', () => {
  const minimalV4 = {
    schema_version: '1.0',
    project: { id: 'test', name: 'Test' },
    roles: { dev: { title: 'Dev', mandate: 'Build', write_authority: 'authoritative', runtime: 'r1' } },
    runtimes: { r1: { type: 'manual' } },
  };

  it('defaults template to "generic" when missing from config', () => {
    const normalized = normalizeV4(minimalV4);
    assert.equal(normalized.template, 'generic');
  });

  it('preserves explicit template value from config', () => {
    const normalized = normalizeV4({ ...minimalV4, template: 'api-service' });
    assert.equal(normalized.template, 'api-service');
  });

  it('preserves web-app template value', () => {
    const normalized = normalizeV4({ ...minimalV4, template: 'web-app' });
    assert.equal(normalized.template, 'web-app');
  });

  it('preserves cli-tool template value', () => {
    const normalized = normalizeV4({ ...minimalV4, template: 'cli-tool' });
    assert.equal(normalized.template, 'cli-tool');
  });

  it('preserves library template value', () => {
    const normalized = normalizeV4({ ...minimalV4, template: 'library' });
    assert.equal(normalized.template, 'library');
  });

  it('old v4 fixture without template normalizes to generic', () => {
    const fixture = loadFixture('config-v4-governed.json');
    // The fixture does not have a template field
    const normalized = normalizeV4(fixture);
    assert.equal(normalized.template, 'generic');
  });

  it('loadNormalizedConfig preserves template through the full pipeline', () => {
    const result = loadNormalizedConfig({ ...minimalV4, template: 'api-service' });
    assert.equal(result.ok, true, `Errors: ${result.errors.join(', ')}`);
    assert.equal(result.normalized.template, 'api-service');
  });

  it('loadNormalizedConfig defaults template for old configs', () => {
    const result = loadNormalizedConfig(minimalV4);
    assert.equal(result.ok, true, `Errors: ${result.errors.join(', ')}`);
    assert.equal(result.normalized.template, 'generic');
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

  it('rejects api_proxy bound to authoritative role', () => {
    const result = validateV4Config(baseConfig({}, { write_authority: 'authoritative' }));
    assert.equal(result.ok, false);
    assert.ok(result.errors.some(e => e.includes('api_proxy only supports review_only and proposed')));
  });

  it('accepts api_proxy bound to proposed role', () => {
    const result = validateV4Config(baseConfig({}, { write_authority: 'proposed' }));
    assert.equal(result.ok, true, `Expected ok but got errors: ${result.errors?.join('; ')}`);
  });

  it('rejects non-string api_proxy base_url', () => {
    const result = validateV4Config(baseConfig({ base_url: 42 }));
    assert.equal(result.ok, false);
    assert.ok(result.errors.some(e => e.includes('base_url must be a non-empty string')));
  });

  it('rejects invalid api_proxy base_url', () => {
    const result = validateV4Config(baseConfig({ base_url: 'not-a-url' }));
    assert.equal(result.ok, false);
    assert.ok(result.errors.some(e => e.includes('base_url must be a valid absolute URL')));
  });

  it('rejects api_proxy base_url with unsupported protocol', () => {
    const result = validateV4Config(baseConfig({ base_url: 'file:///tmp/mock-provider' }));
    assert.equal(result.ok, false);
    assert.ok(result.errors.some(e => e.includes('base_url must use http or https')));
  });
});

// --- Custom Phases ---

describe('custom phases', () => {
  it('AT-CP-001: accepts custom phases declared in routing', () => {
    const result = validateV4Config({
      schema_version: '1.0',
      project: { id: 'x', name: 'X' },
      roles: {
        pm: { title: 'PM', mandate: 'Plan', write_authority: 'authoritative', runtime: 'r1' },
        arch: { title: 'Architect', mandate: 'Design', write_authority: 'authoritative', runtime: 'r1' },
        dev: { title: 'Dev', mandate: 'Build', write_authority: 'authoritative', runtime: 'r1' },
        qa: { title: 'QA', mandate: 'Test', write_authority: 'review_only', runtime: 'r1' },
      },
      runtimes: { r1: { type: 'manual' } },
      routing: {
        planning: { entry_role: 'pm' },
        design: { entry_role: 'arch' },
        implementation: { entry_role: 'dev' },
        qa: { entry_role: 'qa' },
      },
    });
    assert.equal(result.ok, true, `Unexpected errors: ${result.errors.join(', ')}`);
  });

  it('AT-CP-002: accepts a two-phase config without qa', () => {
    const result = validateV4Config({
      schema_version: '1.0',
      project: { id: 'x', name: 'X' },
      roles: {
        pm: { title: 'PM', mandate: 'Plan', write_authority: 'authoritative', runtime: 'r1' },
        dev: { title: 'Dev', mandate: 'Build', write_authority: 'authoritative', runtime: 'r1' },
      },
      runtimes: { r1: { type: 'manual' } },
      routing: {
        planning: { entry_role: 'pm' },
        implementation: { entry_role: 'dev' },
      },
    });
    assert.equal(result.ok, true, `Unexpected errors: ${result.errors.join(', ')}`);
  });

  it('AT-CP-007: existing 3-phase config continues to work', () => {
    const result = validateV4Config({
      schema_version: '1.0',
      project: { id: 'x', name: 'X' },
      roles: { dev: { title: 'Dev', mandate: 'Build', write_authority: 'authoritative', runtime: 'r1' } },
      runtimes: { r1: { type: 'manual' } },
      routing: {
        planning: { entry_role: 'dev' },
        implementation: { entry_role: 'dev' },
        qa: { entry_role: 'dev' },
      },
    });
    assert.equal(result.ok, true, `Unexpected errors: ${result.errors.join(', ')}`);
  });

  it('rejects phase names with invalid characters', () => {
    const result = validateV4Config({
      schema_version: '1.0',
      project: { id: 'x', name: 'X' },
      roles: { dev: { title: 'Dev', mandate: 'Build', write_authority: 'authoritative', runtime: 'r1' } },
      runtimes: { r1: { type: 'manual' } },
      routing: {
        planning: { entry_role: 'dev' },
        'Security Review': { entry_role: 'dev' },
      },
    });
    assert.equal(result.ok, false);
    assert.ok(result.errors.some(e => e.includes('Security Review') && e.includes('lowercase')));
  });

  it('rejects phase names starting with a number', () => {
    const result = validateV4Config({
      schema_version: '1.0',
      project: { id: 'x', name: 'X' },
      roles: { dev: { title: 'Dev', mandate: 'Build', write_authority: 'authoritative', runtime: 'r1' } },
      runtimes: { r1: { type: 'manual' } },
      routing: {
        '1planning': { entry_role: 'dev' },
      },
    });
    assert.equal(result.ok, false);
    assert.ok(result.errors.some(e => e.includes('1planning') && e.includes('lowercase')));
  });

  it('accepts custom phases with hyphens and underscores', () => {
    const result = validateV4Config({
      schema_version: '1.0',
      project: { id: 'x', name: 'X' },
      roles: {
        dev: { title: 'Dev', mandate: 'Build', write_authority: 'authoritative', runtime: 'r1' },
        sec: { title: 'Security', mandate: 'Review', write_authority: 'review_only', runtime: 'r1' },
      },
      runtimes: { r1: { type: 'manual' } },
      routing: {
        planning: { entry_role: 'dev' },
        security_review: { entry_role: 'sec' },
        'post-implementation': { entry_role: 'dev' },
      },
    });
    assert.equal(result.ok, true, `Unexpected errors: ${result.errors.join(', ')}`);
  });
});
