/**
 * Dashboard bridge server — local HTTP + WebSocket server.
 *
 * Serves dashboard static assets, exposes state API endpoints for
 * .agentxchain/ files, supports a narrow local gate-approval mutation,
 * and pushes WebSocket invalidation events when watched files change.
 *
 * Security: binds to 127.0.0.1 only. WebSocket remains read-only.
 * HTTP mutation is limited to authenticated approve-gate requests.
 * See: DEC-DASH-002, DEC-DASH-003, AT-DASH-007, AT-DASH-008.
 */

import { createServer } from 'http';
import { createHash, randomBytes, timingSafeEqual } from 'crypto';
import { readFileSync, existsSync } from 'fs';
import { join, extname, resolve, sep } from 'path';
import { readResource } from './state-reader.js';
import { FileWatcher } from './file-watcher.js';
import { approvePendingDashboardGate } from './actions.js';
import { readCoordinatorBlockerSnapshot } from './coordinator-blockers.js';
import { readWorkflowKitArtifacts } from './workflow-kit-artifacts.js';
import { readConnectorHealthSnapshot } from './connectors.js';

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
};

// ── Minimal WebSocket server (RFC 6455, text frames only) ───────────────────

const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

function acceptWebSocket(req, socket) {
  const key = req.headers['sec-websocket-key'];
  if (!key || req.headers.upgrade?.toLowerCase() !== 'websocket' || req.headers['sec-websocket-version'] !== '13') {
    socket.write('HTTP/1.1 400 Bad Request\r\n\r\n');
    socket.destroy();
    return null;
  }

  const accept = createHash('sha1')
    .update(key + WS_GUID)
    .digest('base64');

  socket.write(
    'HTTP/1.1 101 Switching Protocols\r\n' +
    'Upgrade: websocket\r\n' +
    'Connection: Upgrade\r\n' +
    `Sec-WebSocket-Accept: ${accept}\r\n` +
    '\r\n'
  );
  return socket;
}

function createWsFrame(opcode, payload = Buffer.alloc(0)) {
  const len = payload.length;
  let header;
  if (len < 126) {
    header = Buffer.alloc(2);
    header[0] = 0x80 | opcode;
    header[1] = len;
  } else if (len < 65536) {
    header = Buffer.alloc(4);
    header[0] = 0x80 | opcode;
    header[1] = 126;
    header.writeUInt16BE(len, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x80 | opcode;
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(len), 2);
  }
  return Buffer.concat([header, payload]);
}

function sendWsFrame(socket, text) {
  const payload = Buffer.from(text, 'utf8');
  try {
    socket.write(createWsFrame(0x01, payload));
  } catch {
    // Socket already closed
  }
}

function sendWsControlFrame(socket, opcode, payload = Buffer.alloc(0)) {
  try {
    socket.write(createWsFrame(opcode, payload));
  } catch {
    // Socket already closed
  }
}

function parseClientFrame(data) {
  if (!Buffer.isBuffer(data) || data.length < 2) return null;

  const opcode = data[0] & 0x0f;
  const masked = (data[1] & 0x80) !== 0;
  let payloadLen = data[1] & 0x7f;
  let offset = 2;

  if (payloadLen === 126) {
    if (data.length < 4) return null;
    payloadLen = data.readUInt16BE(2);
    offset = 4;
  } else if (payloadLen === 127) {
    if (data.length < 10) return null;
    payloadLen = Number(data.readBigUInt64BE(2));
    offset = 10;
  }

  const maskOffset = offset;
  if (masked) {
    if (data.length < maskOffset + 4) return null;
    offset += 4;
  }

  if (data.length < offset + payloadLen) return null;
  const payload = Buffer.from(data.slice(offset, offset + payloadLen));

  if (masked) {
    const mask = data.slice(maskOffset, maskOffset + 4);
    for (let i = 0; i < payload.length; i += 1) {
      payload[i] ^= mask[i % 4];
    }
  }

  return { opcode, payload };
}

function sendWsError(socket, error) {
  sendWsFrame(socket, JSON.stringify({
    type: 'error',
    error,
  }));
}

function writeJson(res, statusCode, payload, extraHeaders = {}) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-cache',
    ...extraHeaders,
  });
  res.end(JSON.stringify(payload));
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
      if (body.length > 32 * 1024) {
        reject(new Error('Request body too large.'));
        try { req.destroy(); } catch {}
      }
    });
    req.on('end', () => {
      if (!body.trim()) {
        resolve({});
        return;
      }

      try {
        resolve(JSON.parse(body));
      } catch {
        reject(new Error('Request body must be valid JSON.'));
      }
    });
    req.on('error', reject);
  });
}

function tokenMatches(expectedToken, receivedToken) {
  if (typeof receivedToken !== 'string') {
    return false;
  }

  const expected = Buffer.from(expectedToken, 'utf8');
  const received = Buffer.from(receivedToken, 'utf8');
  if (expected.length !== received.length) {
    return false;
  }

  return timingSafeEqual(expected, received);
}

function resolveDashboardAssetPath(dashboardDir, pathname) {
  let decodedPath;
  try {
    decodedPath = decodeURIComponent(pathname);
  } catch {
    return { blocked: true, filePath: null };
  }

  const relativePath = decodedPath === '/' || decodedPath === '/index.html'
    ? 'index.html'
    : decodedPath.replace(/^\/+/, '');
  const dashboardRoot = resolve(dashboardDir);
  const filePath = resolve(dashboardRoot, relativePath);

  if (filePath !== dashboardRoot && !filePath.startsWith(dashboardRoot + sep)) {
    return { blocked: true, filePath: null };
  }

  return { blocked: false, filePath };
}

