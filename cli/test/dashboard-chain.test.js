import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomBytes } from 'node:crypto';

import { readChainReportSnapshot } from '../src/lib/dashboard/chain-report-reader.js';
import { WATCH_DIRECTORIES, resourceForRelativePath } from '../src/lib/dashboard/state-reader.js';

function tempDir() {
  const dir = join(tmpdir(), `axc-chain-dash-${randomBytes(6).toString('hex')}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function writeJson(filePath, value) {
  writeFileSync(filePath, JSON.stringify(value, null, 2) + '\n');
}

describe('Dashboard chain report reader', () => {
  it('returns latest chain plus newest-first report ordering and honors limit', () => {
    const root = tempDir();
    try {
      const reportsDir = join(root, '.agentxchain', 'reports');
      mkdirSync(reportsDir, { recursive: true });

      writeJson(join(reportsDir, 'chain-a.json'), {
        chain_id: 'chain_a',
        started_at: '2026-04-15T12:00:00.000Z',
        total_turns: 2,
        runs: [],
      });
      writeJson(join(reportsDir, 'chain-b.json'), {
        chain_id: 'chain_b',
        started_at: '2026-04-16T12:00:00.000Z',
        total_turns: 4,
        runs: [{ run_id: 'run_b_001' }],
      });

      const result = readChainReportSnapshot(root, { limit: 1 });
      assert.equal(result.ok, true);
      assert.equal(result.status, 200);
      assert.equal(result.body.latest.chain_id, 'chain_b');
      assert.equal(result.body.reports.length, 1);
      assert.equal(result.body.reports[0].chain_id, 'chain_b');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('skips malformed advisory files instead of failing the surface', () => {
    const root = tempDir();
    try {
      const reportsDir = join(root, '.agentxchain', 'reports');
      mkdirSync(reportsDir, { recursive: true });

      writeJson(join(reportsDir, 'chain-good.json'), {
        chain_id: 'chain_good',
        started_at: '2026-04-16T12:00:00.000Z',
        total_turns: 1,
        runs: [],
      });
      writeFileSync(join(reportsDir, 'chain-bad.json'), '{not-json\n');

      const result = readChainReportSnapshot(root);
      assert.equal(result.body.latest.chain_id, 'chain_good');
      assert.equal(result.body.reports.length, 1);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('Dashboard chain invalidation mapping', () => {
  it('AT-DASH-CHAIN-004: maps reports/chain-*.json to /api/chain-reports and watches reports/', () => {
    assert.equal(resourceForRelativePath('reports/chain-demo.json'), '/api/chain-reports');
    assert.equal(resourceForRelativePath('reports/not-chain.txt'), null);
    assert.ok(WATCH_DIRECTORIES.includes('reports'));
  });
});
