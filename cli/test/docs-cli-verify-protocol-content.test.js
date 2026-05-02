import { strict as assert } from 'node:assert';
import { describe, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..', '..');

const read = (rel) => readFileSync(join(REPO_ROOT, rel), 'utf8');

const CLI_DOCS = read('website-v2/docs/cli.mdx');
const CLI_ENTRY = read('cli/bin/agentxchain.js');
const CONFORMANCE_ENGINE = read('cli/src/lib/protocol-conformance.js');
const SPEC = read('.planning/CLI_DOCS_VERIFY_PROTOCOL_CONTRACT_SPEC.md');

describe('verify protocol docs — flag alignment', () => {
  const VERIFY_FLAGS = ['--tier', '--surface', '--target', '--remote', '--token', '--timeout', '--format'];

  it('every documented flag exists in the CLI registration', () => {
    for (const flag of VERIFY_FLAGS) {
      assert.match(
        CLI_ENTRY,
        new RegExp(`\\.option\\('${flag.replace('--', '--')}\\s`),
        `CLI registration missing documented flag ${flag}`
      );
    }
  });

  it('every CLI-registered verify protocol flag is documented', () => {
    // Extract flags from the verify protocol command block
    const verifyBlock = CLI_ENTRY.slice(
      CLI_ENTRY.indexOf("verifyCmd"),
      CLI_ENTRY.indexOf(".action(verifyProtocolCommand)")
    );
    const flagMatches = [...verifyBlock.matchAll(/\.option\('(--[\w-]+)/g)];
    for (const [, flag] of flagMatches) {
      assert.ok(
        CLI_DOCS.includes(flag),
        `CLI flag ${flag} registered but not documented in cli.mdx`
      );
    }
  });

  it('no ghost flags in docs that are not in CLI registration', () => {
    // Extract flags from the docs verify protocol section
    const verifyDocStart = CLI_DOCS.indexOf('### `conformance check`');
    const verifyDocEnd = CLI_DOCS.indexOf('## Export verification');
    const verifyDocSection = CLI_DOCS.slice(verifyDocStart, verifyDocEnd);

    // Every --flag in the table should be in the CLI entry
    const docFlags = [...verifyDocSection.matchAll(/\| `(--[\w-]+)/g)];
    for (const [, flag] of docFlags) {
      assert.match(
        CLI_ENTRY,
        new RegExp(`'${flag.replace('--', '--')}\\s`),
        `Docs flag ${flag} not found in CLI registration — ghost flag`
      );
    }
  });
});

describe('verify protocol docs — behavioral semantics', () => {
  it('documents not_implemented adapter response', () => {
    assert.match(CLI_DOCS, /not_implemented/,
      'Docs must mention not_implemented adapter response');
  });

  it('documents that not_implemented does not cause failure', () => {
    assert.match(CLI_DOCS, /non-failing|not.?fail/i,
      'Docs must explain that not_implemented fixtures do not cause overall failure');
  });

  it('documents progressive conformance concept', () => {
    assert.match(CLI_DOCS, /progressive/i,
      'Docs must explain progressive conformance');
  });

  it('documents surface enforcement when capabilities.surfaces exists', () => {
    assert.match(CLI_DOCS, /capabilities\.json.*surfaces|surfaces.*map/i,
      'Docs must mention surface enforcement tied to capabilities.json surfaces map');
  });

  it('documents cumulative tier semantics', () => {
    assert.match(CLI_DOCS, /up to and including/i,
      'Docs must explain that --tier runs all fixtures up to and including the specified tier');
  });

  it('documents all four valid adapter response statuses', () => {
    const statuses = ['pass', 'fail', 'error', 'not_implemented'];
    for (const status of statuses) {
      assert.match(CLI_DOCS, new RegExp(`\`${status}\``),
        `Docs must mention adapter status \`${status}\``);
    }
  });

  it('documents the remote HTTP adapter path', () => {
    assert.match(CLI_DOCS, /http-fixture-v1/,
      'Docs must mention http-fixture-v1 for remote verification');
    assert.match(CLI_DOCS, /--remote/,
      'Docs must mention the remote verification mode');
  });

  it('documents conformance check as the preferred entrypoint while preserving verify protocol compatibility', () => {
    assert.match(CLI_DOCS, /conformance check/,
      'Docs must mention conformance check');
    assert.match(CLI_DOCS, /verify protocol.*compatibility alias|compatibility alias.*verify protocol/i,
      'Docs must preserve verify protocol as a compatibility alias');
  });
});

describe('verify protocol docs — implementation alignment', () => {
  it('documented adapter statuses match VALID_RESPONSE_STATUSES in engine', () => {
    // The engine defines: const VALID_RESPONSE_STATUSES = new Set(['pass', 'fail', 'error', 'not_implemented']);
    const statusMatch = CONFORMANCE_ENGINE.match(/VALID_RESPONSE_STATUSES\s*=\s*new Set\(\[([^\]]+)\]/);
    assert.ok(statusMatch, 'Could not find VALID_RESPONSE_STATUSES in protocol-conformance.js');

    const engineStatuses = statusMatch[1].match(/'(\w+)'/g).map(s => s.replace(/'/g, ''));
    for (const status of engineStatuses) {
      assert.match(CLI_DOCS, new RegExp(`\`${status}\``),
        `Engine status '${status}' not documented in cli.mdx`);
    }
  });

  it('engine cumulative tier filtering matches documented behavior', () => {
    assert.match(CONFORMANCE_ENGINE, /fixture\.tier\s*<=\s*requestedTier/,
      'Engine must filter by fixture.tier <= requestedTier (cumulative semantics)');
  });

  it('engine surface enforcement matches documented behavior', () => {
    assert.match(CONFORMANCE_ENGINE, /capabilities\.surfaces/,
      'Engine must reference capabilities.surfaces for enforcement');
    assert.match(CONFORMANCE_ENGINE, /is not claimed in capabilities\.json/,
      'Engine must throw for unclaimed surfaces');
  });

  it('engine supports remote HTTP fixtures', () => {
    assert.match(CONFORMANCE_ENGINE, /http-fixture-v1/,
      'Engine must validate http-fixture-v1 for remote verification');
    assert.match(CONFORMANCE_ENGINE, /executeRemoteFixture/,
      'Engine must implement remote fixture execution');
  });

  it('exit code mapping matches documented table', () => {
    // Engine: const exitCode = report.overall === 'pass' ? 0 : report.overall === 'fail' ? 1 : 2;
    assert.match(CONFORMANCE_ENGINE, /report\.overall === 'pass' \? 0/,
      'Exit code 0 must map to pass');
    assert.match(CONFORMANCE_ENGINE, /report\.overall === 'fail' \? 1/,
      'Exit code 1 must map to fail');
    // exit 2 is the fallback (error)
  });
});

describe('verify protocol spec alignment', () => {
  it('spec is marked as shipped', () => {
    assert.match(SPEC, /Status:\*\*\s*Shipped/i);
  });
});
