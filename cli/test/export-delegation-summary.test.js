import { strict as assert } from 'node:assert';
import { describe, it } from 'vitest';
import {
  mkdtempSync,
  mkdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI_BIN = join(__dirname, '..', 'bin', 'agentxchain.js');

function writeJson(filePath, value) {
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, JSON.stringify(value, null, 2) + '\n');
}

function writeJsonl(filePath, entries) {
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, entries.map((entry) => JSON.stringify(entry)).join('\n') + '\n');
}

function runCli(cwd, args) {
  return spawnSync(process.execPath, [CLI_BIN, ...args], {
    cwd,
    encoding: 'utf8',
    timeout: 15000,
    env: { ...process.env, NODE_NO_WARNINGS: '1' },
  });
}

function createBaseProject(historyEntries) {
  const root = mkdtempSync(join(tmpdir(), 'axc-export-del-'));

  writeJson(join(root, 'agentxchain.json'), {
    schema_version: '1.0',
    template: 'generic',
    project: { id: 'del-export-test', name: 'Delegation Export Test', default_branch: 'main' },
    roles: {
      director: { title: 'Director', mandate: 'Direct.', write_authority: 'authoritative', runtime: 'manual-director' },
      dev: { title: 'Developer', mandate: 'Implement.', write_authority: 'authoritative', runtime: 'manual-dev' },
      qa: { title: 'QA', mandate: 'Verify.', write_authority: 'review_only', runtime: 'manual-qa' },
    },
    runtimes: {
      'manual-director': { type: 'manual' },
      'manual-dev': { type: 'manual' },
      'manual-qa': { type: 'manual' },
    },
    routing: {
      implementation: { entry_role: 'director', allowed_next_roles: ['director', 'dev', 'qa', 'human'] },
    },
    gates: {},
    hooks: {},
  });

  writeJson(join(root, '.agentxchain', 'state.json'), {
    schema_version: '1.1',
    project_id: 'del-export-test',
    run_id: 'run_del_001',
    status: 'completed',
    phase: 'implementation',
    active_turns: {},
    retained_turns: {},
    turn_sequence: 4,
    blocked_on: null,
    phase_gate_status: {},
    protocol_mode: 'governed',
  });

  writeJsonl(join(root, '.agentxchain', 'history.jsonl'), historyEntries);
  writeJsonl(join(root, '.agentxchain', 'decision-ledger.jsonl'), []);

  return root;
}

