import { execFileSync } from 'child_process';
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(join(__dirname, '../../package.json'), 'utf8'));
const SEMVER_RE = /^v?(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/;

export const CURRENT_CLI_VERSION = pkg.version;

export function normalizeCliVersion(version) {
  if (typeof version !== 'string') return null;
  const trimmed = version.trim();
  const match = SEMVER_RE.exec(trimmed);
  if (!match) return null;
  return `${Number(match[1])}.${Number(match[2])}.${Number(match[3])}`;
}

export function compareCliVersions(left, right) {
  const a = normalizeCliVersion(left);
  const b = normalizeCliVersion(right);
  if (!a || !b) return null;

  const aParts = a.split('.').map(Number);
  const bParts = b.split('.').map(Number);

  for (let i = 0; i < 3; i += 1) {
    if (aParts[i] > bParts[i]) return 1;
    if (aParts[i] < bParts[i]) return -1;
  }
  return 0;
}

export function getPublishedDocsMinimumCliVersion() {
  const envOverride = normalizeCliVersion(process.env.AGENTXCHAIN_DOCS_MIN_VERSION || '');
  if (envOverride) {
    return {
      version: envOverride,
      source: 'env',
    };
  }

  try {
    const stdout = execFileSync('npm', ['view', 'agentxchain', 'version'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 3000,
    }).trim();
    const published = normalizeCliVersion(stdout);
    if (!published) return null;
    return {
      version: published,
      source: 'npm',
    };
  } catch {
    return null;
  }
}

export function getCliVersionHealth() {
  const current = normalizeCliVersion(CURRENT_CLI_VERSION);
  const docsFloor = getPublishedDocsMinimumCliVersion();
  if (!docsFloor) {
    return {
      current_version: current,
      docs_min_cli_version: null,
      status: 'unknown',
      source: null,
      stale: false,
      detail: 'Could not verify the published docs CLI floor.',
    };
  }

  const compare = compareCliVersions(current, docsFloor.version);
  if (compare === null) {
    return {
      current_version: current,
      docs_min_cli_version: docsFloor.version,
      status: 'unknown',
      source: docsFloor.source,
      stale: false,
      detail: 'Could not compare CLI versions.',
    };
  }

  if (compare < 0) {
    return {
      current_version: current,
      docs_min_cli_version: docsFloor.version,
      status: 'stale',
      source: docsFloor.source,
      stale: true,
      detail: `Public docs target agentxchain >= ${docsFloor.version}, but this CLI is ${current}. Upgrade with npm/Homebrew or use npx --yes -p agentxchain@latest -c "agentxchain doctor".`,
    };
  }

  return {
    current_version: current,
    docs_min_cli_version: docsFloor.version,
    status: 'ok',
    source: docsFloor.source,
    stale: false,
    detail: `Running ${current}; published docs floor is ${docsFloor.version}.`,
  };
}
