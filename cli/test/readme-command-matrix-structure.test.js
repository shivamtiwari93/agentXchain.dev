import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..', '..');

const readmeContent = readFileSync(resolve(repoRoot, 'README.md'), 'utf8');
const cliReadmeContent = readFileSync(resolve(repoRoot, 'cli', 'README.md'), 'utf8');

describe('AT-README-MATRIX-001: README.md groups canonical governed commands by operator intent', () => {
  for (const heading of [
    '### Lifecycle And Execution',
    '### Proof And Inspection',
    '### Automation, Plugins, And Continuity',
  ]) {
    it(`README.md contains ${heading}`, () => {
      assert.ok(
        readmeContent.includes(heading),
        `README.md must include the grouped heading "${heading}"`
      );
    });
  }
});

describe('AT-README-MATRIX-002: cli/README.md splits governed commands into multiple sections', () => {
  for (const heading of [
    '### Governed lifecycle and execution',
    '### Governed proof and inspection',
    '### Governed automation, plugins, and continuity',
  ]) {
    it(`cli/README.md contains ${heading}`, () => {
      assert.ok(
        cliReadmeContent.includes(heading),
        `cli/README.md must include the governed heading "${heading}"`
      );
    });
  }
});

describe('AT-README-MATRIX-003: critical governed commands remain discoverable after restructuring', () => {
  const criticalCommands = ['run', 'audit', 'doctor', 'connector check', 'plugin list-available', 'export', 'restore', 'replay export'];
  for (const cmd of criticalCommands) {
    it(`both READMEs still mention ${cmd}`, () => {
      assert.ok(readmeContent.includes(cmd), `README.md must still mention "${cmd}"`);
      assert.ok(cliReadmeContent.includes(cmd), `cli/README.md must still mention "${cmd}"`);
    });
  }
});
