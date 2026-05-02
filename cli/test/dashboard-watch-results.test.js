import { strict as assert } from 'node:assert';
import { describe, it, afterEach } from 'vitest';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomBytes } from 'node:crypto';
import http from 'node:http';

import { createBridgeServer } from '../src/lib/dashboard/bridge-server.js';
import { readWatchResultsSnapshot } from '../src/lib/dashboard/watch-results-reader.js';
import { resourcesForRelativePath } from '../src/lib/dashboard/state-reader.js';
import { render as renderWatch } from '../dashboard/components/watch.js';

const tempDirs = new Set();

function tmpProject() {
  const root = join(tmpdir(), `axc-dash-watch-${randomBytes(6).toString('hex')}`);
  mkdirSync(join(root, '.agentxchain'), { recursive: true });
  mkdirSync(join(root, 'dashboard'), { recursive: true });
  writeFileSync(join(root, 'dashboard', 'index.html'), '<html><body>Dashboard</body></html>');
  tempDirs.add(root);
  return root;
}

function writeResult(root, record) {
  const dir = join(root, '.agentxchain', 'watch-results');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${record.result_id}.json`), JSON.stringify(record, null, 2));
}

function makeResult(overrides = {}) {
  return {
    result_id: `wr_${randomBytes(4).toString('hex')}`,
    timestamp: '2026-04-25T10:00:00.000Z',
    event_id: 'evt_watch_dashboard',
    intent_id: 'intent_watch_dashboard',
    intent_status: 'approved',
    deduplicated: false,
    delivery_id: 'delivery-dashboard-001',
    payload: {
      source: 'git_ref_change',
      category: 'github_pull_request_opened',
      repo: 'acme/widgets',
      ref: 'feature/watch',
    },
    route: {
      matched: true,
      triaged: true,
      approved: true,
      planned: true,
      started: true,
      auto_start: true,
      preferred_role: 'dev',
      run_id: 'run_watch_dashboard',
      role: 'dev',
    },
    errors: [],
    ...overrides,
  };
}

function httpGet(port, path) {
  return new Promise((resolve, reject) => {
    const req = http.get(`http://127.0.0.1:${port}${path}`, (res) => {
      let body = '';
      res.on('data', chunk => { body += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, body }));
    });
    req.on('error', reject);
    req.setTimeout(5000, () => {
      req.destroy();
      reject(new Error('timeout'));
    });
  });
}

afterEach(() => {
  for (const dir of tempDirs) {
    try { rmSync(dir, { recursive: true, force: true }); } catch {}
  }
  tempDirs.clear();
});

describe('dashboard watch results reader', () => {
  it('AT-DASH-WATCH-001: returns empty summary when no watch results exist', () => {
    const root = tmpProject();
    const snapshot = readWatchResultsSnapshot(root);

    assert.equal(snapshot.ok, true);
    assert.equal(snapshot.total, 0);
    assert.equal(snapshot.corrupt, 0);
    assert.deepEqual(snapshot.recent, []);
    assert.equal(snapshot.summary.last_timestamp, null);
  });

  it('AT-DASH-WATCH-002: sorts results newest first and summarizes status counts', () => {
    const root = tmpProject();
    writeResult(root, makeResult({
      result_id: 'wr_started',
      timestamp: '2026-04-25T10:00:00.000Z',
    }));
    writeResult(root, makeResult({
      result_id: 'wr_error',
      timestamp: '2026-04-25T11:00:00.000Z',
      errors: ['plan failed'],
    }));
    writeResult(root, makeResult({
      result_id: 'wr_dedup',
      timestamp: '2026-04-25T12:00:00.000Z',
      deduplicated: true,
      route: { matched: false },
    }));

    const snapshot = readWatchResultsSnapshot(root);

    assert.equal(snapshot.total, 3);
    assert.equal(snapshot.recent[0].result_id, 'wr_dedup');
    assert.equal(snapshot.summary.by_status.started, 1);
    assert.equal(snapshot.summary.by_status.error, 1);
    assert.equal(snapshot.summary.by_status.deduplicated, 1);
    assert.equal(snapshot.summary.errored, 1);
    assert.equal(snapshot.summary.deduplicated, 1);
    assert.equal(snapshot.summary.routed, 2);
    assert.equal(snapshot.summary.unrouted, 1);
    assert.equal(snapshot.summary.last_timestamp, '2026-04-25T12:00:00.000Z');
  });

  it('AT-DASH-WATCH-003: skips malformed result files and counts them as corrupt', () => {
    const root = tmpProject();
    writeResult(root, makeResult({ result_id: 'wr_valid' }));
    writeFileSync(join(root, '.agentxchain', 'watch-results', 'bad.json'), '{bad json');
    writeFileSync(join(root, '.agentxchain', 'watch-results', 'array.json'), '[]');

    const snapshot = readWatchResultsSnapshot(root);

    assert.equal(snapshot.total, 1);
    assert.equal(snapshot.corrupt, 2);
    assert.equal(snapshot.summary.corrupt, 2);
  });

  it('AT-DASH-WATCH-004: limit caps recent records and limit=0 returns all readable records', () => {
    const root = tmpProject();
    for (let i = 0; i < 4; i += 1) {
      writeResult(root, makeResult({
        result_id: `wr_${i}`,
        timestamp: `2026-04-25T10:0${i}:00.000Z`,
      }));
    }

    assert.equal(readWatchResultsSnapshot(root, { limit: 2 }).recent.length, 2);
    assert.equal(readWatchResultsSnapshot(root, { limit: 0 }).recent.length, 4);
  });
});

describe('dashboard watch API and component', () => {
  it('AT-DASH-WATCH-002: /api/watch-results exposes the snapshot through the bridge', async () => {
    const root = tmpProject();
    writeResult(root, makeResult({ result_id: 'wr_api' }));
    const server = createBridgeServer({
      agentxchainDir: join(root, '.agentxchain'),
      dashboardDir: join(root, 'dashboard'),
      port: 0,
    });

    const { port } = await server.start();
    try {
      const res = await httpGet(port, '/api/watch-results?limit=1');
      assert.equal(res.status, 200);
      const body = JSON.parse(res.body);
      assert.equal(body.ok, true);
      assert.equal(body.total, 1);
      assert.equal(body.recent[0].result_id, 'wr_api');
    } finally {
      await server.stop();
    }
  });

  it('AT-DASH-WATCH-005: Watch view renders summary, delivery ID, route, and errors', () => {
    const watchResults = {
      ok: true,
      total: 1,
      corrupt: 0,
      summary: {
        by_status: { error: 1 },
        routed: 1,
        unrouted: 0,
        deduplicated: 0,
        errored: 1,
        corrupt: 0,
        last_timestamp: '2026-04-25T10:00:00.000Z',
      },
      recent: [makeResult({ errors: ['auto-start failed'] })],
    };

    const html = renderWatch({ watchResults });
    assert.match(html, /1 results/);
    assert.match(html, /delivery-dashboard-001/);
    assert.match(html, /run_watch_dashboard/);
    assert.match(html, /auto-start failed/);
  });

  it('AT-DASH-WATCH-006: watch result file paths invalidate /api/watch-results', () => {
    assert.deepEqual(
      resourcesForRelativePath('watch-results/wr_123.json'),
      ['/api/watch-results']
    );
    assert.deepEqual(
      resourcesForRelativePath('watch-results'),
      ['/api/watch-results']
    );
  });
});
