/**
 * Simple test runner: starts server, hits /api/health and basic mood APIs, then exits.
 * Run from repo root: npm test
 */
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const PORT = 3099;
const base = `http://127.0.0.1:${PORT}`;

let server;

function wait(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function fetchRetry(url, opts = {}, maxAttempts = 10) {
  for (let i = 0; i < maxAttempts; i++) {
    try {
      const res = await fetch(url, opts);
      return res;
    } catch (e) {
      if (i === maxAttempts - 1) throw e;
      await wait(300);
    }
  }
}

async function run() {
  server = spawn('node', ['server/index.js'], {
    cwd: root,
    env: { ...process.env, PORT: String(PORT), DB_PATH: ':memory:' },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  server.stdout?.on('data', () => {});
  server.stderr?.on('data', () => {});

  await wait(500);

  try {
    const health = await fetchRetry(`${base}/api/health`);
    if (!health.ok) {
      console.error('GET /api/health failed:', health.status);
      process.exit(1);
    }
    const healthData = await health.json();
    if (healthData.status !== 'ok' || healthData.db !== 'connected') {
      console.error('Health check payload invalid:', healthData);
      process.exit(1);
    }

    const moodList = await fetch(`${base}/api/mood`, { credentials: 'include' });
    if (!moodList.ok) {
      console.error('GET /api/mood failed:', moodList.status);
      process.exit(1);
    }
    const listData = await moodList.json();
    if (!Array.isArray(listData.entries)) {
      console.error('GET /api/mood invalid shape:', listData);
      process.exit(1);
    }

    const insight = await fetch(`${base}/api/insight`, { credentials: 'include' });
    if (!insight.ok) {
      console.error('GET /api/insight failed:', insight.status);
      process.exit(1);
    }
    const insightData = await insight.json();
    if (insightData.insight != null && typeof insightData.insight !== 'object') {
      console.error('GET /api/insight invalid shape (insight must be object or null):', insightData);
      process.exit(1);
    }

    const cookie = moodList.headers.get('set-cookie');
    const postRes = await fetch(`${base}/api/mood`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie.split(';')[0] } : {}) },
      body: JSON.stringify({ mood: 'good', note: 'test' }),
      credentials: 'include'
    });
    if (postRes.status !== 201) {
      const err = await postRes.text();
      console.error('POST /api/mood failed:', postRes.status, err);
      process.exit(1);
    }
    const created = await postRes.json();
    if (!created.id || !created.mood || created.mood !== 'good') {
      console.error('POST /api/mood invalid response:', created);
      process.exit(1);
    }

    const postWithTags = await fetch(`${base}/api/mood`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie.split(';')[0] } : {}) },
      body: JSON.stringify({ mood: 'okay', note: 'tag-test', tags: ['work', 'test'] }),
      credentials: 'include'
    });
    if (postWithTags.status !== 201) {
      console.error('POST /api/mood with tags failed:', postWithTags.status, await postWithTags.text());
      process.exit(1);
    }
    const createdWithTags = await postWithTags.json();
    if (!Array.isArray(createdWithTags.tags) || !createdWithTags.tags.includes('work')) {
      console.error('POST /api/mood tags not returned:', createdWithTags);
      process.exit(1);
    }

    const invalidMoodRes = await fetch(`${base}/api/mood`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie.split(';')[0] } : {}) },
      body: JSON.stringify({ mood: 'excellent', note: 'invalid-mood-test' }),
      credentials: 'include'
    });
    if (invalidMoodRes.status !== 400) {
      console.error('POST /api/mood with invalid mood should return 400, got:', invalidMoodRes.status, await invalidMoodRes.text());
      process.exit(1);
    }
    const invalidMoodData = await invalidMoodRes.json();
    if (!invalidMoodData.error || !invalidMoodData.error.includes('mood required')) {
      console.error('POST /api/mood invalid mood error payload unexpected:', invalidMoodData);
      process.exit(1);
    }

    const insightAfter = await fetch(`${base}/api/insight`, {
      headers: cookie ? { Cookie: cookie.split(';')[0] } : {},
      credentials: 'include'
    });
    const insightAfterData = await insightAfter.json();
    if (insightAfterData.insight && typeof insightAfterData.insight === 'object') {
      const i = insightAfterData.insight;
      const hasExpected = 'most_common_mood' in i || 'week_over_week' in i || 'entries_this_week' in i || 'total_entries' in i;
      if (!hasExpected) {
        console.error('GET /api/insight contract: when entries exist, insight must have at least one of most_common_mood, week_over_week, entries_this_week, total_entries:', i);
        process.exit(1);
      }
    }

    const filteredByTag = await fetch(`${base}/api/mood?tag=work`, {
      headers: cookie ? { Cookie: cookie.split(';')[0] } : {},
      credentials: 'include'
    });
    if (!filteredByTag.ok) {
      console.error('GET /api/mood?tag=work failed:', filteredByTag.status);
      process.exit(1);
    }
    const filteredData = await filteredByTag.json();
    if (!Array.isArray(filteredData.entries)) {
      console.error('GET /api/mood?tag=work invalid shape:', filteredData);
      process.exit(1);
    }
    const withWorkTag = filteredData.entries.filter(e => e.tags && e.tags.includes('work'));
    if (withWorkTag.length === 0) {
      console.error('GET /api/mood?tag=work should return entries tagged "work"; got:', filteredData.entries);
      process.exit(1);
    }

    const now = Date.now();
    const from = now - 60 * 60 * 1000;
    const to = now + 60 * 1000;
    const dateRangeRes = await fetch(`${base}/api/mood?from=${from}&to=${to}`, {
      headers: cookie ? { Cookie: cookie.split(';')[0] } : {},
      credentials: 'include'
    });
    if (!dateRangeRes.ok) {
      console.error('GET /api/mood?from=&to= failed:', dateRangeRes.status);
      process.exit(1);
    }
    const dateRangeData = await dateRangeRes.json();
    if (!Array.isArray(dateRangeData.entries)) {
      console.error('GET /api/mood?from=&to= invalid shape:', dateRangeData);
      process.exit(1);
    }
    const outOfRange = dateRangeData.entries.filter(e => e.created_at < from || e.created_at > to);
    if (outOfRange.length > 0) {
      console.error('GET /api/mood?from=&to= returned entries outside range:', outOfRange);
      process.exit(1);
    }

    console.log('All checks passed.');
  } finally {
    server.kill('SIGTERM');
  }
}

run().catch((err) => {
  console.error(err);
  if (server) server.kill('SIGTERM');
  process.exit(1);
});
