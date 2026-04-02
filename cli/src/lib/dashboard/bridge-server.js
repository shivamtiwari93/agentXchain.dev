/**
 * Dashboard bridge server — read-only HTTP + WebSocket server.
 *
 * Serves dashboard static assets, exposes read-only API endpoints for
 * .agentxchain/ state files, and pushes WebSocket invalidation events
 * when watched files change.
 *
 * Security: binds to 127.0.0.1 only. No write RPC. No mutation endpoints.
 * See: DEC-DASH-002, DEC-DASH-003, AT-DASH-007, AT-DASH-008.
 */

import { createServer } from 'http';
import { createHash } from 'crypto';
import { readFileSync, existsSync } from 'fs';
import { join, extname, resolve, sep } from 'path';
import { readResource } from './state-reader.js';
import { FileWatcher } from './file-watcher.js';

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
  const wsClients = new Set();
  const watcher = new FileWatcher(agentxchainDir);

  // Broadcast invalidation events to all connected WebSocket clients
  watcher.on('invalidate', ({ resource }) => {
    const msg = JSON.stringify({ type: 'invalidate', resource });
    for (const socket of wsClients) {
      sendWsFrame(socket, msg);
    }
  });

  const server = createServer((req, res) => {
    // Block all mutation methods (AT-DASH-008)
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405, { 'Content-Type': 'application/json', 'Allow': 'GET, HEAD' });
      res.end(JSON.stringify({ error: 'Method not allowed. Dashboard is read-only in v2.0.' }));
      return;
    }

    const url = new URL(req.url, `http://${req.headers.host}`);
    const pathname = url.pathname;

    // API routes
    if (pathname.startsWith('/api/')) {
      const result = readResource(agentxchainDir, pathname);
      if (!result) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Resource not found' }));
        return;
      }
      res.writeHead(200, {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-cache',
      });
      res.end(JSON.stringify(result.data));
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
          'Dashboard is read-only in v2.0. WebSocket commands and mutations are not supported.'
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
