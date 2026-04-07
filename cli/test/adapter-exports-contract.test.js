import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI_ROOT = join(__dirname, '..');
const REPO_ROOT = join(CLI_ROOT, '..');

const PKG = JSON.parse(readFileSync(join(CLI_ROOT, 'package.json'), 'utf8'));
const ADAPTER_INTERFACE_SRC = readFileSync(
  join(CLI_ROOT, 'src', 'lib', 'adapter-interface.js'),
  'utf8',
);
const RUNNER_DOC = readFileSync(
  join(REPO_ROOT, 'website-v2', 'docs', 'runner-interface.mdx'),
  'utf8',
);
const BUILD_DOC = readFileSync(
  join(REPO_ROOT, 'website-v2', 'docs', 'build-your-own-runner.mdx'),
  'utf8',
);
const ADAPTERS_DOC = readFileSync(
  join(REPO_ROOT, 'website-v2', 'docs', 'adapters.mdx'),
  'utf8',
);
const STARTER_README = readFileSync(
  join(REPO_ROOT, 'examples', 'external-runner-starter', 'README.md'),
  'utf8',
);
const SPEC = readFileSync(
  join(REPO_ROOT, '.planning', 'ADAPTER_INTERFACE_SPEC.md'),
  'utf8',
);

describe('Adapter package exports contract', () => {
  it('AT-ADAPTER-IFACE-001: package.json declares adapter-interface export', () => {
    assert.ok(PKG.exports, 'package.json must have exports');
    assert.equal(
      PKG.exports['./adapter-interface'],
      './src/lib/adapter-interface.js',
      'package.json must export ./adapter-interface to src/lib/adapter-interface.js',
    );
  });

  it('AT-ADAPTER-IFACE-002: adapter-interface.js exports the declared public surface', () => {
    for (const symbol of [
      'ADAPTER_INTERFACE_VERSION',
      'printManualDispatchInstructions',
      'waitForStagedResult',
      'readStagedResult',
      'dispatchLocalCli',
      'saveDispatchLogs',
      'resolvePromptTransport',
      'dispatchApiProxy',
      'dispatchMcp',
      'DEFAULT_MCP_TOOL_NAME',
      'DEFAULT_MCP_TRANSPORT',
      'resolveMcpToolName',
      'resolveMcpTransport',
      'describeMcpRuntimeTarget',
    ]) {
      assert.ok(
        ADAPTER_INTERFACE_SRC.includes(symbol),
        `adapter-interface.js must export ${symbol}`,
      );
    }

    for (const nonExport of [
      'buildAnthropicRequest',
      'buildOpenAiRequest',
      'classifyError',
      'extractTurnResultFromMcpToolResult',
    ]) {
      assert.ok(
        !ADAPTER_INTERFACE_SRC.includes(nonExport),
        `adapter-interface.js must not export ${nonExport}`,
      );
    }
  });

  it('AT-ADAPTER-IFACE-004: public docs use the package export boundary', () => {
    for (const doc of [RUNNER_DOC, BUILD_DOC, ADAPTERS_DOC, STARTER_README, SPEC]) {
      assert.match(doc, /agentxchain\/adapter-interface/);
    }

    assert.ok(
      !/from ['"]cli\/src\/lib\/adapters\//.test(ADAPTERS_DOC),
      'adapter docs must not present deep source-path imports as the public import boundary',
    );
  });
});
