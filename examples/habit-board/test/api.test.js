'use strict';

const { describe, it, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const store = require('../src/store');
const { server } = require('../src/server');

let baseUrl;
let listener;

async function startServer() {
  return new Promise(resolve => {
    listener = server.listen(0, '127.0.0.1', () => {
      const addr = listener.address();
      baseUrl = `http://127.0.0.1:${addr.port}`;
      resolve();
    });
  });
}

function stopServer() {
  return new Promise(resolve => {
    if (listener) listener.close(resolve);
    else resolve();
  });
}

function req(method, path, body) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, baseUrl);
    const opts = { method, hostname: url.hostname, port: url.port, path: url.pathname };
    const headers = {};
    let payload;
    if (body) {
      payload = JSON.stringify(body);
      headers['Content-Type'] = 'application/json';
      headers['Content-Length'] = Buffer.byteLength(payload);
    }
    opts.headers = headers;
    const r = http.request(opts, res => {
      let data = '';
      res.on('data', c => { data += c; });
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch { resolve({ status: res.statusCode, body: data }); }
      });
    });
    r.on('error', reject);
    if (payload) r.write(payload);
    r.end();
  });
}

describe('API', () => {
  beforeEach(async () => {
    store.clear();
    if (!listener || !listener.listening) await startServer();
  });

  after(async () => {
    store.clear();
    await stopServer();
  });

  it('serves the frontend at /', async () => {
    const res = await req('GET', '/');
    assert.equal(res.status, 200);
    assert.ok(typeof res.body === 'string' ? res.body.includes('Habit Board') : false);
  });

  it('creates a habit', async () => {
    const res = await req('POST', '/api/habits', { name: 'Exercise' });
    assert.equal(res.status, 201);
    assert.equal(res.body.name, 'Exercise');
    assert.ok(res.body.id);
  });

  it('lists habits', async () => {
    await req('POST', '/api/habits', { name: 'Read' });
    const res = await req('GET', '/api/habits');
    assert.equal(res.status, 200);
    assert.equal(res.body.length, 1);
    assert.ok(res.body[0].streak);
  });

  it('deletes a habit', async () => {
    const created = await req('POST', '/api/habits', { name: 'Delete me' });
    const res = await req('DELETE', `/api/habits/${created.body.id}`);
    assert.equal(res.status, 200);
    assert.equal(res.body.deleted, true);
  });

  it('returns 404 for unknown habit delete', async () => {
    const res = await req('DELETE', '/api/habits/nonexistent');
    assert.equal(res.status, 404);
  });

  it('checks today', async () => {
    const created = await req('POST', '/api/habits', { name: 'Check me' });
    const res = await req('POST', `/api/habits/${created.body.id}/check`);
    assert.equal(res.status, 200);
    assert.ok(res.body.completions.length > 0);
  });

  it('unchecks today', async () => {
    const created = await req('POST', '/api/habits', { name: 'Uncheck me' });
    await req('POST', `/api/habits/${created.body.id}/check`);
    const res = await req('DELETE', `/api/habits/${created.body.id}/check`);
    assert.equal(res.status, 200);
  });

  it('returns 404 for check on unknown habit', async () => {
    const res = await req('POST', '/api/habits/nonexistent/check');
    assert.equal(res.status, 404);
  });

  it('returns history', async () => {
    const created = await req('POST', '/api/habits', { name: 'History' });
    const res = await req('GET', `/api/habits/${created.body.id}/history`);
    assert.equal(res.status, 200);
    assert.equal(res.body.length, 30);
  });

  it('rejects empty name', async () => {
    const res = await req('POST', '/api/habits', { name: '' });
    assert.equal(res.status, 400);
    assert.ok(res.body.error);
  });

  it('rejects name over 100 chars', async () => {
    const res = await req('POST', '/api/habits', { name: 'x'.repeat(101) });
    assert.equal(res.status, 400);
    assert.ok(res.body.error);
  });

  it('returns 404 for unknown API route', async () => {
    const res = await req('GET', '/api/nonexistent');
    assert.equal(res.status, 404);
  });
});