// ── Bridge Server ───────────────────────────────────────────────────────────

export function createBridgeServer({ agentxchainDir, dashboardDir, port = 3847 }) {
  const workspacePath = resolve(agentxchainDir, '..');
  const wsClients = new Set();
  const watcher = new FileWatcher(agentxchainDir);
  const mutationToken = randomBytes(24).toString('hex');

  // Broadcast invalidation events to all connected WebSocket clients
  watcher.on('invalidate', ({ resource }) => {
    const msg = JSON.stringify({ type: 'invalidate', resource });
    for (const socket of wsClients) {
      sendWsFrame(socket, msg);
    }
  });

  const server = createServer(async (req, res) => {
    const method = req.method || 'GET';
    const isApproveGateRequest = method === 'POST' && req.url && new URL(req.url, `http://${req.headers.host}`).pathname === '/api/actions/approve-gate';

    if (method !== 'GET' && method !== 'HEAD' && !isApproveGateRequest) {
      writeJson(
        res,
        405,
        { error: 'Method not allowed. Dashboard mutations are limited to approve-gate.' },
        { Allow: 'GET, HEAD, POST' }
      );
      return;
    }

    const url = new URL(req.url, `http://${req.headers.host}`);
    const pathname = url.pathname;

    if (pathname === '/api/session') {
      writeJson(res, 200, {
        session_version: '1',
        mutation_token: mutationToken,
        capabilities: {
          approve_gate: true,
        },
      });
      return;
    }

    if (pathname === '/api/actions/approve-gate') {
      if (method !== 'POST') {
        writeJson(res, 405, { ok: false, code: 'method_not_allowed', error: 'Use POST for dashboard actions.' }, { Allow: 'POST' });
        return;
      }

      if (!tokenMatches(mutationToken, req.headers['x-agentxchain-token'])) {
        writeJson(res, 403, { ok: false, code: 'invalid_token', error: 'Valid X-AgentXchain-Token is required.' });
        return;
      }

      try {
        await readJsonBody(req);
      } catch (error) {
        writeJson(res, 400, { ok: false, code: 'invalid_json', error: error.message });
        return;
      }

      const result = approvePendingDashboardGate(agentxchainDir);
      writeJson(res, result.status, result.body);
      return;
    }

    if (pathname === '/api/coordinator/blockers') {
      const result = readCoordinatorBlockerSnapshot(workspacePath);
      writeJson(res, result.status, result.body);
      return;
    }

    if (pathname === '/api/workflow-kit-artifacts') {
      const result = readWorkflowKitArtifacts(workspacePath);
      writeJson(res, result.status, result.body);
      return;
    }

    if (pathname === '/api/connectors') {
      const result = readConnectorHealthSnapshot(workspacePath);
      writeJson(res, result.status, result.body);
      return;
    }

    // API routes
    if (pathname.startsWith('/api/')) {
      const result = readResource(agentxchainDir, pathname);
      if (!result) {
        writeJson(res, 404, { error: 'Resource not found' });
        return;
      }
      writeJson(res, 200, result.data);
      return;
    }

    // Static asset serving
    const { blocked, filePath: resolvedPath } = resolveDashboardAssetPath(dashboardDir, pathname);
    if (blocked) {
      res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Forbidden');
      return;
    }
    let filePath = resolvedPath;

    if (!existsSync(filePath)) {
      // SPA fallback: serve index.html for unknown routes
      filePath = join(dashboardDir, 'index.html');
    }

    try {
      const content = readFileSync(filePath);
      const ext = extname(filePath);
      const contentType = MIME_TYPES[ext] || 'application/octet-stream';
      res.writeHead(200, { 'Content-Type': contentType });
      res.end(content);
    } catch {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not found');
    }
  });

  // WebSocket upgrade handler
  server.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url, `http://${req.headers.host}`);
    if (url.pathname !== '/ws') {
      socket.destroy();
      return;
    }

    const ws = acceptWebSocket(req, socket);
    if (!ws) return;

    wsClients.add(ws);

    ws.on('close', () => wsClients.delete(ws));
    ws.on('error', () => wsClients.delete(ws));

    // Handle incoming frames (for ping/pong and close detection)
    ws.on('data', (data) => {
      const frame = parseClientFrame(data);
      if (!frame) return;

      if (frame.opcode === 0x08) {
        // Close frame
        wsClients.delete(ws);
        sendWsControlFrame(ws, 0x08, frame.payload);
        try { ws.end(); } catch {}
      } else if (frame.opcode === 0x09) {
        // Ping → Pong
        sendWsControlFrame(ws, 0x0a, frame.payload);
      } else if (frame.opcode === 0x01) {
        sendWsError(
          ws,
          'Dashboard WebSocket is read-only. Use the authenticated HTTP approve-gate action instead.'
        );
      }
    });
  });

  function start() {
    return new Promise((resolve, reject) => {
      server.listen(port, '127.0.0.1', () => {
        watcher.start();
        resolve({ port: server.address().port });
      });
      server.on('error', reject);
    });
  }

  function stop() {
    return new Promise((resolve) => {
      watcher.stop();
      for (const socket of wsClients) {
        try { socket.destroy(); } catch {}
      }
      wsClients.clear();
      server.close(() => resolve());
    });
  }

  return { start, stop, server, watcher };
}
