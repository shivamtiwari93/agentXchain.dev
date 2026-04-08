/**
 * Tests for proposal apply/reject/list/diff workflow.
 *
 * Validates all acceptance tests from PROPOSAL_APPLY_REJECT_SPEC.md:
 *   - list shows pending/applied/rejected proposals
 *   - apply copies files to workspace and creates APPLIED.json
 *   - apply --file selective application
 *   - apply --dry-run shows changes without writing
 *   - apply on already-applied errors
 *   - reject creates REJECTED.json
 *   - reject on already-rejected errors
 *   - reject without reason errors
 *   - diff shows unified diff against workspace
 *   - both apply and reject write decision-ledger entries
 *   - apply with delete action removes workspace file
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { randomBytes } from 'crypto';

import {
  listProposals,
  diffProposal,
  applyProposal,
  rejectProposal,
} from '../src/lib/proposal-ops.js';

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeTmpDir() {
  const dir = join(tmpdir(), `axc-proposal-${randomBytes(6).toString('hex')}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function scaffoldProposal(root, turnId, files, opts = {}) {
  const proposalDir = join(root, '.agentxchain/proposed', turnId);
  mkdirSync(proposalDir, { recursive: true });

  const fileLines = files.map((f) => `- \`${f.path}\` — ${f.action}`).join('\n');
  const proposalMd = [
    `# Proposed Changes — ${turnId}`,
    '',
    `**Role:** ${opts.role || 'dev'}`,
    `**Runtime:** ${opts.runtime || 'api-dev'}`,
    `**Status:** completed`,
    '',
    '## Summary',
    '',
    opts.summary || 'Test proposal',
    '',
    '## Files',
    '',
    fileLines,
    '',
  ].join('\n');
  writeFileSync(join(proposalDir, 'PROPOSAL.md'), proposalMd);

  for (const f of files) {
    if (f.action === 'delete') continue;
    if (f.content != null) {
      const filePath = join(proposalDir, f.path);
      mkdirSync(join(filePath, '..'), { recursive: true });
      writeFileSync(filePath, f.content);
    }
  }

  return proposalDir;
}

function readLedger(root) {
  const ledgerPath = join(root, '.agentxchain/decision-ledger.jsonl');
  if (!existsSync(ledgerPath)) return [];
  return readFileSync(ledgerPath, 'utf8')
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('proposal-ops', () => {
  let root;

  beforeEach(() => {
    root = makeTmpDir();
    mkdirSync(join(root, '.agentxchain'), { recursive: true });
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  // --- list ---

  describe('listProposals', () => {
    it('returns empty array when no proposals exist', () => {
      const result = listProposals(root);
      assert.ok(result.ok);
      assert.deepStrictEqual(result.proposals, []);
    });

    it('lists pending proposals with correct metadata', () => {
      scaffoldProposal(root, 'turn-001', [
        { path: 'src/foo.js', action: 'create', content: 'console.log("foo")' },
        { path: 'src/bar.js', action: 'modify', content: 'updated' },
      ], { role: 'dev' });

      const result = listProposals(root);
      assert.ok(result.ok);
      assert.strictEqual(result.proposals.length, 1);
      assert.strictEqual(result.proposals[0].turn_id, 'turn-001');
      assert.strictEqual(result.proposals[0].role, 'dev');
      assert.strictEqual(result.proposals[0].file_count, 2);
      assert.strictEqual(result.proposals[0].status, 'pending');
    });

    it('shows applied status after apply', () => {
      scaffoldProposal(root, 'turn-002', [
        { path: 'src/x.js', action: 'create', content: 'x' },
      ]);
      applyProposal(root, 'turn-002');

      const result = listProposals(root);
      assert.strictEqual(result.proposals[0].status, 'applied');
    });

    it('shows rejected status after reject', () => {
      scaffoldProposal(root, 'turn-003', [
        { path: 'src/y.js', action: 'create', content: 'y' },
      ]);
      rejectProposal(root, 'turn-003', 'not needed');

      const result = listProposals(root);
      assert.strictEqual(result.proposals[0].status, 'rejected');
    });
  });

  // --- apply ---

  describe('applyProposal', () => {
    it('copies proposed files to workspace', () => {
      scaffoldProposal(root, 'turn-010', [
        { path: 'src/new-file.js', action: 'create', content: 'export default 42;\n' },
        { path: 'lib/updated.js', action: 'modify', content: 'module.exports = true;\n' },
      ]);

      const result = applyProposal(root, 'turn-010');
      assert.ok(result.ok);
      assert.strictEqual(result.dry_run, false);
      assert.deepStrictEqual(result.applied_files, ['src/new-file.js', 'lib/updated.js']);

      assert.strictEqual(readFileSync(join(root, 'src/new-file.js'), 'utf8'), 'export default 42;\n');
      assert.strictEqual(readFileSync(join(root, 'lib/updated.js'), 'utf8'), 'module.exports = true;\n');

      assert.ok(existsSync(join(root, '.agentxchain/proposed/turn-010/APPLIED.json')));
    });

    it('handles delete action — removes workspace file', () => {
      writeFileSync(join(root, 'legacy.js'), 'old code');
      scaffoldProposal(root, 'turn-011', [
        { path: 'legacy.js', action: 'delete' },
      ]);

      const result = applyProposal(root, 'turn-011');
      assert.ok(result.ok);
      assert.deepStrictEqual(result.applied_files, ['legacy.js']);
      assert.ok(!existsSync(join(root, 'legacy.js')));
    });

    it('selective apply with --file', () => {
      scaffoldProposal(root, 'turn-012', [
        { path: 'a.js', action: 'create', content: 'a' },
        { path: 'b.js', action: 'create', content: 'b' },
      ]);

      const result = applyProposal(root, 'turn-012', { file: 'a.js' });
      assert.ok(result.ok);
      assert.deepStrictEqual(result.applied_files, ['a.js']);
      assert.ok(existsSync(join(root, 'a.js')));
      assert.ok(!existsSync(join(root, 'b.js')));
    });

    it('dry run shows files without writing', () => {
      scaffoldProposal(root, 'turn-013', [
        { path: 'x.js', action: 'create', content: 'x' },
      ]);

      const result = applyProposal(root, 'turn-013', { dryRun: true });
      assert.ok(result.ok);
      assert.strictEqual(result.dry_run, true);
      assert.ok(!existsSync(join(root, 'x.js')));
      assert.ok(!existsSync(join(root, '.agentxchain/proposed/turn-013/APPLIED.json')));
    });

    it('errors on already-applied proposal', () => {
      scaffoldProposal(root, 'turn-014', [
        { path: 'z.js', action: 'create', content: 'z' },
      ]);
      applyProposal(root, 'turn-014');

      const result = applyProposal(root, 'turn-014');
      assert.ok(!result.ok);
      assert.match(result.error, /already been applied/);
    });

    it('errors on already-rejected proposal', () => {
      scaffoldProposal(root, 'turn-015', [
        { path: 'q.js', action: 'create', content: 'q' },
      ]);
      rejectProposal(root, 'turn-015', 'nope');

      const result = applyProposal(root, 'turn-015');
      assert.ok(!result.ok);
      assert.match(result.error, /already been rejected/);
    });

    it('errors when --file targets non-existent path', () => {
      scaffoldProposal(root, 'turn-016', [
        { path: 'real.js', action: 'create', content: 'real' },
      ]);

      const result = applyProposal(root, 'turn-016', { file: 'fake.js' });
      assert.ok(!result.ok);
      assert.match(result.error, /not part of proposal/);
    });

    it('errors on missing proposal directory', () => {
      const result = applyProposal(root, 'nonexistent');
      assert.ok(!result.ok);
      assert.match(result.error, /No proposal found/);
    });

    it('writes decision-ledger entry on apply', () => {
      scaffoldProposal(root, 'turn-017', [
        { path: 'f.js', action: 'create', content: 'f' },
      ]);

      applyProposal(root, 'turn-017');
      const entries = readLedger(root);
      const entry = entries.find((e) => e.id === 'DEC-PROP-APPLY-turn-017');
      assert.ok(entry, 'ledger entry should exist');
      assert.strictEqual(entry.action, 'applied');
      assert.deepStrictEqual(entry.files, ['f.js']);
    });
  });

  // --- reject ---

  describe('rejectProposal', () => {
    it('creates REJECTED.json with reason', () => {
      scaffoldProposal(root, 'turn-020', [
        { path: 'r.js', action: 'create', content: 'r' },
      ]);

      const result = rejectProposal(root, 'turn-020', 'Code quality insufficient');
      assert.ok(result.ok);

      const rejected = JSON.parse(readFileSync(join(root, '.agentxchain/proposed/turn-020/REJECTED.json'), 'utf8'));
      assert.strictEqual(rejected.reason, 'Code quality insufficient');
    });

    it('errors without --reason', () => {
      scaffoldProposal(root, 'turn-021', [
        { path: 's.js', action: 'create', content: 's' },
      ]);

      const result = rejectProposal(root, 'turn-021', '');
      assert.ok(!result.ok);
      assert.match(result.error, /--reason is required/);
    });

    it('errors on already-rejected proposal', () => {
      scaffoldProposal(root, 'turn-022', [
        { path: 't.js', action: 'create', content: 't' },
      ]);
      rejectProposal(root, 'turn-022', 'first');

      const result = rejectProposal(root, 'turn-022', 'second');
      assert.ok(!result.ok);
      assert.match(result.error, /already been rejected/);
    });

    it('errors on already-applied proposal', () => {
      scaffoldProposal(root, 'turn-023', [
        { path: 'u.js', action: 'create', content: 'u' },
      ]);
      applyProposal(root, 'turn-023');

      const result = rejectProposal(root, 'turn-023', 'too late');
      assert.ok(!result.ok);
      assert.match(result.error, /already been applied/);
    });

    it('writes decision-ledger entry on reject', () => {
      scaffoldProposal(root, 'turn-024', [
        { path: 'v.js', action: 'create', content: 'v' },
      ]);

      rejectProposal(root, 'turn-024', 'not aligned');
      const entries = readLedger(root);
      const entry = entries.find((e) => e.id === 'DEC-PROP-REJECT-turn-024');
      assert.ok(entry, 'ledger entry should exist');
      assert.strictEqual(entry.action, 'rejected');
      assert.strictEqual(entry.reason, 'not aligned');
    });
  });

  // --- diff ---

  describe('diffProposal', () => {
    it('shows diff for new file', () => {
      scaffoldProposal(root, 'turn-030', [
        { path: 'new.js', action: 'create', content: 'new content\n' },
      ]);

      const result = diffProposal(root, 'turn-030');
      assert.ok(result.ok);
      assert.strictEqual(result.diffs.length, 1);
      assert.strictEqual(result.diffs[0].action, 'create');
      assert.match(result.diffs[0].preview, /new file/);
    });

    it('shows diff for modified file', () => {
      writeFileSync(join(root, 'existing.js'), 'old line\n');
      scaffoldProposal(root, 'turn-031', [
        { path: 'existing.js', action: 'modify', content: 'new line\n' },
      ]);

      const result = diffProposal(root, 'turn-031');
      assert.ok(result.ok);
      assert.strictEqual(result.diffs[0].action, 'modify');
      assert.match(result.diffs[0].preview, /old line/);
      assert.match(result.diffs[0].preview, /new line/);
    });

    it('shows diff for deleted file', () => {
      writeFileSync(join(root, 'doomed.js'), 'bye');
      scaffoldProposal(root, 'turn-032', [
        { path: 'doomed.js', action: 'delete' },
      ]);

      const result = diffProposal(root, 'turn-032');
      assert.ok(result.ok);
      assert.match(result.diffs[0].preview, /deleted/);
    });

    it('filters by --file', () => {
      scaffoldProposal(root, 'turn-033', [
        { path: 'a.js', action: 'create', content: 'a' },
        { path: 'b.js', action: 'create', content: 'b' },
      ]);

      const result = diffProposal(root, 'turn-033', 'a.js');
      assert.ok(result.ok);
      assert.strictEqual(result.diffs.length, 1);
      assert.strictEqual(result.diffs[0].path, 'a.js');
    });

    it('errors on --file not in proposal', () => {
      scaffoldProposal(root, 'turn-034', [
        { path: 'real.js', action: 'create', content: 'real' },
      ]);

      const result = diffProposal(root, 'turn-034', 'missing.js');
      assert.ok(!result.ok);
      assert.match(result.error, /not part of proposal/);
    });
  });

  // --- malformed proposals ---

  describe('error handling', () => {
    it('errors on missing PROPOSAL.md', () => {
      const proposalDir = join(root, '.agentxchain/proposed/turn-bad');
      mkdirSync(proposalDir, { recursive: true });
      writeFileSync(join(proposalDir, 'some-file.js'), 'orphan');

      const result = applyProposal(root, 'turn-bad');
      assert.ok(!result.ok);
      assert.match(result.error, /malformed/);
    });
  });
});
