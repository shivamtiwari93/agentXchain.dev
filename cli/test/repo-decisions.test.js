import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI_PATH = resolve(__dirname, '..', 'bin', 'agentxchain.js');
import {
  readRepoDecisions,
  getActiveRepoDecisions,
  getRepoDecisionById,
  appendRepoDecision,
  overrideRepoDecision,
  validateOverride,
  resolveDecisionAuthority,
  renderRepoDecisionsMarkdown,
  buildRepoDecisionsSummary,
  REPO_DECISIONS_PATH,
} from '../src/lib/repo-decisions.js';

describe('repo-decisions', () => {
  let root;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'axc-repo-dec-'));
    mkdirSync(join(root, '.agentxchain'), { recursive: true });
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('returns empty array when no file exists', () => {
    assert.deepStrictEqual(readRepoDecisions(root), []);
    assert.deepStrictEqual(getActiveRepoDecisions(root), []);
  });

  it('appends and reads repo decisions', () => {
    const entry = {
      id: 'DEC-001',
      run_id: 'run_abc',
      turn_id: 'turn_001',
      role: 'architect',
      phase: 'planning',
      category: 'architecture',
      statement: 'Use PostgreSQL for persistence',
      rationale: 'Proven relational DB for our workload',
      durability: 'repo',
      overrides: null,
      status: 'active',
      overridden_by: null,
      created_at: '2026-04-15T00:00:00Z',
    };
    appendRepoDecision(root, entry);
    const all = readRepoDecisions(root);
    assert.strictEqual(all.length, 1);
    assert.strictEqual(all[0].id, 'DEC-001');
    assert.strictEqual(all[0].status, 'active');
    assert.strictEqual(all[0].durability, 'repo');
  });

  it('getActiveRepoDecisions filters to active only', () => {
    appendRepoDecision(root, { id: 'DEC-001', status: 'active', statement: 'a' });
    appendRepoDecision(root, { id: 'DEC-002', status: 'overridden', statement: 'b' });
    appendRepoDecision(root, { id: 'DEC-003', status: 'active', statement: 'c' });
    const active = getActiveRepoDecisions(root);
    assert.strictEqual(active.length, 2);
    assert.deepStrictEqual(active.map(d => d.id), ['DEC-001', 'DEC-003']);
  });

  it('getRepoDecisionById finds by ID', () => {
    appendRepoDecision(root, { id: 'DEC-010', status: 'active', statement: 'found' });
    appendRepoDecision(root, { id: 'DEC-020', status: 'active', statement: 'other' });
    const found = getRepoDecisionById(root, 'DEC-010');
    assert.strictEqual(found.statement, 'found');
    const missing = getRepoDecisionById(root, 'DEC-999');
    assert.strictEqual(missing, null);
  });

  it('overrideRepoDecision marks target as overridden', () => {
    appendRepoDecision(root, { id: 'DEC-001', status: 'active', statement: 'original' });
    appendRepoDecision(root, { id: 'DEC-002', status: 'active', statement: 'other' });
    overrideRepoDecision(root, 'DEC-001', 'DEC-003');
    const all = readRepoDecisions(root);
    const d1 = all.find(d => d.id === 'DEC-001');
    assert.strictEqual(d1.status, 'overridden');
    assert.strictEqual(d1.overridden_by, 'DEC-003');
    const d2 = all.find(d => d.id === 'DEC-002');
    assert.strictEqual(d2.status, 'active');
  });

  describe('validateOverride', () => {
    it('passes when target exists and is active', () => {
      appendRepoDecision(root, { id: 'DEC-001', status: 'active' });
      const result = validateOverride(root, { id: 'DEC-002', overrides: 'DEC-001' });
      assert.strictEqual(result.ok, true);
    });

    it('fails when target does not exist', () => {
      const result = validateOverride(root, { id: 'DEC-002', overrides: 'DEC-999' });
      assert.strictEqual(result.ok, false);
      assert.match(result.error, /does not exist/);
    });

    it('fails when target is already overridden', () => {
      appendRepoDecision(root, { id: 'DEC-001', status: 'overridden', overridden_by: 'DEC-050' });
      const result = validateOverride(root, { id: 'DEC-002', overrides: 'DEC-001' });
      assert.strictEqual(result.ok, false);
      assert.match(result.error, /already overridden/);
    });

    it('passes when no overrides field', () => {
      const result = validateOverride(root, { id: 'DEC-001' });
      assert.strictEqual(result.ok, true);
    });

    // ── Authority enforcement tests ───────────────────────────────────────
    it('allows override when no decision_authority configured (backward-compat)', () => {
      appendRepoDecision(root, { id: 'DEC-001', status: 'active', role: 'pm' });
      const config = { roles: { pm: { title: 'PM' }, dev: { title: 'Dev' } } };
      const result = validateOverride(root, { id: 'DEC-002', overrides: 'DEC-001', role: 'dev' }, config);
      assert.strictEqual(result.ok, true);
    });

    it('allows override when overriding role authority >= target role authority', () => {
      appendRepoDecision(root, { id: 'DEC-001', status: 'active', role: 'dev' });
      const config = {
        roles: {
          dev: { title: 'Dev', decision_authority: 20 },
          eng_director: { title: 'Director', decision_authority: 50 },
        },
      };
      const result = validateOverride(root, { id: 'DEC-002', overrides: 'DEC-001', role: 'eng_director' }, config);
      assert.strictEqual(result.ok, true);
    });

    it('rejects override when overriding role authority < target role authority', () => {
      appendRepoDecision(root, { id: 'DEC-001', status: 'active', role: 'eng_director' });
      const config = {
        roles: {
          dev: { title: 'Dev', decision_authority: 20 },
          eng_director: { title: 'Director', decision_authority: 50 },
        },
      };
      const result = validateOverride(root, { id: 'DEC-002', overrides: 'DEC-001', role: 'dev' }, config);
      assert.strictEqual(result.ok, false);
      assert.match(result.error, /authority 20.*cannot override.*authority 50/);
    });

    it('allows same-role override regardless of authority level', () => {
      appendRepoDecision(root, { id: 'DEC-001', status: 'active', role: 'pm' });
      const config = {
        roles: { pm: { title: 'PM', decision_authority: 30 } },
      };
      const result = validateOverride(root, { id: 'DEC-002', overrides: 'DEC-001', role: 'pm' }, config);
      assert.strictEqual(result.ok, true);
    });

    it('treats human-origin decisions as authority 100 by default', () => {
      appendRepoDecision(root, { id: 'DEC-001', status: 'active', role: 'human' });
      const config = {
        roles: {
          dev: { title: 'Dev', decision_authority: 50 },
        },
      };
      const result = validateOverride(root, { id: 'DEC-002', overrides: 'DEC-001', role: 'dev' }, config);
      assert.strictEqual(result.ok, false);
      assert.match(result.error, /authority 50.*cannot override.*authority 100/);
    });

    it('allows overriding human decision when human has explicit lower authority', () => {
      appendRepoDecision(root, { id: 'DEC-001', status: 'active', role: 'human' });
      const config = {
        roles: {
          human: { title: 'Human', decision_authority: 30 },
          eng_director: { title: 'Director', decision_authority: 50 },
        },
      };
      const result = validateOverride(root, { id: 'DEC-002', overrides: 'DEC-001', role: 'eng_director' }, config);
      assert.strictEqual(result.ok, true);
    });

    it('treats unknown target role as authority 0 with warning', () => {
      appendRepoDecision(root, { id: 'DEC-001', status: 'active', role: 'removed_role' });
      const config = {
        roles: {
          dev: { title: 'Dev', decision_authority: 10 },
        },
      };
      const result = validateOverride(root, { id: 'DEC-002', overrides: 'DEC-001', role: 'dev' }, config);
      assert.strictEqual(result.ok, true);
      assert.ok(result.warning);
      assert.match(result.warning, /removed_role.*not found/);
    });

    it('allows override when only one side has decision_authority (opt-in)', () => {
      appendRepoDecision(root, { id: 'DEC-001', status: 'active', role: 'pm' });
      const config = {
        roles: {
          pm: { title: 'PM' }, // no decision_authority
          dev: { title: 'Dev', decision_authority: 10 },
        },
      };
      const result = validateOverride(root, { id: 'DEC-002', overrides: 'DEC-001', role: 'dev' }, config);
      assert.strictEqual(result.ok, true);
    });
  });

  describe('resolveDecisionAuthority', () => {
    it('returns null when no config', () => {
      assert.strictEqual(resolveDecisionAuthority('dev', null), null);
    });

    it('returns null when role has no decision_authority', () => {
      const config = { roles: { dev: { title: 'Dev' } } };
      assert.strictEqual(resolveDecisionAuthority('dev', config), null);
    });

    it('returns configured level', () => {
      const config = { roles: { dev: { title: 'Dev', decision_authority: 20 } } };
      assert.strictEqual(resolveDecisionAuthority('dev', config), 20);
    });

    it('returns 100 for human by default', () => {
      const config = { roles: {} };
      assert.strictEqual(resolveDecisionAuthority('human', config), 100);
    });

    it('returns explicit human level when configured', () => {
      const config = { roles: { human: { decision_authority: 40 } } };
      assert.strictEqual(resolveDecisionAuthority('human', config), 40);
    });

    it('returns unknown marker for missing role', () => {
      const config = { roles: { dev: { title: 'Dev', decision_authority: 20 } } };
      const result = resolveDecisionAuthority('nonexistent', config);
      assert.strictEqual(result.level, 0);
      assert.strictEqual(result.unknown, true);
    });
  });

  describe('renderRepoDecisionsMarkdown', () => {
    it('returns empty string for no decisions', () => {
      assert.strictEqual(renderRepoDecisionsMarkdown([]), '');
      assert.strictEqual(renderRepoDecisionsMarkdown(null), '');
    });

    it('renders active decisions as markdown', () => {
      const md = renderRepoDecisionsMarkdown([
        { id: 'DEC-001', category: 'architecture', statement: 'Use PostgreSQL' },
        { id: 'DEC-002', category: 'process', statement: 'PRs need E2E tests', overrides: 'DEC-001' },
      ]);
      assert.match(md, /## Active Repo Decisions/);
      assert.match(md, /DEC-001.*architecture.*PostgreSQL/);
      assert.match(md, /DEC-002.*process.*E2E tests/);
      assert.match(md, /Supersedes DEC-001/);
      assert.match(md, /Comply or explicitly override/);
    });
  });

  describe('buildRepoDecisionsSummary', () => {
    it('preserves override lineage on active and overridden entries', () => {
      const summary = buildRepoDecisionsSummary([
        {
          id: 'DEC-001',
          category: 'architecture',
          statement: 'Use PostgreSQL',
          role: 'architect',
          run_id: 'run_001',
          status: 'overridden',
          overridden_by: 'DEC-002',
          overrides: null,
          durability: 'repo',
        },
        {
          id: 'DEC-002',
          category: 'architecture',
          statement: 'Move to SQLite for local-first mode',
          role: 'architect',
          run_id: 'run_002',
          status: 'active',
          overrides: 'DEC-001',
          durability: 'repo',
        },
      ]);

      assert.equal(summary.active[0].overrides, 'DEC-001');
      assert.equal(summary.active[0].durability, 'repo');
      assert.equal(summary.overridden[0].overridden_by, 'DEC-002');
      assert.equal(summary.overridden[0].overrides, null);
    });
  });
});

