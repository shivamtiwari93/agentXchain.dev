/**
 * Hosted Runner — HTTP server implementing control plane API routes.
 *
 * Composes protocol-bridge.js for all protocol operations, job-queue.js for
 * execution scheduling, and execution-worker.js for governed turn dispatch.
 * Uses node:http with zero external dependencies.
 *
 * Follows the same structural pattern as dashboard/bridge-server.js but
 * integrates with the protocol bridge instead of state file reads.
 *
 * @module hosted-runner
 */

import { createServer } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createProjectRegistry } from './project-registry.js';
import { createOrgAggregator } from './org-state-aggregator.js';

import {
  createRun, getRunState, listRuns, cancelRun,
  getTurns, getTurn, acceptTurnResult, rejectTurnResult,
  approveTransition, checkpointTurn, retryTurn,
  getEvents, getDecisions, getGates, exportRun,
  ProtocolError, NotFoundError, ValidationError,
  AuthorizationError, ConflictError,
} from './protocol-bridge.js';

import { createJobQueue } from './job-queue.js';
import { createExecutionWorker } from './execution-worker.js';

const MAX_BODY_SIZE = 1_048_576; // 1MB

// Package version for health endpoint
let _pkgVersion = null;
function getPackageVersion() {
  if (_pkgVersion) return _pkgVersion;
  try {
    const __dirname = dirname(fileURLToPath(import.meta.url));
    const pkg = JSON.parse(readFileSync(join(__dirname, '..', '..', '..', 'package.json'), 'utf8'));
    _pkgVersion = pkg.version;
  } catch {
    _pkgVersion = 'unknown';
  }
  return _pkgVersion;
}

// ── Route Matching ────────────────────────────────────────────────────────────

/**
 * Match a URL path against a pattern with :param placeholders.
 * Returns null if no match, or an object of extracted params.
 */
function matchRoute(pattern, pathname) {
  const patternParts = pattern.split('/');
  const pathParts = pathname.split('/');
  if (patternParts.length !== pathParts.length) return null;

  const params = {};
  for (let i = 0; i < patternParts.length; i++) {
    if (patternParts[i].startsWith(':')) {
      params[patternParts[i].slice(1)] = decodeURIComponent(pathParts[i]);
    } else if (patternParts[i] !== pathParts[i]) {
      return null;
    }
  }
  return params;
}

// ── Route Table ───────────────────────────────────────────────────────────────

