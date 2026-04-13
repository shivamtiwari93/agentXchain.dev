import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..', '..');

const readmeContent = readFileSync(resolve(repoRoot, 'README.md'), 'utf8');
const cliReadmeContent = readFileSync(resolve(repoRoot, 'cli', 'README.md'), 'utf8');
const llmsTxtContent = readFileSync(resolve(repoRoot, 'website-v2', 'static', 'llms.txt'), 'utf8');

describe('AT-INSPECT-DISC-001: README.md mentions governed inspection commands', () => {
  const inspectionCommands = ['audit', 'diff', 'report', 'events', 'history'];
  for (const cmd of inspectionCommands) {
    it(`README.md mentions ${cmd}`, () => {
      assert.ok(
        readmeContent.includes(cmd),
        `README.md must mention '${cmd}' for front-door discoverability`
      );
    });
  }
});

describe('AT-INSPECT-DISC-002: README.md mentions role/turn/phase/gate inspection', () => {
  const inspectionSurfaces = ['role list', 'turn show', 'phase list', 'gate list'];
  for (const surface of inspectionSurfaces) {
    it(`README.md mentions ${surface}`, () => {
      assert.ok(
        readmeContent.includes(surface),
        `README.md must mention '${surface}' for front-door discoverability`
      );
    });
  }
});

describe('AT-INSPECT-DISC-003: cli/README.md mentions governed inspection commands', () => {
  const inspectionCommands = ['run', 'audit', 'diff', 'report', 'events', 'history'];
  for (const cmd of inspectionCommands) {
    it(`cli/README.md mentions ${cmd}`, () => {
      assert.ok(
        cliReadmeContent.includes(cmd),
        `cli/README.md must mention '${cmd}' for front-door discoverability`
      );
    });
  }
});

describe('AT-INSPECT-DISC-004: cli/README.md mentions role/turn/phase/gate inspection', () => {
  const inspectionSurfaces = ['role list', 'turn show', 'phase list', 'gate list'];
  for (const surface of inspectionSurfaces) {
    it(`cli/README.md mentions ${surface}`, () => {
      assert.ok(
        cliReadmeContent.includes(surface),
        `cli/README.md must mention '${surface}' for front-door discoverability`
      );
    });
  }
});

describe('AT-INSPECT-DISC-005: cli/README.md mentions connector check, doctor, export, restore', () => {
  const commands = ['connector check', 'doctor', 'export', 'restore'];
  for (const cmd of commands) {
    it(`cli/README.md mentions ${cmd}`, () => {
      assert.ok(
        cliReadmeContent.includes(cmd),
        `cli/README.md must mention '${cmd}' for front-door discoverability`
      );
    });
  }
});

describe('AT-INSPECT-DISC-006: llms.txt mentions inspection/audit capability', () => {
  it('llms.txt mentions governed inspection family', () => {
    assert.ok(
      llmsTxtContent.includes('audit') && llmsTxtContent.includes('diff'),
      'llms.txt must mention audit and diff for LLM discoverability'
    );
  });

  it('llms.txt mentions role/phase/gate introspection', () => {
    assert.ok(
      llmsTxtContent.includes('role list') || llmsTxtContent.includes('role/show'),
      'llms.txt must mention role introspection'
    );
    assert.ok(
      llmsTxtContent.includes('phase list') || llmsTxtContent.includes('phase/show'),
      'llms.txt must mention phase introspection'
    );
    assert.ok(
      llmsTxtContent.includes('gate list') || llmsTxtContent.includes('gate/show'),
      'llms.txt must mention gate introspection'
    );
  });

  it('llms.txt mentions doctor and connector check', () => {
    assert.ok(
      llmsTxtContent.includes('doctor') && llmsTxtContent.includes('connector check'),
      'llms.txt must mention doctor and connector check'
    );
  });
});

describe('AT-INSPECT-DISC-007: Both READMEs mention plugin list-available', () => {
  it('README.md mentions plugin list-available', () => {
    assert.ok(
      readmeContent.includes('list-available'),
      'README.md must mention plugin list-available'
    );
  });

  it('cli/README.md mentions plugin list-available', () => {
    assert.ok(
      cliReadmeContent.includes('list-available'),
      'cli/README.md must mention plugin list-available'
    );
  });
});