describe('repo-decisions integration with governed-state', () => {
  let root;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'axc-repo-dec-int-'));
    mkdirSync(join(root, '.agentxchain'), { recursive: true });
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('initializeGovernedRun loads active repo decisions into state', async () => {
    // Set up a project with repo decisions
    appendRepoDecision(root, { id: 'DEC-001', status: 'active', category: 'architecture', statement: 'Use PostgreSQL' });
    appendRepoDecision(root, { id: 'DEC-002', status: 'overridden', category: 'process', statement: 'Old rule' });
    appendRepoDecision(root, { id: 'DEC-003', status: 'active', category: 'quality', statement: 'E2E required' });

    // Write minimal config
    writeFileSync(join(root, 'agentxchain.json'), JSON.stringify({
      project: { name: 'test-repo-dec', id: 'proj_test' },
      roles: { dev: { model: 'test' } },
      phases: ['dev'],
    }));

    const { initializeGovernedRun } = await import('../src/lib/governed-state.js');
    const result = initializeGovernedRun(root, {
      project: { name: 'test-repo-dec', id: 'proj_test' },
      roles: { dev: { model: 'test' } },
      phases: ['dev'],
    });

    assert.strictEqual(result.ok, true);
    assert.ok(result.state.repo_decisions, 'repo_decisions should be present in state');
    assert.strictEqual(result.state.repo_decisions.length, 2, 'only active decisions should be loaded');
    assert.deepStrictEqual(result.state.repo_decisions.map(d => d.id), ['DEC-001', 'DEC-003']);
  });

  it('initializeGovernedRun sets repo_decisions to null when none exist', async () => {
    writeFileSync(join(root, 'agentxchain.json'), JSON.stringify({
      project: { name: 'test-empty', id: 'proj_test2' },
      roles: { dev: { model: 'test' } },
      phases: ['dev'],
    }));

    const { initializeGovernedRun } = await import('../src/lib/governed-state.js');
    const result = initializeGovernedRun(root, {
      project: { name: 'test-empty', id: 'proj_test2' },
      roles: { dev: { model: 'test' } },
      phases: ['dev'],
    });

    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.state.repo_decisions, null);
  });
});

