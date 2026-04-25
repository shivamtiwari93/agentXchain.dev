import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomBytes } from 'node:crypto';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';

import { createAgentXchainMcpServer } from '../src/lib/mcp-server.js';

function makeTmpDir() {
  const dir = join(tmpdir(), `axc-mcp-server-test-${randomBytes(6).toString('hex')}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function writeJson(filePath, data) {
  writeFileSync(filePath, JSON.stringify(data, null, 2));
}

function makeGovernedFixture() {
  const root = makeTmpDir();
  const axcDir = join(root, '.agentxchain');
  mkdirSync(axcDir, { recursive: true });

  // agentxchain.json
  writeJson(join(root, 'agentxchain.json'), {
    schema_version: 4,
    protocol_mode: 'governed',
    project: { id: 'test-project', name: 'Test MCP Server Project', default_branch: 'main' },
    roles: {
      pm: { title: 'PM', mandate: 'Plan work.', write_authority: 'proposed', runtime: 'manual-pm' },
      dev: { title: 'Developer', mandate: 'Build features.', write_authority: 'authoritative', runtime: 'manual-dev' },
    },
    runtimes: {
      'manual-pm': { type: 'manual' },
      'manual-dev': { type: 'manual' },
    },
    routing: { planning: { entry_role: 'pm' }, implementation: { entry_role: 'dev' } },
  });

  // state.json
  writeJson(join(axcDir, 'state.json'), {
    project_id: 'test-project',
    run_id: 'run_mcp_test_001',
    status: 'active',
    phase: 'implementation',
    accepted_integration_ref: 'git:abc123',
    current_turn: null,
    active_turns: {},
    last_completed_turn_id: null,
    blocked_on: null,
    escalation: null,
    budget_status: { spent_usd: 0, remaining_usd: 50 },
    phase_gate_status: {},
  });

  // events.jsonl
  const events = [
    { event_type: 'run_started', timestamp: '2026-04-25T00:00:00Z', run_id: 'run_mcp_test_001' },
    { event_type: 'turn_dispatched', timestamp: '2026-04-25T00:01:00Z', turn_id: 'turn_001', role: 'pm' },
    { event_type: 'turn_accepted', timestamp: '2026-04-25T00:02:00Z', turn_id: 'turn_001', role: 'pm' },
  ];
  writeFileSync(join(axcDir, 'events.jsonl'), events.map((e) => JSON.stringify(e)).join('\n') + '\n');

  // run-history.jsonl
  const history = [
    { turn_id: 'turn_001', role: 'pm', status: 'accepted', phase: 'planning', completed_at: '2026-04-25T00:02:00Z' },
  ];
  writeFileSync(join(axcDir, 'run-history.jsonl'), history.map((h) => JSON.stringify(h)).join('\n') + '\n');

  return root;
}

async function connectPair(root) {
  const server = createAgentXchainMcpServer(root);
  const client = new Client({ name: 'test-client', version: '1.0.0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

  await server.connect(serverTransport);
  await client.connect(clientTransport);

  return { server, client, close: async () => { await client.close(); await server.close(); } };
}

const cleanups = [];
afterEach(() => {
  for (const dir of cleanups) {
    try { rmSync(dir, { recursive: true, force: true }); } catch {}
  }
  cleanups.length = 0;
});

describe('AgentXchain MCP Server', () => {
  it('AT-MCP-SRV-001: lists all 5 governance tools after initialize', async () => {
    const root = makeGovernedFixture();
    cleanups.push(root);
    const { client, close } = await connectPair(root);
    try {
      const result = await client.listTools();
      const names = result.tools.map((t) => t.name).sort();
      assert.deepStrictEqual(names, [
        'agentxchain_approve_gate',
        'agentxchain_events',
        'agentxchain_history',
        'agentxchain_intake_record',
        'agentxchain_status',
      ]);
    } finally {
      await close();
    }
  });

  it('AT-MCP-SRV-002: agentxchain_status returns valid status for a governed project', async () => {
    const root = makeGovernedFixture();
    cleanups.push(root);
    const { client, close } = await connectPair(root);
    try {
      const result = await client.callTool({ name: 'agentxchain_status', arguments: {} });
      const text = result.content.find((c) => c.type === 'text')?.text;
      assert.ok(text, 'Expected text content in tool result');
      const data = JSON.parse(text);
      assert.strictEqual(data.ok, true);
      assert.strictEqual(data.run_id, 'run_mcp_test_001');
      assert.strictEqual(data.phase, 'implementation');
      assert.strictEqual(data.status, 'active');
      assert.strictEqual(data.protocol_mode, 'governed');
    } finally {
      await close();
    }
  });

  it('AT-MCP-SRV-003: agentxchain_events returns events with limit', async () => {
    const root = makeGovernedFixture();
    cleanups.push(root);
    const { client, close } = await connectPair(root);
    try {
      const result = await client.callTool({ name: 'agentxchain_events', arguments: { limit: 2 } });
      const data = JSON.parse(result.content.find((c) => c.type === 'text').text);
      assert.strictEqual(data.ok, true);
      assert.ok(Array.isArray(data.events), 'events should be an array');
      assert.ok(data.events.length <= 2, `Expected at most 2 events, got ${data.events.length}`);
    } finally {
      await close();
    }
  });

  it('AT-MCP-SRV-004: agentxchain_history returns history entries', async () => {
    const root = makeGovernedFixture();
    cleanups.push(root);
    const { client, close } = await connectPair(root);
    try {
      const result = await client.callTool({ name: 'agentxchain_history', arguments: {} });
      const data = JSON.parse(result.content.find((c) => c.type === 'text').text);
      assert.strictEqual(data.ok, true);
      assert.ok(Array.isArray(data.entries), 'entries should be an array');
      assert.ok(data.entries.length >= 1, 'Should have at least 1 history entry');
      assert.strictEqual(data.entries[0].turn_id, 'turn_001');
    } finally {
      await close();
    }
  });

  it('AT-MCP-SRV-005: agentxchain_approve_gate returns error when run is not blocked', async () => {
    const root = makeGovernedFixture();
    cleanups.push(root);
    const { client, close } = await connectPair(root);
    try {
      const result = await client.callTool({
        name: 'agentxchain_approve_gate',
        arguments: { gate_id: 'hesc_nonexistent' },
      });
      const data = JSON.parse(result.content.find((c) => c.type === 'text').text);
      assert.strictEqual(data.ok, false);
      assert.ok(data.error, `Expected an error message, got: ${JSON.stringify(data)}`);
    } finally {
      await close();
    }
  });

  it('AT-MCP-SRV-006: agentxchain_status on non-governed directory returns error', async () => {
    const root = makeTmpDir();
    cleanups.push(root);
    const { client, close } = await connectPair(root);
    try {
      const result = await client.callTool({ name: 'agentxchain_status', arguments: {} });
      const data = JSON.parse(result.content.find((c) => c.type === 'text').text);
      assert.strictEqual(data.ok, false);
      assert.ok(data.error.includes('No governed project'), `Error should mention no project: ${data.error}`);
    } finally {
      await close();
    }
  });

  it('AT-MCP-SRV-007: agentxchain://state resource returns state.json contents', async () => {
    const root = makeGovernedFixture();
    cleanups.push(root);
    const { client, close } = await connectPair(root);
    try {
      const result = await client.readResource({ uri: 'agentxchain://state' });
      assert.ok(result.contents.length > 0, 'Should have at least one content entry');
      const text = result.contents[0].text;
      const state = JSON.parse(text);
      assert.strictEqual(state.run_id, 'run_mcp_test_001');
    } finally {
      await close();
    }
  });

  it('AT-MCP-SRV-008: agentxchain://session resource returns empty when no session exists', async () => {
    const root = makeGovernedFixture();
    cleanups.push(root);
    const { client, close } = await connectPair(root);
    try {
      const result = await client.readResource({ uri: 'agentxchain://session' });
      assert.ok(result.contents.length > 0);
      const data = JSON.parse(result.contents[0].text);
      assert.deepStrictEqual(data, {});
    } finally {
      await close();
    }
  });

  it('AT-MCP-SRV-009: agentxchain_intake_record requires non-empty source and title', async () => {
    const root = makeGovernedFixture();
    cleanups.push(root);
    const { client, close } = await connectPair(root);
    try {
      // Empty strings should be rejected by the handler
      const result = await client.callTool({
        name: 'agentxchain_intake_record',
        arguments: { source: '', title: '' },
      });
      const data = JSON.parse(result.content.find((c) => c.type === 'text').text);
      assert.strictEqual(data.ok, false);
      assert.ok(data.error, 'Should have an error message');
    } finally {
      await close();
    }
  });
});