function buildRoutes(root, config, queue, registry, aggregator) {
  return [
    {
      method: 'GET',
      pattern: '/health',
      handler: () => ({ status: 200, body: { status: 'ok', version: getPackageVersion() } }),
    },
    {
      method: 'POST',
      pattern: '/v1/projects/:proj_id/runs',
      handler: (params, body) => {
        const state = createRun(root, config, body || {});
        // Enqueue first turn for execution worker
        if (state && state.run_id) {
          const role = state.active_turns
            ? Object.values(state.active_turns)[0]?.assigned_role
            : null;
          if (role) {
            queue.enqueue({
              run_id: state.run_id,
              project_id: params.proj_id,
              role,
              runtime_class: 'api_proxy',
            });
          }
        }
        return { status: 201, body: { data: state } };
      },
    },
    {
      method: 'GET',
      pattern: '/v1/projects/:proj_id/runs',
      handler: (params, body, query) => {
        const result = listRuns(root, query.cursor || null, parseInt(query.limit || '25', 10));
        return { status: 200, body: result };
      },
    },
    {
      method: 'GET',
      pattern: '/v1/runs/:run_id',
      handler: (params) => {
        const state = getRunState(root, config);
        return { status: 200, body: { data: state } };
      },
    },
    {
      method: 'POST',
      pattern: '/v1/runs/:run_id/cancel',
      handler: (params, body) => {
        const reason = body?.reason || 'cancelled via API';
        const result = cancelRun(root, reason);
        return { status: 200, body: { data: result } };
      },
    },
    {
      method: 'GET',
      pattern: '/v1/runs/:run_id/turns',
      handler: (params, body, query) => {
        const result = getTurns(root, query.cursor || null, parseInt(query.limit || '25', 10));
        return { status: 200, body: result };
      },
    },
    {
      method: 'GET',
      pattern: '/v1/runs/:run_id/turns/:turn_id',
      handler: (params) => {
        const result = getTurn(root, params.turn_id);
        return { status: 200, body: { data: result } };
      },
    },
    {
      method: 'POST',
      pattern: '/v1/runs/:run_id/turns/:turn_id/accept',
      handler: (params, body) => {
        const result = acceptTurnResult(root, config, params.turn_id, body || {});
        return { status: 200, body: { data: result } };
      },
    },
    {
      method: 'POST',
      pattern: '/v1/runs/:run_id/turns/:turn_id/reject',
      handler: (params, body) => {
        const reason = body?.reason || 'rejected via API';
        const result = rejectTurnResult(root, config, params.turn_id, reason, body || {});
        return { status: 200, body: { data: result } };
      },
    },
    {
      method: 'POST',
      pattern: '/v1/runs/:run_id/approve-transition',
      handler: (params, body) => {
        const result = approveTransition(root, config, body || {});
        return { status: 200, body: { data: result } };
      },
    },
    {
      method: 'POST',
      pattern: '/v1/runs/:run_id/checkpoint',
      handler: (params, body) => {
        const turnId = body?.turn_id || params.turn_id;
        const result = checkpointTurn(root, turnId);
        return { status: 200, body: { data: result } };
      },
    },
    {
      method: 'POST',
      pattern: '/v1/runs/:run_id/retry',
      handler: (params, body) => {
        const turnId = body?.turn_id;
        const result = retryTurn(root, config, turnId);
        return { status: 200, body: { data: result } };
      },
    },
    {
      method: 'GET',
      pattern: '/v1/runs/:run_id/events',
      handler: (params, body, query) => {
        const result = getEvents(root, query.cursor || null, parseInt(query.limit || '25', 10));
        return { status: 200, body: result };
      },
    },
    {
      method: 'GET',
      pattern: '/v1/runs/:run_id/decisions',
      handler: () => {
        const result = getDecisions(root);
        return { status: 200, body: result };
      },
    },
    {
      method: 'GET',
      pattern: '/v1/runs/:run_id/gates',
      handler: () => {
        const result = getGates(root, config);
        return { status: 200, body: result };
      },
    },
    {
      method: 'GET',
      pattern: '/v1/runs/:run_id/export',
      handler: () => {
        const result = exportRun(root);
        return { status: 200, body: { data: result } };
      },
    },
    // ── Org Routes ──────────────────────────────────────────────────────────
    {
      method: 'POST',
      pattern: '/v1/org/projects',
      handler: (_params, body) => {
        if (!body?.root) {
          return { status: 422, body: { error: { code: 'validation_error', message: 'root is required' } } };
        }
        try {
          const entry = registry.register(body.root, body.name);
          return { status: 201, body: { data: entry } };
        } catch (err) {
          return { status: 422, body: { error: { code: 'validation_error', message: err.message } } };
        }
      },
    },
    {
      method: 'GET',
      pattern: '/v1/org/projects',
      handler: () => {
        return { status: 200, body: { data: registry.list() } };
      },
    },
    {
      method: 'DELETE',
      pattern: '/v1/org/projects/:proj_id',
      handler: (params) => {
        registry.unregister(params.proj_id);
        return { status: 200, body: { ok: true } };
      },
    },
    {
      method: 'GET',
      pattern: '/v1/org/overview',
      handler: () => {
        return { status: 200, body: { data: aggregator.getOverview() } };
      },
    },
    {
      method: 'GET',
      pattern: '/v1/org/runs',
      handler: (_params, _body, query) => {
        return { status: 200, body: aggregator.getRuns(query) };
      },
    },
    {
      method: 'GET',
      pattern: '/v1/org/decisions',
      handler: (_params, _body, query) => {
        return { status: 200, body: aggregator.getDecisions(query) };
      },
    },
  ];
}

// ── Static File Serving ──────────────────────────────────────────────────────

const MIME_TYPES = {
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
};

function getDashboardDir() {
  const __dirname = dirname(fileURLToPath(import.meta.url));
  return join(__dirname, '..', '..', '..', 'dashboard');
}

function serveDashboardFile(pathname, res) {
  const dashDir = getDashboardDir();
  const filePath = pathname === '/' ? join(dashDir, 'index.html') : join(dashDir, pathname.slice(1));

  // Prevent directory traversal
  if (!filePath.startsWith(dashDir)) return false;
  if (!existsSync(filePath)) return false;

  try {
    const content = readFileSync(filePath);
    const ext = extname(filePath);
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': contentType });
    res.end(content);
    return true;
  } catch {
    return false;
  }
}

// ── Error → HTTP Status Mapping ───────────────────────────────────────────────

