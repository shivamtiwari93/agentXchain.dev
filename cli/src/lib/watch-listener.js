import { createServer } from 'http';
import { createHmac, timingSafeEqual } from 'crypto';
import { readFileSync } from 'fs';
import { join } from 'path';
import { recordEvent, triageIntent, approveIntent, planIntent, startIntent } from './intake.js';
import { normalizeWatchEvent, resolveWatchRoute, writeWatchResult } from './watch-events.js';

const MAX_BODY_BYTES = 1_048_576; // 1 MB

/**
 * Start an HTTP webhook listener that feeds events through the governed intake pipeline.
 *
 * @param {object} opts
 * @param {string} opts.root - project root
 * @param {number} opts.port - port to bind
 * @param {string} [opts.host='127.0.0.1'] - host to bind
 * @param {string|null} [opts.secret=null] - HMAC-SHA256 webhook secret
 * @param {boolean} [opts.allowUnsigned=false] - accept unsigned payloads
 * @param {boolean} [opts.dryRun=false] - normalize only, do not persist
 * @param {Function} [opts.onReady] - called with { port, host } when listening
 * @returns {Promise<import('http').Server>}
 */
export function startWebhookListener(opts) {
  const { root, port, host = '127.0.0.1', secret = null, allowUnsigned = false, dryRun = false, onReady } = opts;
  const startedAt = Date.now();
  let eventsProcessed = 0;

  let version = 'unknown';
  try {
    const pkg = JSON.parse(readFileSync(join(root, 'node_modules', 'agentxchain', 'package.json'), 'utf8'));
    version = pkg.version;
  } catch {
    try {
      // Fallback: try the CLI's own package.json
      const pkg = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'));
      version = pkg.version;
    } catch {}
  }

  const server = createServer(async (req, res) => {
    try {
      // Health endpoint
      if (req.method === 'GET' && req.url === '/health') {
        writeJson(res, 200, {
          ok: true,
          version,
          uptime_ms: Date.now() - startedAt,
          events_processed: eventsProcessed,
        });
        return;
      }

      // Webhook endpoint
      if (req.method === 'POST' && req.url === '/webhook') {
        await handleWebhook(req, res, { root, secret, allowUnsigned, dryRun, startedAt });
        eventsProcessed++;
        return;
      }

      // Method not allowed on known paths
      if (req.url === '/webhook' || req.url === '/health') {
        writeJson(res, 405, { ok: false, error: 'method not allowed' });
        return;
      }

      // Not found
      writeJson(res, 404, { ok: false, error: 'not found' });
    } catch (err) {
      writeJson(res, 500, { ok: false, error: 'internal error' });
    }
  });

  return new Promise((resolve, reject) => {
    server.on('error', reject);
    server.listen(port, host, () => {
      server.removeListener('error', reject);
      if (onReady) onReady({ port, host });
      resolve(server);
    });
  });
}