describe('export delegation summary', () => {
  it('AT-EXPORT-DEL-001: no delegations produces empty delegation_summary', () => {
    const root = createBaseProject([
      { turn_id: 'turn_001', role: 'director', status: 'completed' },
      { turn_id: 'turn_002', role: 'dev', status: 'completed' },
    ]);
    try {
      const result = runCli(root, ['export', '--format', 'json']);
      assert.equal(result.status, 0, result.stderr);
      const exported = JSON.parse(result.stdout);
      const ds = exported.summary.delegation_summary;
      assert.ok(ds, 'delegation_summary should exist');
      assert.equal(ds.total_delegations_issued, 0);
      assert.deepEqual(ds.delegation_chains, []);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('AT-EXPORT-DEL-002: completed delegation chain has correct structure', () => {
    const root = createBaseProject([
      {
        turn_id: 'turn_001',
        role: 'director',
        status: 'completed',
        delegations_issued: [
          { id: 'del-001', to_role: 'dev', charter: 'Implement feature', acceptance_contract: 'Tests pass', required_decision_ids: ['DEC-101'] },
          { id: 'del-002', to_role: 'qa', charter: 'Verify feature', acceptance_contract: 'QA passes' },
        ],
      },
      {
        turn_id: 'turn_002',
        role: 'dev',
        status: 'completed',
        delegation_context: {
          delegation_id: 'del-001',
          parent_turn_id: 'turn_001',
          parent_role: 'director',
          charter: 'Implement feature',
          acceptance_contract: 'Tests pass',
          required_decision_ids: ['DEC-101'],
        },
      },
      {
        turn_id: 'turn_003',
        role: 'qa',
        status: 'completed',
        delegation_context: {
          delegation_id: 'del-002',
          parent_turn_id: 'turn_001',
          parent_role: 'director',
          charter: 'Verify feature',
          acceptance_contract: 'QA passes',
        },
      },
      {
        turn_id: 'turn_004',
        role: 'director',
        status: 'completed',
        delegation_review: {
          parent_turn_id: 'turn_001',
          results: [
            { delegation_id: 'del-001', status: 'completed', satisfied_decision_ids: ['DEC-101'], missing_decision_ids: [] },
            { delegation_id: 'del-002', status: 'completed' },
          ],
        },
      },
    ]);
    try {
      const result = runCli(root, ['export', '--format', 'json']);
      assert.equal(result.status, 0, result.stderr);
      const exported = JSON.parse(result.stdout);
      const ds = exported.summary.delegation_summary;
      assert.equal(ds.total_delegations_issued, 2);
      assert.equal(ds.delegation_chains.length, 1);

      const chain = ds.delegation_chains[0];
      assert.equal(chain.parent_turn_id, 'turn_001');
      assert.equal(chain.parent_role, 'director');
      assert.equal(chain.review_turn_id, 'turn_004');
      assert.equal(chain.outcome, 'completed');
      assert.equal(chain.delegations.length, 2);
      assert.equal(chain.delegations[0].delegation_id, 'del-001');
      assert.equal(chain.delegations[0].to_role, 'dev');
      assert.equal(chain.delegations[0].charter, 'Implement feature');
      assert.deepEqual(chain.delegations[0].required_decision_ids, ['DEC-101']);
      assert.deepEqual(chain.delegations[0].satisfied_decision_ids, ['DEC-101']);
      assert.deepEqual(chain.delegations[0].missing_decision_ids, []);
      assert.equal(chain.delegations[0].status, 'completed');
      assert.equal(chain.delegations[0].child_turn_id, 'turn_002');
      assert.equal(chain.delegations[1].delegation_id, 'del-002');
      assert.equal(chain.delegations[1].to_role, 'qa');
      assert.equal(chain.delegations[1].child_turn_id, 'turn_003');
      assert.deepEqual(chain.delegations[1].required_decision_ids, []);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('AT-EXPORT-DEL-003: mixed-outcome chain has outcome "mixed"', () => {
    const root = createBaseProject([
      {
        turn_id: 'turn_001',
        role: 'director',
        status: 'completed',
        delegations_issued: [
          { id: 'del-001', to_role: 'dev', charter: 'Build X', acceptance_contract: 'Works' },
          { id: 'del-002', to_role: 'qa', charter: 'Test X', acceptance_contract: 'Passes' },
        ],
      },
      {
        turn_id: 'turn_002',
        role: 'dev',
        status: 'completed',
        delegation_context: { delegation_id: 'del-001', parent_turn_id: 'turn_001', parent_role: 'director', charter: 'Build X', acceptance_contract: 'Works' },
      },
      {
        turn_id: 'turn_003',
        role: 'qa',
        status: 'failed',
        delegation_context: { delegation_id: 'del-002', parent_turn_id: 'turn_001', parent_role: 'director', charter: 'Test X', acceptance_contract: 'Passes' },
      },
      {
        turn_id: 'turn_004',
        role: 'director',
        status: 'completed',
        delegation_review: {
          parent_turn_id: 'turn_001',
          results: [
            { delegation_id: 'del-001', status: 'completed' },
            { delegation_id: 'del-002', status: 'failed' },
          ],
        },
      },
    ]);
    try {
      const result = runCli(root, ['export', '--format', 'json']);
      assert.equal(result.status, 0, result.stderr);
      const exported = JSON.parse(result.stdout);
      const ds = exported.summary.delegation_summary;
      assert.equal(ds.delegation_chains[0].outcome, 'mixed');
      assert.equal(ds.delegation_chains[0].delegations[0].status, 'completed');
      assert.equal(ds.delegation_chains[0].delegations[1].status, 'failed');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('AT-EXPORT-DEL-004: in-progress chain (no review turn) has outcome "pending"', () => {
    const root = createBaseProject([
      {
        turn_id: 'turn_001',
        role: 'director',
        status: 'completed',
        delegations_issued: [
          { id: 'del-001', to_role: 'dev', charter: 'Build Y', acceptance_contract: 'Works' },
        ],
      },
      {
        turn_id: 'turn_002',
        role: 'dev',
        status: 'completed',
        delegation_context: { delegation_id: 'del-001', parent_turn_id: 'turn_001', parent_role: 'director', charter: 'Build Y', acceptance_contract: 'Works' },
      },
    ]);
    try {
      const result = runCli(root, ['export', '--format', 'json']);
      assert.equal(result.status, 0, result.stderr);
      const exported = JSON.parse(result.stdout);
      const ds = exported.summary.delegation_summary;
      assert.equal(ds.total_delegations_issued, 1);
      assert.equal(ds.delegation_chains.length, 1);
      assert.equal(ds.delegation_chains[0].outcome, 'pending');
      assert.equal(ds.delegation_chains[0].review_turn_id, null);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