function mapErrorToResponse(err) {
  if (err instanceof NotFoundError) {
    return { status: 404, body: { error: { code: err.code, message: err.message } } };
  }
  if (err instanceof ValidationError) {
    return { status: 422, body: { error: { code: err.code, message: err.message } } };
  }
  if (err instanceof ProtocolError) {
    return { status: 409, body: { error: { code: err.code, message: err.message } } };
  }
  if (err instanceof ConflictError) {
    return { status: 409, body: { error: { code: err.code, message: err.message } } };
  }
  if (err instanceof AuthorizationError) {
    return { status: 403, body: { error: { code: err.code, message: err.message } } };
  }
  return { status: 500, body: { error: { code: 'internal_error', message: 'Internal server error' } } };
}

// ── Request Body Parser ───────────────────────────────────────────────────────

function parseBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_SIZE) {
        reject(new Error('Request body too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (size === 0) {
        resolve(null);
        return;
      }
      try {
        const raw = Buffer.concat(chunks).toString('utf8');
        resolve(JSON.parse(raw));
      } catch (err) {
        reject(new Error(`Invalid JSON: ${err.message}`));
      }
    });
    req.on('error', reject);
  });
}

// ── Query String Parser ───────────────────────────────────────────────────────

function parseQuery(url) {
  const idx = url.indexOf('?');
  if (idx === -1) return {};
  const qs = url.slice(idx + 1);
  const params = {};
  for (const pair of qs.split('&')) {
    const [key, val] = pair.split('=');
    if (key) params[decodeURIComponent(key)] = val ? decodeURIComponent(val) : '';
  }
  return params;
}

// ── Server Factory ────────────────────────────────────────────────────────────

/**
 * Create a hosted runner instance.
 * @param {object} options
 * @param {string} options.root - project root directory
 * @param {object} options.config - normalized config
 * @param {number} [options.port=4100] - server port
 * @param {string} [options.host='127.0.0.1'] - bind address
 * @param {string[]} [options.projects=[]] - additional project root paths
 * @returns {{ server: http.Server, start(): Promise<void>, stop(): Promise<void>, worker: object, queue: object, registry: object }}
 */
export function createHostedRunner(options) {
  const {
    root,
    config,
    port = 4100,
    host = '127.0.0.1',
    projects = [],
  } = options;

  const queue = createJobQueue();
  const worker = createExecutionWorker({ root, config, queue });

  const registry = createProjectRegistry(root);
  for (const projRoot of projects) {
    try { registry.register(projRoot); } catch { /* skip invalid */ }
  }
  const aggregator = createOrgAggregator(registry);
  const routes = buildRoutes(root, config, queue, registry, aggregator);

  const server = createServer(async (req, res) => {
    const pathname = req.url.split('?')[0];
    const method = req.method.toUpperCase();
    const query = parseQuery(req.url);

    // Find matching route
    let matched = null;
    let params = null;
    for (const route of routes) {
      if (route.method !== method) continue;
      const m = matchRoute(route.pattern, pathname);
      if (m) {
        matched = route;
        params = m;
        break;
      }
    }

    if (!matched) {
      // Static file serving for dashboard
      if (method === 'GET' && !pathname.startsWith('/v1/') && pathname !== '/health') {
        if (serveDashboardFile(pathname, res)) return;
      }
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { code: 'not_found', message: `No route for ${method} ${pathname}` } }));
      return;
    }

    try {
      let body = null;
      if (method === 'POST' || method === 'PUT' || method === 'PATCH') {
        body = await parseBody(req);
      }

      const result = await matched.handler(params, body, query);
      res.writeHead(result.status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(result.body));
    } catch (err) {
      if (err.message === 'Request body too large') {
        res.writeHead(413, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: { code: 'payload_too_large', message: 'Request body exceeds 1MB limit' } }));
        return;
      }
      if (err.message?.startsWith('Invalid JSON:')) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: { code: 'invalid_json', message: err.message } }));
        return;
      }
      const mapped = mapErrorToResponse(err);
      res.writeHead(mapped.status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(mapped.body));
    }
  });

  async function start() {
    return new Promise((resolve) => {
      server.listen(port, host, () => {
        worker.start();
        resolve();
      });
    });
  }

  async function stop() {
    worker.stop();
    return new Promise((resolve) => {
      const timeout = setTimeout(() => resolve(), 5000);
      server.close(() => {
        clearTimeout(timeout);
        resolve();
      });
    });
  }

  return { server, start, stop, worker, queue, registry };
}
