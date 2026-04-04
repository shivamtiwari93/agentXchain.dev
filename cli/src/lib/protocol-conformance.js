import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEFAULT_FIXTURE_ROOT = resolve(__dirname, '..', '..', '..', '.agentxchain-conformance', 'fixtures');
const DEFAULT_REMOTE_TIMEOUT_MS = 30_000;
const VALID_RESPONSE_STATUSES = new Set(['pass', 'fail', 'error', 'not_implemented']);
const VALID_TIERS = new Set([1, 2, 3]);

function readJsonFile(filePath) {
  return JSON.parse(readFileSync(filePath, 'utf8'));
}

function listJsonFiles(root) {
  const files = [];

  function walk(dir) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
      } else if (entry.isFile() && entry.name.endsWith('.json')) {
        files.push(fullPath);
      }
    }
  }

  walk(root);
  return files.sort();
}

function validateFixtureShape(fixture, filePath) {
  const errors = [];
  if (!fixture || typeof fixture !== 'object' || Array.isArray(fixture)) {
    return [`${filePath}: fixture must be a JSON object`];
  }

  const required = ['fixture_id', 'tier', 'surface', 'description', 'type', 'setup', 'input', 'expected'];
  for (const field of required) {
    if (!(field in fixture)) {
      errors.push(`${filePath}: missing required field "${field}"`);
    }
  }

  if (!Number.isInteger(fixture.tier) || !VALID_TIERS.has(fixture.tier)) {
    errors.push(`${filePath}: tier must be 1, 2, or 3`);
  }

  if (!fixture.input || typeof fixture.input !== 'object' || Array.isArray(fixture.input)) {
    errors.push(`${filePath}: input must be an object`);
  } else if (typeof fixture.input.operation !== 'string' || !fixture.input.operation.trim()) {
    errors.push(`${filePath}: input.operation must be a non-empty string`);
  }

  return errors;
}

function validateCapabilities(capabilities, { remote = false } = {}) {
  const errors = [];

  if (typeof capabilities.implementation !== 'string' || !capabilities.implementation.trim()) {
    errors.push('capabilities.implementation must be a non-empty string');
  }
  if (!Array.isArray(capabilities.tiers) || capabilities.tiers.length === 0) {
    errors.push('capabilities.tiers must be a non-empty array');
  } else {
    for (const tier of capabilities.tiers) {
      if (!VALID_TIERS.has(tier)) {
        errors.push(`capabilities.tiers contains invalid tier "${tier}"`);
      }
    }
  }
  if (!capabilities.adapter || typeof capabilities.adapter !== 'object' || Array.isArray(capabilities.adapter)) {
    errors.push('capabilities.adapter must be an object');
  } else {
    const expectedProtocol = remote ? 'http-fixture-v1' : 'stdio-fixture-v1';
    if (capabilities.adapter.protocol !== expectedProtocol) {
      errors.push(`capabilities.adapter.protocol must be "${expectedProtocol}"`);
    }
    if (!remote && (!Array.isArray(capabilities.adapter.command) || capabilities.adapter.command.length === 0)) {
      errors.push('capabilities.adapter.command must be a non-empty array');
    }
  }

  return errors;
}

function loadLocalCapabilities(targetRoot) {
  const capabilitiesPath = join(targetRoot, '.agentxchain-conformance', 'capabilities.json');
  if (!existsSync(capabilitiesPath)) {
    throw new Error(`Missing capabilities file at ${capabilitiesPath}`);
  }

  const capabilities = readJsonFile(capabilitiesPath);
  const errors = validateCapabilities(capabilities);
  if (errors.length > 0) {
    throw new Error(`Invalid capabilities.json: ${errors.join('; ')}`);
  }

  return capabilities;
}

function normalizeRemoteBase(remote) {
  let url;
  try {
    url = new URL(remote);
  } catch (error) {
    throw new Error(`Invalid remote URL "${remote}": ${error.message}`);
  }

  const normalized = url.toString();
  return normalized.endsWith('/') ? normalized.slice(0, -1) : normalized;
}

