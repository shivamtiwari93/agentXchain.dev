import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..', '..');

function read(relPath) {
  return readFileSync(join(REPO_ROOT, relPath), 'utf8');
}

const VS_AUTOGEN = read('website-v2/src/pages/compare/vs-autogen.mdx');
const VS_OPENAI_AGENTS = read('website-v2/src/pages/compare/vs-openai-agents-sdk.mdx');

function assertNamesAllAdapters(text, label) {
  const requiredAdapters = ['manual', 'local_cli', 'api_proxy', 'mcp', 'remote_agent'];
  for (const adapter of requiredAdapters) {
    assert.match(
      text,
      new RegExp(`\\b${adapter}\\b`),
      `${label} must mention ${adapter}`,
    );
  }
}

describe('compare page runtime surface', () => {
  it('AT-COMPARE-RUNTIME-001: vs-autogen names all five shipped adapters', () => {
    assertNamesAllAdapters(VS_AUTOGEN, 'vs-autogen comparison page');
    assert.doesNotMatch(
      VS_AUTOGEN,
      /Connector-based \(manual, local CLI, API proxy\)/,
      'vs-autogen comparison page must not regress to the stale three-adapter wording',
    );
  });

  it('AT-COMPARE-RUNTIME-002: vs-openai-agents-sdk names all five shipped adapters', () => {
    assertNamesAllAdapters(VS_OPENAI_AGENTS, 'vs-openai-agents-sdk comparison page');
    assert.doesNotMatch(
      VS_OPENAI_AGENTS,
      /Manual, local CLI, and API-backed runtimes/,
      'vs-openai-agents-sdk comparison page must not hide the shipped adapter surface behind stale shorthand',
    );
  });
});
