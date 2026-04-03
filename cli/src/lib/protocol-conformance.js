import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEFAULT_FIXTURE_ROOT = resolve(__dirname, '..', '..', '..', '.agentxchain-conformance', 'fixtures');
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

function loadCapabilities(targetRoot) {
  const capabilitiesPath = join(targetRoot, '.agentxchain-conformance', 'capabilities.json');
  if (!existsSync(capabilitiesPath)) {
    throw new Error(`Missing capabilities file at ${capabilitiesPath}`);
  }

  const capabilities = readJsonFile(capabilitiesPath);
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
    if (capabilities.adapter.protocol !== 'stdio-fixture-v1') {
      errors.push('capabilities.adapter.protocol must be "stdio-fixture-v1"');
    }
    if (!Array.isArray(capabilities.adapter.command) || capabilities.adapter.command.length === 0) {
      errors.push('capabilities.adapter.command must be a non-empty array');
    }
  }

  if (errors.length > 0) {
    throw new Error(`Invalid capabilities.json: ${errors.join('; ')}`);
  }

  return capabilities;
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

function executeFixture(targetRoot, adapterCommand, fixture) {
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

export function getDefaultFixtureRoot() {
  return DEFAULT_FIXTURE_ROOT;
}

export function verifyProtocolConformance({
  targetRoot,
  requestedTier = 1,
  surface = null,
  fixtureRoot = DEFAULT_FIXTURE_ROOT,
}) {
  if (!Number.isInteger(requestedTier) || !VALID_TIERS.has(requestedTier)) {
    throw new Error(`Tier must be 1, 2, or 3. Received "${requestedTier}"`);
  }

  const resolvedTargetRoot = resolve(targetRoot);
  const capabilities = loadCapabilities(resolvedTargetRoot);

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
    const adapterResult = executeFixture(resolvedTargetRoot, capabilities.adapter.command, fixture);

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