describe('turn-result-validator decision extensions', () => {
  it('accepts decisions with durability and overrides fields', async () => {
    // Import the validateDecision indirectly through the staged validator
    // Instead, test through the schema
    const schema = JSON.parse(readFileSync(
      resolve(__dirname, '..', 'src', 'lib', 'schemas', 'turn-result.schema.json'),
      'utf8'
    ));
    const decisionSchema = schema.properties.decisions.items;

    // durability field exists
    assert.ok(decisionSchema.properties.durability, 'durability field should exist in schema');
    assert.deepStrictEqual(decisionSchema.properties.durability.enum, ['run', 'repo']);

    // overrides field exists
    assert.ok(decisionSchema.properties.overrides, 'overrides field should exist in schema');
    assert.strictEqual(decisionSchema.properties.overrides.pattern, '^DEC-\\d+$');

    // required fields unchanged
    assert.deepStrictEqual(decisionSchema.required, ['id', 'category', 'statement', 'rationale']);
  });
});

describe('decisions CLI command', () => {
  it('runs without error on empty project', async () => {
    const { execSync } = await import('node:child_process');
    const cliPath = CLI_PATH;

    // Create a temp project
    const tmpRoot = mkdtempSync(join(tmpdir(), 'axc-dec-cli-'));
    mkdirSync(join(tmpRoot, '.agentxchain'), { recursive: true });
    writeFileSync(join(tmpRoot, 'agentxchain.json'), JSON.stringify({
      project: { name: 'test-cli', id: 'proj_cli' },
      roles: { dev: { model: 'test' } },
      phases: ['dev'],
    }));

    try {
      const output = execSync(`node "${cliPath}" decisions --json --dir ${tmpRoot}`, { encoding: 'utf8' });
      const parsed = JSON.parse(output.trim());
      assert.ok(Array.isArray(parsed));
      assert.strictEqual(parsed.length, 0);
    } finally {
      rmSync(tmpRoot, { recursive: true, force: true });
    }
  });

  it('lists active repo decisions', async () => {
    const { execSync } = await import('node:child_process');
    const cliPath = CLI_PATH;

    const tmpRoot = mkdtempSync(join(tmpdir(), 'axc-dec-cli2-'));
    mkdirSync(join(tmpRoot, '.agentxchain'), { recursive: true });
    writeFileSync(join(tmpRoot, 'agentxchain.json'), JSON.stringify({
      project: { name: 'test-cli2', id: 'proj_cli2' },
      roles: { dev: { model: 'test' } },
      phases: ['dev'],
    }));

    // Write repo decisions
    appendRepoDecision(tmpRoot, { id: 'DEC-001', status: 'active', category: 'arch', statement: 'Use PG' });
    appendRepoDecision(tmpRoot, { id: 'DEC-002', status: 'overridden', category: 'process', statement: 'Old' });

    try {
      const output = execSync(`node "${cliPath}" decisions --json --dir ${tmpRoot}`, { encoding: 'utf8' });
      const parsed = JSON.parse(output.trim());
      assert.strictEqual(parsed.length, 1);
      assert.strictEqual(parsed[0].id, 'DEC-001');
    } finally {
      rmSync(tmpRoot, { recursive: true, force: true });
    }
  });

  it('lists all decisions with --all', async () => {
    const { execSync } = await import('node:child_process');
    const cliPath = CLI_PATH;

    const tmpRoot = mkdtempSync(join(tmpdir(), 'axc-dec-cli3-'));
    mkdirSync(join(tmpRoot, '.agentxchain'), { recursive: true });
    writeFileSync(join(tmpRoot, 'agentxchain.json'), JSON.stringify({
      project: { name: 'test-cli3', id: 'proj_cli3' },
      roles: { dev: { model: 'test' } },
      phases: ['dev'],
    }));

    appendRepoDecision(tmpRoot, { id: 'DEC-001', status: 'active', category: 'arch', statement: 'Use PG' });
    appendRepoDecision(tmpRoot, { id: 'DEC-002', status: 'overridden', category: 'process', statement: 'Old', overridden_by: 'DEC-003' });

    try {
      const output = execSync(`node "${cliPath}" decisions --json --all --dir ${tmpRoot}`, { encoding: 'utf8' });
      const parsed = JSON.parse(output.trim());
      assert.strictEqual(parsed.length, 2);
    } finally {
      rmSync(tmpRoot, { recursive: true, force: true });
    }
  });

  it('shows single decision with --show', async () => {
    const { execSync } = await import('node:child_process');
    const cliPath = CLI_PATH;

    const tmpRoot = mkdtempSync(join(tmpdir(), 'axc-dec-cli4-'));
    mkdirSync(join(tmpRoot, '.agentxchain'), { recursive: true });
    writeFileSync(join(tmpRoot, 'agentxchain.json'), JSON.stringify({
      project: { name: 'test-cli4', id: 'proj_cli4' },
      roles: { dev: { model: 'test' } },
      phases: ['dev'],
    }));

    appendRepoDecision(tmpRoot, {
      id: 'DEC-042',
      status: 'active',
      category: 'architecture',
      statement: 'Use PostgreSQL',
      rationale: 'Proven relational DB',
      role: 'architect',
      phase: 'planning',
      run_id: 'run_abc123',
      turn_id: 'turn_001',
      created_at: '2026-04-15T00:00:00Z',
    });

    try {
      const output = execSync(`node "${cliPath}" decisions --json --show DEC-042 --dir ${tmpRoot}`, { encoding: 'utf8' });
      const parsed = JSON.parse(output.trim());
      assert.strictEqual(parsed.id, 'DEC-042');
      assert.strictEqual(parsed.statement, 'Use PostgreSQL');
      assert.strictEqual(parsed.category, 'architecture');
    } finally {
      rmSync(tmpRoot, { recursive: true, force: true });
    }
  });
});
