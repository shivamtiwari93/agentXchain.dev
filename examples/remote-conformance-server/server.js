#!/usr/bin/env node

import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runReferenceFixture } from '../../cli/src/lib/reference-conformance-adapter.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..', '..');
const DEFAULT_PORT = 8788;

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function resolvePort(argv, env) {
  const portIndex = argv.indexOf('--port');
  const value = portIndex !== -1 ? argv[portIndex + 1] : env.PORT || DEFAULT_PORT;
  const port = Number.parseInt(String(value), 10);

  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new Error(`Invalid port "${value}"`);
  }

  return port;
}

function buildCapabilities() {
  const cliPackage = readJson(join(REPO_ROOT, 'cli', 'package.json'));
  const referenceCapabilities = readJson(join(REPO_ROOT, '.agentxchain-conformance', 'capabilities.json'));

  return {
    ...referenceCapabilities,
    implementation: 'agentxchain-reference-http-example',
    version: cliPackage.version,
    adapter: {
      protocol: 'http-fixture-v1',
    },
    metadata: {
      ...(referenceCapabilities.metadata || {}),
      name: 'AgentXchain Reference HTTP Example',
    },
  };
}

function writeJson(res, statusCode, payload) {
  res.writeHead(statusCode, {
    'content-type': 'application/json',
    connection: 'close',
  });
  res.end(JSON.stringify(payload));
}

function requireBearerToken(req, res, expectedToken) {
  if (!expectedToken) {
    return true;
  }

  if (req.headers.authorization !== `Bearer ${expectedToken}`) {
    writeJson(res, 401, { message: 'Unauthorized' });
    return false;
  }

  return true;
}

async function readRequestBody(req) {
  let body = '';
  req.setEncoding('utf8');
  for await (const chunk of req) {
    body += chunk;
  }
  return body;
}

async function handleRequest(req, res, { capabilities, token }) {
  if (req.url === '/conform/capabilities') {
    if (req.method !== 'GET') {
      writeJson(res, 405, { message: 'Method not allowed' });
      return;
    }
    if (!requireBearerToken(req, res, token)) {
      return;
    }

    writeJson(res, 200, capabilities);
    return;
  }

  if (req.url === '/conform/execute') {
    if (req.method !== 'POST') {
      writeJson(res, 405, { message: 'Method not allowed' });
      return;
    }
    if (!requireBearerToken(req, res, token)) {
      return;
    }

    let fixture;
    try {
      fixture = JSON.parse(await readRequestBody(req));
    } catch (error) {
      writeJson(res, 400, { message: `Invalid JSON: ${error.message}` });
      return;
    }

    try {
      writeJson(res, 200, runReferenceFixture(fixture));
    } catch (error) {
      writeJson(res, 500, { message: error.message });
    }
    return;
  }

  writeJson(res, 404, { message: 'Not found' });
}

async function main() {
  const port = resolvePort(process.argv.slice(2), process.env);
  const token = process.env.CONFORMANCE_TOKEN || null;
  const capabilities = buildCapabilities();

  const server = createServer((req, res) => {
    void handleRequest(req, res, { capabilities, token }).catch((error) => {
      writeJson(res, 500, { message: error.message });
    });
  });

  server.listen(port, '127.0.0.1', () => {
    console.log(`agentxchain-remote-conformance-server listening on http://127.0.0.1:${port}`);
    if (token) {
      console.log('Bearer auth enabled via CONFORMANCE_TOKEN.');
    }
  });
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
