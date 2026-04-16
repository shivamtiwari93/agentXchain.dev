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
const PENDING_GATE_SPEC = read('.planning/COORDINATOR_CLI_PENDING_GATE_PRESENTATION_SPEC.md');
const HANDOFF_SPEC = read('.planning/COORDINATOR_CLI_HANDOFF_OUTPUT_SPEC.md');

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
    assert.ok(subcommands.length >= 6, `expected at least 6 multi subcommands, got ${subcommands.length}`);
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

  it('documents blocked-state recovery via multi resume', () => {
    assert.match(multiSection, /multi resume/i);
    assert.match(multiSection, /blocked coordinator/i);
    assert.match(multiSection, /multi approve-gate|multi step/i);
    assert.match(multiSection, /ordered recovery guidance/i);
    assert.match(multiSection, /next_actions/);
  });

  it('AT-DOCS-MULTI-007: documents canonical pending-gate detail rows for multi status', () => {
    assert.match(multiSection, /Pending Gate/i);
    assert.match(multiSection, /Current Phase/i);
    assert.match(multiSection, /Target Phase/i);
    assert.match(multiSection, /Required Repos/i);
    assert.match(multiSection, /Approval State/i);
  });

  it('AT-DOCS-MULTI-008: documents multi step pending-gate fail-closed behavior', () => {
    assert.match(multiSection, /multi step/i);
    assert.match(multiSection, /fails closed/i);
    assert.match(multiSection, /Pending Gate/i);
    assert.match(multiSection, /next actions/i);
  });

  it('AT-DOCS-MULTI-009: documents multi resume pending-gate handoff output', () => {
    assert.match(multiSection, /multi resume/i);
    assert.match(multiSection, /restores coordinator status to `active` or `paused`/i);
    assert.match(multiSection, /same canonical `Pending Gate` detail rows/i);
    assert.match(multiSection, /ordered next actions/i);
  });

  it('AT-DOCS-MULTI-010: documents successful multi approve-gate handoff output', () => {
    assert.match(multiSection, /Successful `multi approve-gate`/);
    assert.match(multiSection, /phase-transition approvals print the success message plus ordered next actions/i);
    assert.match(multiSection, /run-completion approvals stop at the completion message/i);
    assert.match(multiSection, /`next_action`\/`next_actions`/i);
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

  it('pending-gate presentation spec exists and references multi status', () => {
    assert.ok(PENDING_GATE_SPEC.length > 0, 'pending-gate spec file must exist');
    assert.match(PENDING_GATE_SPEC, /multi status/i);
  });

  it('handoff output spec exists and references multi approve-gate', () => {
    assert.ok(HANDOFF_SPEC.length > 0, 'handoff spec file must exist');
    assert.match(HANDOFF_SPEC, /multi approve-gate/i);
    assert.match(HANDOFF_SPEC, /multi resume/i);
  });
});

describe('CLI multi implementation alignment', () => {
  it('implementation exports all five command handlers', () => {
    assert.match(MULTI_IMPL, /export async function multiInitCommand/);
    assert.match(MULTI_IMPL, /export async function multiStatusCommand/);
    assert.match(MULTI_IMPL, /export async function multiStepCommand/);
    assert.match(MULTI_IMPL, /export async function multiResumeCommand/);
    assert.match(MULTI_IMPL, /export async function multiApproveGateCommand/);
    assert.match(MULTI_IMPL, /export async function multiResyncCommand/);
  });

  it('resync implementation supports dry-run', () => {
    assert.match(MULTI_IMPL, /dryRun|dry.run/i);
  });
});
