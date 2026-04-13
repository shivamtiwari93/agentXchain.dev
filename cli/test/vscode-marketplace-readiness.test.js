import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..', '..');

function read(relPath) {
  return readFileSync(join(REPO_ROOT, relPath), 'utf8');
}

function readJson(relPath) {
  return JSON.parse(read(relPath));
}

const EXTENSION_DIR = 'cli/vscode-extension';
const WORKFLOW_PATH = '.github/workflows/publish-vscode-on-tag.yml';
const README = read(`${EXTENSION_DIR}/README.md`);
const CHANGELOG = read(`${EXTENSION_DIR}/CHANGELOG.md`);
const VSCODEIGNORE = read(`${EXTENSION_DIR}/.vscodeignore`);
const WORKFLOW = read(WORKFLOW_PATH);
const PACKAGE = readJson(`${EXTENSION_DIR}/package.json`);

describe('VS Code marketplace readiness', () => {
  it('AT-VSMP-001: extension packaging surface exists', () => {
    for (const relPath of [
      `${EXTENSION_DIR}/package.json`,
      `${EXTENSION_DIR}/README.md`,
      `${EXTENSION_DIR}/CHANGELOG.md`,
      `${EXTENSION_DIR}/.vscodeignore`,
      WORKFLOW_PATH,
    ]) {
      assert.ok(existsSync(join(REPO_ROOT, relPath)), `${relPath} must exist`);
    }
  });

  it('AT-VSMP-002: package metadata carries marketplace basics', () => {
    assert.equal(PACKAGE.name, 'agentxchain');
    assert.equal(PACKAGE.publisher, 'agentXchaindev');
    assert.equal(PACKAGE.icon, 'media/icon.png');
    assert.deepEqual(PACKAGE.galleryBanner, { color: '#0a0a0a', theme: 'dark' });
    assert.ok(Array.isArray(PACKAGE.categories), 'package.json categories must be an array');
    assert.ok(PACKAGE.categories.includes('AI'), 'package.json categories must include AI');
    assert.ok(PACKAGE.categories.includes('Testing'), 'package.json categories must include Testing');
  });

  it('AT-VSMP-003: README exposes marketplace-facing structure', () => {
    for (const heading of ['## Features', '## Requirements', '## Commands', '## Packaging']) {
      assert.match(README, new RegExp(`^${heading}$`, 'm'), `README must contain heading "${heading}"`);
    }
    assert.match(README, /Governed mode requires the `agentxchain` CLI/i);
    assert.match(README, /Legacy mode/i);
    assert.match(README, /Governed mode \(observer\)/i);
    assert.match(README, /Governed mode \(operator\)/i);
  });

  it('AT-VSMP-004: .vscodeignore excludes development-only artifacts', () => {
    for (const ignored of ['src/**', 'tsconfig.json', '*.vsix', 'node_modules/**']) {
      assert.match(
        VSCODEIGNORE,
        new RegExp(`^${ignored.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'm'),
        `.vscodeignore must exclude ${ignored}`,
      );
    }
  });

  it('AT-VSMP-005: extension changelog documents the initial release', () => {
    assert.match(CHANGELOG, /^## \[0\.1\.0\]/m, 'CHANGELOG must include the 0.1.0 entry');
    assert.match(CHANGELOG, /^### Added$/m, 'CHANGELOG must include an Added section');
    assert.match(CHANGELOG, /Governed observer mode/i, 'CHANGELOG must describe governed mode scope');
  });

  it('AT-VSMP-006: publish workflow is tag-driven and fail-closed on missing credentials', () => {
    assert.match(WORKFLOW, /vsce-v\*\.\*\.\*/i, 'publish workflow must trigger on vsce-vX.Y.Z tags');
    assert.match(WORKFLOW, /workflow_dispatch:/, 'publish workflow must support manual reruns');
    assert.match(WORKFLOW, /VSCE_PAT:\s*\$\{\{\s*secrets\.VSCE_PAT\s*\}\}/, 'publish workflow must use VSCE_PAT');
    assert.match(WORKFLOW, /Tag version \(\$TAG_VERSION\) does not match package\.json version/i);
    assert.match(WORKFLOW, /VSCE_PAT secret not configured\. Cannot publish to VS Code Marketplace\./i);
    assert.match(WORKFLOW, /npx @vscode\/vsce package --no-dependencies/i);
    assert.match(WORKFLOW, /npx @vscode\/vsce publish --no-dependencies -p "\$VSCE_PAT"/i);
  });
});
