import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..', '..');

const read = (rel) => readFileSync(join(REPO_ROOT, rel), 'utf8');

const DOCS_PAGE = read('website-v2/docs/remote-verification.mdx');
const SIDEBARS = read('website-v2/sidebars.ts');
const IMPLEMENTOR_GUIDE = read('website-v2/docs/protocol-implementor-guide.mdx');
const CONFORMANCE_ENGINE = read('cli/src/lib/protocol-conformance.js');
const CLI_ENTRY = read('cli/bin/agentxchain.js');

describe('Remote verification docs — page exists and is wired', () => {
  it('source file exists', () => {
    assert.ok(
      existsSync(join(REPO_ROOT, 'website-v2/docs/remote-verification.mdx')),
      'remote-verification.mdx must exist'
    );
  });

  it('is in the sidebar under Protocol', () => {
    assert.match(SIDEBARS, /'remote-verification'/, 'sidebar must include remote-verification');
  });

  it('implementor guide cross-links to remote-verification', () => {
    assert.match(
      IMPLEMENTOR_GUIDE,
      /remote-verification/,
      'implementor guide must link to remote-verification'
    );
  });
});

describe('Remote verification docs — HTTP contract alignment with implementation', () => {
  it('documents the two fixed endpoint paths from the engine', () => {
    assert.match(CONFORMANCE_ENGINE, /\/conform\/capabilities/,
      'engine must use /conform/capabilities');
    assert.match(CONFORMANCE_ENGINE, /\/conform\/execute/,
      'engine must use /conform/execute');

    assert.match(DOCS_PAGE, /\/conform\/capabilities/,
      'docs must document /conform/capabilities');
    assert.match(DOCS_PAGE, /\/conform\/execute/,
      'docs must document /conform/execute');
  });

  it('documents the http-fixture-v1 protocol requirement', () => {
    assert.match(CONFORMANCE_ENGINE, /http-fixture-v1/);
    assert.match(DOCS_PAGE, /http-fixture-v1/);
  });

  it('documents the Connection: close header from the transport', () => {
    assert.match(CONFORMANCE_ENGINE, /connection.*close/i,
      'engine sets Connection: close');
    assert.match(DOCS_PAGE, /Connection: close/,
      'docs must document Connection: close');
  });

  it('documents the Content-Type: application/json header for fixture execution', () => {
    assert.match(CONFORMANCE_ENGINE, /content-type.*application\/json/,
      'engine sets Content-Type on POST');
    assert.match(DOCS_PAGE, /Content-Type: application\/json/,
      'docs must document Content-Type');
  });

  it('documents the Content-Length header auto-computation', () => {
    assert.match(CONFORMANCE_ENGINE, /content-length/,
      'engine computes Content-Length');
    assert.match(DOCS_PAGE, /Content-Length/,
      'docs must document Content-Length');
  });

  it('documents Bearer token auth from buildRemoteHeaders', () => {
    assert.match(CONFORMANCE_ENGINE, /Authorization.*Bearer/,
      'engine sends Bearer auth');
    assert.match(DOCS_PAGE, /Authorization: Bearer/,
      'docs must document Bearer auth header format');
  });

  it('documents all four valid response statuses', () => {
    const statusMatch = CONFORMANCE_ENGINE.match(
      /VALID_RESPONSE_STATUSES\s*=\s*new Set\(\[([^\]]+)\]/
    );
    assert.ok(statusMatch, 'must find VALID_RESPONSE_STATUSES in engine');

    const statuses = statusMatch[1].match(/'(\w+)'/g).map(s => s.replace(/'/g, ''));
    for (const status of statuses) {
      assert.match(DOCS_PAGE, new RegExp(`\`${status}\``),
        `docs must document status '${status}'`);
    }
  });

  it('documents non-200 error handling behavior', () => {
    assert.match(DOCS_PAGE, /Non-200 HTTP status/,
      'docs must explain non-200 handling');
    assert.match(DOCS_PAGE, /HTTP \{status\}/,
      'docs must show the error message format');
  });

  it('documents timeout behavior from the engine', () => {
    assert.match(CONFORMANCE_ENGINE, /timeout after/,
      'engine emits timeout errors');
    assert.match(DOCS_PAGE, /timeout after/,
      'docs must document timeout error messages');
  });

  it('documents the default timeout from the CLI registration', () => {
    const timeoutDefault = CLI_ENTRY.match(/--timeout.*?'(\d+)'/);
    assert.ok(timeoutDefault, 'CLI must register --timeout with a default');
    assert.match(DOCS_PAGE, new RegExp(timeoutDefault[1]),
      `docs must mention the default timeout ${timeoutDefault[1]}`);
  });

  it('documents malformed response handling', () => {
    assert.match(CONFORMANCE_ENGINE, /Malformed response/,
      'engine handles malformed JSON');
    assert.match(DOCS_PAGE, /Malformed response/,
      'docs must document malformed response error');
  });

  it('documents missing status field handling', () => {
    assert.match(CONFORMANCE_ENGINE, /Adapter response missing valid/,
      'engine rejects missing status');
    assert.match(DOCS_PAGE, /Adapter response missing valid/,
      'docs must document missing status error');
  });
});

describe('Remote verification docs — fixture corpus ownership', () => {
  it('explicitly states the verifier owns the fixture corpus', () => {
    assert.match(DOCS_PAGE, /verifier.*owns.*fixture.*corpus/i,
      'docs must state corpus ownership');
  });

  it('states servers do not need to host fixtures', () => {
    assert.match(DOCS_PAGE, /never need to host fixtures/i,
      'docs must state servers do not host fixtures');
  });
});

describe('Remote verification docs — report shape', () => {
  it('documents target_root as null for remote', () => {
    assert.match(DOCS_PAGE, /target_root.*null/,
      'docs must state target_root is null in remote mode');
  });

  it('documents remote field contains the base URL', () => {
    assert.match(DOCS_PAGE, /remote.*base URL/i,
      'docs must state remote field contains the normalized base URL');
  });
});
