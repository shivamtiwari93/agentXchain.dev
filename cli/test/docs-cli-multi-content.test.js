import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..', '..');

const read = (rel) => readFileSync(join(REPO_ROOT, rel), 'utf8');

const CLI_DOCS = read('website-v2/docs/cli.mdx');
const CLI_ENTRY = read('cli/bin/agentxchain.js');
const MULTI_IMPL = read('cli/src/commands/multi.js');
const SPEC = read('.planning/CLI_DOCS_MULTI_CONTRACT_SPEC.md');

function extractSection(startHeading) {
  const start = CLI_DOCS.indexOf(startHeading);
  assert.ok(start >= 0, `missing docs heading: ${startHeading}`);
  const rest = CLI_DOCS.slice(start + startHeading.length);
  const next = rest.search(/\n##\s+/);
  return next >= 0 ? CLI_DOCS.slice(start, start + startHeading.length + next) : CLI_DOCS.slice(start);
}

function extractMultiSubcommands() {
  const start = CLI_ENTRY.indexOf("const multiCmd = program");
  assert.ok(start >= 0, 'missing multi command block in agentxchain.js');
  // Find the end of the multi registration block — next top-level const or program.parse()
  const afterStart = CLI_ENTRY.slice(start);
  const endMatch = afterStart.search(/\n(?:const \w+ = program|program\.parse\(\))/);
  const block = endMatch >= 0 ? afterStart.slice(0, endMatch) : afterStart;
  return [...block.matchAll(/\.command\('([a-z-]+)'\)/g)]
    .map(([, name]) => name)
    .filter((name) => name !== 'multi');
}

function extractMultiFlags() {
  const start = CLI_ENTRY.indexOf("const multiCmd = program");
  assert.ok(start >= 0, 'missing multi command block');
  const afterStart = CLI_ENTRY.slice(start);
  const endMatch = afterStart.search(/\n(?:const \w+ = program|program\.parse\(\))/);
  const block = endMatch >= 0 ? afterStart.slice(0, endMatch) : afterStart;

  const result = {};
  let currentCmd = null;
  for (const line of block.split('\n')) {
    const cmdMatch = line.match(/\.command\('([a-z-]+)'\)/);
    if (cmdMatch) currentCmd = cmdMatch[1] === 'multi' ? null : cmdMatch[1];
    if (currentCmd) {
      const optMatch = line.match(/\.option\('([^']+)'/);
      if (optMatch) {
        const flags = optMatch[1].split(',').map((f) => f.trim().split(' ')[0]);
        for (const flag of flags) {
          if (!result[currentCmd]) result[currentCmd] = [];
          result[currentCmd].push(flag);
        }
      }
    }
  }
  return result;
}

describe('CLI multi docs contract', () => {
  const multiSection = extractSection('## Multi-repo coordinator');
  const subcommands = extractMultiSubcommands();
  const flagsByCmd = extractMultiFlags();

  it('adds multi to the CLI command map', () => {
    assert.match(CLI_DOCS, /\| `multi` \| Multi-repo coordination \|/);
  });

  it('has a dedicated multi section with ### heading', () => {
    assert.match(multiSection, /### `multi`/);
  });

  it('documents every shipped multi subcommand from the CLI registration', () => {
    assert.ok(subcommands.length >= 5, `expected at least 5 multi subcommands, got ${subcommands.length}`);
    for (const sub of subcommands) {
      assert.match(
        multiSection,
        new RegExp(`\\| \`${sub}\` \\|`),
        `cli.mdx multi section must document subcommand ${sub}`
      );
    }
  });

  it('documents every shipped flag for each multi subcommand (bidirectional)', () => {
    for (const [cmd, flags] of Object.entries(flagsByCmd)) {
      for (const flag of flags) {
        const longFlag = flag.startsWith('--') ? flag : null;
        if (longFlag) {
          assert.match(
            multiSection,
            new RegExp(longFlag.replace(/-/g, '[-‑]')),
            `cli.mdx multi section must document flag ${longFlag} for ${cmd}`
          );
        }
      }
    }
  });

  it('documents resync --dry-run flag explicitly', () => {
    assert.match(multiSection, /--dry-run/);
  });

  it('references agentxchain-multi.json as the config prerequisite', () => {
    assert.match(multiSection, /agentxchain-multi\.json/);
  });

  it('links to the dashboard Initiative and Cross-Repo views', () => {
    assert.match(multiSection, /Initiative/);
    assert.match(multiSection, /Cross-Repo/);
  });

  it('links to the dedicated multi-repo docs page and documents step auto-resync', () => {
    assert.match(multiSection, /\/docs\/multi-repo/);
    assert.match(multiSection, /auto-resync|resyncs from repo authority/i);
  });
});

describe('CLI multi spec alignment', () => {
  it('spec exists and references the shipped state', () => {
    assert.ok(SPEC.length > 0, 'spec file must exist');
    assert.match(SPEC, /multi/i);
  });
});

describe('CLI multi implementation alignment', () => {
  it('implementation exports all five command handlers', () => {
    assert.match(MULTI_IMPL, /export async function multiInitCommand/);
    assert.match(MULTI_IMPL, /export async function multiStatusCommand/);
    assert.match(MULTI_IMPL, /export async function multiStepCommand/);
    assert.match(MULTI_IMPL, /export async function multiApproveGateCommand/);
    assert.match(MULTI_IMPL, /export async function multiResyncCommand/);
  });

  it('resync implementation supports dry-run', () => {
    assert.match(MULTI_IMPL, /dryRun|dry.run/i);
  });
});
