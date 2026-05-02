import { afterEach, describe, it } from 'vitest';
import assert from 'node:assert/strict';

import { probeConnectorRuntime } from '../src/lib/connector-probe.js';

const originalFetch = global.fetch;

afterEach(() => {
  global.fetch = originalFetch;
  delete process.env.AXC_TEST_KEY;
});

describe('connector probe helper', () => {
  it('AT-CCP-004: api_proxy 200 probe passes and surfaces endpoint metadata', async () => {
    const calls = [];
    global.fetch = async (url, init) => {
      calls.push({ url, init });
      return new Response(
        JSON.stringify({ id: 'msg_123', content: [{ type: 'text', text: '{}' }] }),
        {
          status: 200,
          headers: { 'content-type': 'application/json' },
        },
      );
    };

    process.env.AXC_TEST_KEY = 'test-secret';
    const result = await probeConnectorRuntime('api-check', {
      type: 'api_proxy',
      provider: 'anthropic',
      model: 'claude-sonnet-4-6',
      auth_env: 'AXC_TEST_KEY',
      base_url: 'http://127.0.0.1:9999',
    }, { timeoutMs: 1000 });

    assert.equal(result.level, 'pass');
    assert.equal(result.status_code, 200);
    assert.equal(result.endpoint, 'http://127.0.0.1:9999');
    assert.equal(calls.length, 1);
    assert.equal(calls[0].init.method, 'POST');
    assert.match(calls[0].init.headers['x-api-key'], /test-secret/);
  });

  it('AT-CCP-005: api_proxy 401 probe fails as auth rejection', async () => {
    global.fetch = async () => new Response(
      JSON.stringify({ error: { type: 'authentication_error', message: 'bad key' } }),
      {
        status: 401,
        headers: { 'content-type': 'application/json' },
      },
    );

    process.env.AXC_TEST_KEY = 'bad-key';
    const result = await probeConnectorRuntime('api-check', {
      type: 'api_proxy',
      provider: 'anthropic',
      model: 'claude-sonnet-4-6',
      auth_env: 'AXC_TEST_KEY',
      base_url: 'http://127.0.0.1:9999',
    }, { timeoutMs: 1000 });

    assert.equal(result.level, 'fail');
    assert.equal(result.status_code, 401);
    assert.match(result.detail, /rejected/i);
  });

  it('AT-CCP-007: remote_agent 405 response counts as reachable transport success', async () => {
    global.fetch = async () => new Response(
      JSON.stringify({ error: 'method not allowed' }),
      {
        status: 405,
        headers: { 'content-type': 'application/json' },
      },
    );

    const result = await probeConnectorRuntime('remote-check', {
      type: 'remote_agent',
      url: 'http://127.0.0.1:9999',
      headers: { authorization: 'Bearer test' },
    }, { timeoutMs: 1000 });

    assert.equal(result.level, 'pass');
    assert.equal(result.status_code, 405);
    assert.match(result.detail, /reachable/i);
  });
});
