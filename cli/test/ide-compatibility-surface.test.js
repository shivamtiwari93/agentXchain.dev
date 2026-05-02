import { beforeAll, describe, it } from 'vitest';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { importCompiledVsCodeExtensionModule } from '../test-support/vscode-extension-test-helpers.js';

const ROOT = resolve(import.meta.dirname, '..', '..');

function read(relativePath) {
  return readFileSync(join(ROOT, relativePath), 'utf8');
}

describe('IDE compatibility public boundary', () => {
  const rootReadme = read('README.md');
  const cliReadme = read('cli/README.md');
  const homepage = read('website-v2/src/pages/index.tsx');
  const spec = read('.planning/IDE_COMPATIBILITY_BOUNDARY_SPEC.md');
  const extensionReadme = read('cli/vscode-extension/README.md');

  it('keeps the repo READMEs honest about legacy IDE mode', () => {
    assert.match(rootReadme, /Legacy IDE-window coordination is still available/i);
    assert.match(cliReadme, /Legacy IDE-window coordination is still shipped/i);
    assert.match(cliReadme, /lock-based handoff/i);
  });

  it('keeps homepage copy honest about the IDE surface', () => {
    assert.match(homepage, /Legacy IDE compatibility/);
    assert.match(homepage, /CLI-backed status, approvals, step\/run launch/i);
    assert.match(homepage, /restart\s+recovery/i);
    assert.match(homepage, /report and dashboard access/i);
    assert.match(homepage, /state-change\s+notifications/i);
    assert.match(homepage, /browser dashboard\s+and CLI/);
    assert.doesNotMatch(homepage, /full governed control plane/i);
    assert.doesNotMatch(homepage, /without leaving your IDE/i);
  });

  it('documents the IDE boundary in a standalone spec and extension README', () => {
    assert.match(spec, /## Purpose/);
    assert.match(spec, /## Acceptance Tests/);
    assert.match(spec, /legacy lock-based coordination/i);
    assert.match(spec, /governed VS Code slice is no longer read-only/i);
    assert.match(spec, /step\/run launch/i);
    assert.match(spec, /restart recovery/i);
    assert.match(spec, /dashboard launch/i);

    assert.match(extensionReadme, /Legacy mode/);
    assert.match(extensionReadme, /Governed mode/);
    assert.match(extensionReadme, /Start or Resume Governed Run/i);
    assert.match(extensionReadme, /Restart Governed Session/i);
    assert.match(extensionReadme, /Open Browser Dashboard/i);
  });
});

describe('VS Code extension project-mode detection', () => {
  let utilModule;

  beforeAll(async () => {
    utilModule = await importCompiledVsCodeExtensionModule('util.js');
  });

  it('detects governed projects and exposes governed boundary guidance', () => {
    const dir = mkdtempSync(join(tmpdir(), 'agentxchain-governed-'));
    mkdirSync(join(dir, '.agentxchain'), { recursive: true });
    writeFileSync(join(dir, 'agentxchain.json'), JSON.stringify({
      schema_version: '1.0',
      project: { id: 'gov', name: 'Governed Repo' },
      roles: { pm: { title: 'PM' } },
    }, null, 2));
    writeFileSync(join(dir, '.agentxchain', 'state.json'), JSON.stringify({
      status: 'active',
      phase: 'implementation',
      blocked_on: null,
    }, null, 2));

    assert.equal(utilModule.detectProjectMode(dir), 'governed');
    const surface = utilModule.getProjectSurface(dir);
    assert.equal(surface.mode, 'governed');
    assert.equal(utilModule.getProjectName(surface.config), 'Governed Repo');
    assert.equal(surface.state.phase, 'implementation');
    assert.match(utilModule.GOVERNED_MODE_NOTICE, /dashboard/i);
    assert.match(utilModule.GOVERNED_MODE_NOTICE, /approvals/i);
    assert.match(utilModule.GOVERNED_MODE_NOTICE, /restart recovery/i);
    assert.match(utilModule.GOVERNED_MODE_NOTICE, /dashboard launch/i);
  });

  it('detects legacy lock-based projects', () => {
    const dir = mkdtempSync(join(tmpdir(), 'agentxchain-legacy-'));
    writeFileSync(join(dir, 'agentxchain.json'), JSON.stringify({
      version: 3,
      project: 'Legacy Repo',
      agents: {
        dev: { name: 'Developer', mandate: 'Ship code' },
      },
    }, null, 2));
    writeFileSync(join(dir, 'lock.json'), JSON.stringify({
      holder: 'dev',
      last_released_by: 'human',
      turn_number: 4,
      claimed_at: null,
    }, null, 2));
    writeFileSync(join(dir, 'state.json'), JSON.stringify({
      phase: 'implementation',
      blocked: false,
      blocked_on: null,
    }, null, 2));

    assert.equal(utilModule.detectProjectMode(dir), 'legacy');
    const surface = utilModule.getProjectSurface(dir);
    assert.equal(surface.mode, 'legacy');
    assert.equal(utilModule.getProjectName(surface.config), 'Legacy Repo');
    assert.equal(surface.lock.holder, 'dev');
    assert.equal(surface.state.phase, 'implementation');
  });
});