function buildRemoteUrl(remoteBase, path) {
  return new URL(path.replace(/^\//, ''), `${remoteBase}/`).toString();
}

function buildRemoteHeaders(token, extraHeaders = {}) {
  return {
    ...extraHeaders,
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

function isTimeoutError(error) {
  return error?.name === 'TimeoutError'
    || error?.name === 'AbortError'
    || error?.cause?.name === 'TimeoutError'
    || error?.cause?.name === 'AbortError';
}

function formatRemoteFetchError(error, timeout, prefix) {
  if (isTimeoutError(error)) {
    return `${prefix} timeout after ${timeout}ms`;
  }
  return `${prefix} network error: ${error.message}`;
}

async function loadRemoteCapabilities(remote, token, timeout) {
  const remoteBase = normalizeRemoteBase(remote);
  const capabilitiesUrl = buildRemoteUrl(remoteBase, '/conform/capabilities');

  try {
    const response = await requestRemote(capabilitiesUrl, {
      headers: buildRemoteHeaders(token),
      timeout,
    });

    if (response.statusCode !== 200) {
      throw new Error(`Failed to fetch remote capabilities: HTTP ${response.statusCode}`);
    }

    let capabilities;
    try {
      capabilities = JSON.parse(response.body);
    } catch (error) {
      throw new Error(`Invalid capabilities response: ${error.message}`);
    }

    const errors = validateCapabilities(capabilities, { remote: true });
    if (errors.length > 0) {
      throw new Error(`Invalid capabilities.json: ${errors.join('; ')}`);
    }

    return {
      capabilities,
      remoteBase,
      executeUrl: buildRemoteUrl(remoteBase, '/conform/execute'),
    };
  } catch (error) {
    if (error.message.startsWith('Failed to fetch remote capabilities:')
      || error.message.startsWith('Invalid capabilities response:')
      || error.message.startsWith('Invalid capabilities.json:')) {
      throw error;
    }
    throw new Error(formatRemoteFetchError(error, timeout, 'Failed to fetch remote capabilities'));
  }
}

function selectFixtureFiles(fixtureRoot, requestedTier, surface) {
  if (!existsSync(fixtureRoot)) {
    throw new Error(`Fixture root not found at ${fixtureRoot}`);
  }

  return listJsonFiles(fixtureRoot)
    .filter((filePath) => {
      const fixture = readJsonFile(filePath);
      const shapeErrors = validateFixtureShape(fixture, filePath);
      if (shapeErrors.length > 0) {
        throw new Error(shapeErrors.join('; '));
      }
      return fixture.tier <= requestedTier && (!surface || fixture.surface === surface);
    })
    .map((filePath) => ({ filePath, fixture: readJsonFile(filePath) }));
}

function createTierSummary(status = 'skipped', note = null) {
  return {
    status,
    fixtures_run: 0,
    fixtures_passed: 0,
    fixtures_failed: 0,
    fixtures_errored: 0,
    fixtures_not_implemented: 0,
    surfaces: {},
    failures: [],
    errors: [],
    not_implemented: [],
    ...(note ? { note } : {}),
  };
}

function ensureSurfaceSummary(tierSummary, surface) {
  if (!tierSummary.surfaces[surface]) {
    tierSummary.surfaces[surface] = { passed: 0, failed: 0, errored: 0, not_implemented: 0 };
  }
  return tierSummary.surfaces[surface];
}

function executeLocalFixture(targetRoot, adapterCommand, fixture) {
  const [executable, ...args] = adapterCommand;
  const result = spawnSync(executable, args, {
    cwd: targetRoot,
    encoding: 'utf8',
    input: `${JSON.stringify(fixture)}\n`,
  });

  if (result.error) {
    return {
      status: 'error',
      message: `Failed to execute adapter: ${result.error.message}`,
      actual: null,
    };
  }

  if (![0, 1, 2, 3].includes(result.status ?? -1)) {
    return {
      status: 'error',
      message: `Adapter exited with unsupported status ${result.status}`,
      actual: {
        exit_code: result.status,
        stderr: result.stderr?.trim() || '',
      },
    };
  }

  let parsed;
  try {
    parsed = JSON.parse((result.stdout || '').trim() || '{}');
  } catch (error) {
    return {
      status: 'error',
      message: `Malformed adapter response: ${error.message}`,
      actual: {
        stdout: result.stdout || '',
        stderr: result.stderr || '',
      },
    };
  }

  if (!VALID_RESPONSE_STATUSES.has(parsed.status)) {
    return {
      status: 'error',
      message: 'Adapter response missing valid "status"',
      actual: parsed,
    };
  }

  const expectedExitCode = parsed.status === 'pass' ? 0 : parsed.status === 'fail' ? 1 : parsed.status === 'not_implemented' ? 3 : 2;
  if (result.status !== expectedExitCode) {
    return {
      status: 'error',
      message: `Adapter exit code ${result.status} does not match response status "${parsed.status}"`,
      actual: parsed,
    };
  }

  return parsed;
}

async function executeRemoteFixture(executeUrl, token, timeout, fixture) {
  let response;
  try {
    response = await requestRemote(executeUrl, {
      method: 'POST',
      headers: buildRemoteHeaders(token, {
        'content-type': 'application/json',
      }),
      body: JSON.stringify(fixture),
      timeout,
    });
  } catch (error) {
    return {
      status: 'error',
      message: formatRemoteFetchError(error, timeout, 'HTTP fixture execution'),
      actual: null,
    };
  }

  const rawBody = response.body;

  if (response.statusCode !== 200) {
    let actual = null;
    let message = rawBody.trim() || `HTTP ${response.statusCode}`;

    if (rawBody.trim()) {
      try {
        const parsed = JSON.parse(rawBody);
        actual = parsed;
        if (typeof parsed.message === 'string' && parsed.message.trim()) {
          message = parsed.message.trim();
        }
      } catch {
        actual = { body: rawBody };
      }
    }

    return {
      status: 'error',
      message: `HTTP ${response.statusCode}: ${message}`,
      actual,
    };
  }

  let parsed;
  try {
    parsed = JSON.parse(rawBody.trim() || '{}');
  } catch (error) {
    return {
      status: 'error',
      message: `Malformed response: ${error.message}`,
      actual: {
        body: rawBody,
      },
    };
  }

  if (!VALID_RESPONSE_STATUSES.has(parsed.status)) {
    return {
      status: 'error',
      message: 'Adapter response missing valid "status"',
      actual: parsed,
    };
  }

  return parsed;
}

function requestRemote(urlString, { method = 'GET', headers = {}, body = null, timeout }) {
  const url = new URL(urlString);
  const requestImpl = url.protocol === 'https:' ? httpsRequest : httpRequest;
  const requestHeaders = {
    connection: 'close',
    ...headers,
  };

  if (body != null && requestHeaders['content-length'] == null && requestHeaders['Content-Length'] == null) {
    requestHeaders['content-length'] = Buffer.byteLength(body);
  }

  return new Promise((resolveRequest, rejectRequest) => {
    const req = requestImpl(url, {
      method,
      headers: requestHeaders,
    }, (res) => {
      let responseBody = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => {
        responseBody += chunk;
      });
      res.on('end', () => {
        resolveRequest({
          statusCode: res.statusCode ?? 0,
          body: responseBody,
        });
      });
    });

    req.on('error', rejectRequest);
    req.setTimeout(timeout, () => {
      const error = new Error(`timeout after ${timeout}ms`);
      error.name = 'TimeoutError';
      req.destroy(error);
    });

    if (body) {
      req.write(body);
    }

    req.end();
  });
}

export function getDefaultFixtureRoot() {
  return DEFAULT_FIXTURE_ROOT;
}

export async function verifyProtocolConformance({
  targetRoot,
  remote = null,
  token = null,
  timeout = DEFAULT_REMOTE_TIMEOUT_MS,
  requestedTier = 1,
  surface = null,
  fixtureRoot = DEFAULT_FIXTURE_ROOT,
}) {
  if (!Number.isInteger(requestedTier) || !VALID_TIERS.has(requestedTier)) {
    throw new Error(`Tier must be 1, 2, or 3. Received "${requestedTier}"`);
  }
  if (!Number.isInteger(timeout) || timeout <= 0) {
    throw new Error(`Timeout must be a positive integer number of milliseconds. Received "${timeout}"`);
  }
  if (!!targetRoot === !!remote) {
    throw new Error('Specify exactly one of targetRoot or remote');
  }

  const resolvedTargetRoot = targetRoot ? resolve(targetRoot) : null;
  const remoteTarget = remote ? normalizeRemoteBase(remote) : null;
  const localCapabilities = resolvedTargetRoot ? loadLocalCapabilities(resolvedTargetRoot) : null;
  const remoteCapabilities = remoteTarget ? await loadRemoteCapabilities(remoteTarget, token, timeout) : null;
  const capabilities = localCapabilities || remoteCapabilities.capabilities;

  // Enforce surface claims when capabilities.surfaces exists and --surface is requested
  if (surface && capabilities.surfaces && typeof capabilities.surfaces === 'object') {
    if (!capabilities.surfaces[surface]) {
      throw new Error(
        `Surface "${surface}" is not claimed in capabilities.json. ` +
        `Claimed surfaces: ${Object.keys(capabilities.surfaces).join(', ')}`
      );
    }
  }

  const fixtureEntries = selectFixtureFiles(fixtureRoot, requestedTier, surface);
  const claimedTiers = new Set(capabilities.tiers);
  const report = {
    implementation: capabilities.implementation,
    protocol_version: capabilities.protocol_version || null,
    tier_requested: requestedTier,
    timestamp: new Date().toISOString(),
    target_root: resolvedTargetRoot,
    remote: remoteTarget,
    fixture_root: fixtureRoot,
    results: {},
    overall: 'pass',
  };

  for (let tier = 1; tier <= requestedTier; tier += 1) {
    if (claimedTiers.has(tier)) {
      report.results[`tier_${tier}`] = createTierSummary('pass');
    } else {
      report.results[`tier_${tier}`] = createTierSummary('skipped', `Target does not claim Tier ${tier}`);
    }
  }

  for (const { fixture } of fixtureEntries) {
    const tierKey = `tier_${fixture.tier}`;
    const tierSummary = report.results[tierKey];

    if (!tierSummary || tierSummary.status === 'skipped') {
      continue;
    }

    const surfaceSummary = ensureSurfaceSummary(tierSummary, fixture.surface);
    const adapterResult = resolvedTargetRoot
      ? executeLocalFixture(resolvedTargetRoot, capabilities.adapter.command, fixture)
      : await executeRemoteFixture(remoteCapabilities.executeUrl, token, timeout, fixture);

    tierSummary.fixtures_run += 1;

    if (adapterResult.status === 'pass') {
      tierSummary.fixtures_passed += 1;
      surfaceSummary.passed += 1;
      continue;
    }

    if (adapterResult.status === 'not_implemented') {
      tierSummary.fixtures_not_implemented += 1;
      surfaceSummary.not_implemented += 1;
      tierSummary.not_implemented.push({
        fixture_id: fixture.fixture_id,
        surface: fixture.surface,
        message: adapterResult.message || 'Not implemented',
      });
      continue;
    }

    if (adapterResult.status === 'fail') {
      tierSummary.fixtures_failed += 1;
      surfaceSummary.failed += 1;
      tierSummary.status = 'fail';
      tierSummary.failures.push({
        fixture_id: fixture.fixture_id,
        surface: fixture.surface,
        message: adapterResult.message || 'Fixture failed',
        actual: adapterResult.actual ?? null,
      });
      report.overall = 'fail';
      continue;
    }

    tierSummary.fixtures_errored += 1;
    surfaceSummary.errored += 1;
    tierSummary.status = 'error';
    tierSummary.errors.push({
      fixture_id: fixture.fixture_id,
      surface: fixture.surface,
      message: adapterResult.message || 'Fixture errored',
      actual: adapterResult.actual ?? null,
    });
    report.overall = 'error';
  }

  if (report.overall === 'pass') {
    const hasHardError = Object.values(report.results).some((tier) => tier.status === 'error');
    const hasFailure = Object.values(report.results).some((tier) => tier.status === 'fail');
    if (hasHardError) {
      report.overall = 'error';
    } else if (hasFailure) {
      report.overall = 'fail';
    }
  }

  const exitCode = report.overall === 'pass' ? 0 : report.overall === 'fail' ? 1 : 2;
  return { report, exitCode };
}