async function handleWebhook(req, res, ctx) {
  const { root, secret, allowUnsigned, dryRun } = ctx;

  // Content-Type check
  const contentType = req.headers['content-type'] || '';
  if (!contentType.includes('application/json')) {
    writeJson(res, 415, { ok: false, error: 'content type must be application/json' });
    return;
  }

  // Read body with size limit
  let rawBody;
  try {
    rawBody = await readBody(req, MAX_BODY_BYTES);
  } catch (err) {
    if (err.message === 'payload too large') {
      writeJson(res, 413, { ok: false, error: 'payload too large' });
      return;
    }
    writeJson(res, 400, { ok: false, error: err.message });
    return;
  }

  // Signature verification
  if (secret) {
    const sigHeader = req.headers['x-hub-signature-256'];
    if (!sigHeader) {
      writeJson(res, 401, { ok: false, error: 'signature verification failed' });
      return;
    }
    const expected = 'sha256=' + createHmac('sha256', secret).update(rawBody).digest('hex');
    if (!constantTimeEqual(expected, sigHeader)) {
      writeJson(res, 401, { ok: false, error: 'signature verification failed' });
      return;
    }
  } else if (!allowUnsigned) {
    writeJson(res, 403, { ok: false, error: 'webhook secret required' });
    return;
  }

  // Parse JSON
  let parsed;
  try {
    parsed = JSON.parse(rawBody);
  } catch {
    writeJson(res, 400, { ok: false, error: 'invalid JSON' });
    return;
  }

  // Construct envelope using X-GitHub-Event header if present
  const githubEvent = req.headers['x-github-event'];
  const deliveryId = req.headers['x-github-delivery'] || null;
  let envelope;
  if (parsed.provider && parsed.event) {
    // Already enveloped
    envelope = parsed;
  } else if (githubEvent) {
    envelope = { provider: 'github', event: githubEvent, ...parsed };
  } else {
    envelope = parsed;
  }

  // Normalize
  let payload;
  try {
    payload = normalizeWatchEvent(envelope);
  } catch (err) {
    writeJson(res, 422, { ok: false, error: err.message });
    return;
  }

  // Dry-run: return normalized payload without persisting
  if (dryRun) {
    writeJson(res, 200, { ok: true, dry_run: true, payload });
    return;
  }

  // Record event through the governed intake pipeline
  const result = recordEvent(root, payload);
  if (!result.ok) {
    writeJson(res, 422, { ok: false, error: result.error || 'event recording failed' });
    return;
  }

  // Route-based auto-triage and auto-approve (same logic as ingestWatchEvent)
  let routed = null;
  if (!result.deduplicated && result.intent) {
    let routes;
    try {
      const rawConfig = JSON.parse(readFileSync(join(root, 'agentxchain.json'), 'utf8'));
      routes = rawConfig?.watch?.routes;
    } catch {}

    const resolved = resolveWatchRoute(payload, routes);
    if (resolved) {
      const triageFields = { ...resolved.triage };
      if (resolved.preferred_role) triageFields.preferred_role = resolved.preferred_role;

      const triageResult = triageIntent(root, result.intent.intent_id, triageFields);
      if (triageResult.ok) {
        result.intent = triageResult.intent;
        routed = { triaged: true, approved: false, preferred_role: resolved.preferred_role };

        if (resolved.auto_approve) {
          const approveResult = approveIntent(root, result.intent.intent_id, {
            approver: 'watch_route',
            reason: `auto-approved by watch route matching ${payload.category}`,
          });
          if (approveResult.ok) {
            result.intent = approveResult.intent;
            routed.approved = true;

            if (resolved.auto_start) {
              const planResult = planIntent(root, result.intent.intent_id, {
                force: resolved.overwrite_planning_artifacts === true,
              });
              if (planResult.ok) {
                result.intent = planResult.intent;
                routed.planned = true;
                const startResult = startIntent(root, result.intent.intent_id, {});
                if (startResult.ok) {
                  result.intent = startResult.intent;
                  routed.started = true;
                  routed.run_id = startResult.run_id || null;
                  routed.role = startResult.role || null;
                } else {
                  routed.started = false;
                  routed.auto_start_error = startResult.error;
                }
              } else {
                routed.planned = false;
                routed.started = false;
                routed.auto_start_error = planResult.error;
              }
            }
          }
        } else if (resolved.auto_start) {
          routed.auto_start_skipped = 'requires auto_approve';
        }
      }
    }
  }

  if (routed) result.routed = routed;

  // Write durable watch result
  const watchResult = writeWatchResult(root, result, payload);

  // Build response
  const response = {
    ok: true,
    result_id: watchResult.result_id,
    event_id: result.event?.event_id || null,
    intent_id: result.intent?.intent_id || null,
    intent_status: result.intent?.status || null,
    deduplicated: result.deduplicated === true,
    delivery_id: deliveryId,
    route: routed
      ? {
          matched: true,
          triaged: routed.triaged === true,
          approved: routed.approved === true,
          planned: routed.planned === true,
          started: routed.started === true,
          preferred_role: routed.preferred_role || null,
          run_id: routed.run_id || null,
          role: routed.role || null,
        }
      : { matched: false },
  };

  writeJson(res, 200, response);
}

function readBody(req, maxBytes) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let rejected = false;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > maxBytes && !rejected) {
        rejected = true;
        reject(new Error('payload too large'));
        // Resume to drain remaining data so the response can be sent
        req.resume();
        return;
      }
      if (!rejected) chunks.push(chunk);
    });
    req.on('end', () => {
      if (!rejected) resolve(Buffer.concat(chunks));
    });
    req.on('error', (err) => {
      if (!rejected) reject(err);
    });
  });
}

function constantTimeEqual(a, b) {
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

function writeJson(res, statusCode, payload) {
  if (res.writableEnded) return;
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-cache',
  });
  res.end(JSON.stringify(payload));
}
