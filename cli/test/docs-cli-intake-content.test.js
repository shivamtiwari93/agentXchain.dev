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
const INTAKE_ENGINE = read('cli/src/lib/intake.js');
const SPEC = read('.planning/CLI_DOCS_INTAKE_CONTRACT_SPEC.md');

function extractSection(startHeading) {
  const start = CLI_DOCS.indexOf(startHeading);
  assert.ok(start >= 0, `missing docs heading: ${startHeading}`);
  const rest = CLI_DOCS.slice(start + startHeading.length);
  const next = rest.search(/\n##\s+/);
  return next >= 0 ? CLI_DOCS.slice(start, start + startHeading.length + next) : CLI_DOCS.slice(start);
}

function extractArray(source, constName) {
  const match = source.match(new RegExp(`const ${constName} = \\[([^\\]]+)\\]`));
  assert.ok(match, `missing ${constName} definition`);
  return [...match[1].matchAll(/'([^']+)'/g)].map(([, value]) => value);
}

function extractIntakeSubcommands() {
  const start = CLI_ENTRY.indexOf("const intakeCmd = program");
  // End at the next top-level command group or program.parse(), whichever comes first
  const nextCmd = CLI_ENTRY.indexOf('\nconst ', start + 1);
  const parseEnd = CLI_ENTRY.indexOf('program.parse();');
  const end = nextCmd >= 0 && nextCmd < parseEnd ? nextCmd : parseEnd;
  assert.ok(start >= 0 && end > start, 'missing intake command block');
  const block = CLI_ENTRY.slice(start, end);
  return [...block.matchAll(/\.command\('([a-z-]+)'\)/g)]
    .map(([, name]) => name)
    .filter((name) => name !== 'intake');
}

describe('CLI intake docs contract', () => {
  const intakeSection = extractSection('## Continuous delivery intake');
  const intakeSubcommands = extractIntakeSubcommands();
  const validSources = extractArray(INTAKE_ENGINE, 'VALID_SOURCES');
  const scanSources = extractArray(INTAKE_ENGINE, 'SCAN_SOURCES');

  it('adds intake to the CLI command map and links to the dedicated intake page', () => {
    assert.match(CLI_DOCS, /\| `intake` \| Continuous delivery \|/);
    assert.match(intakeSection, /### `intake`/);
    assert.match(intakeSection, /\/docs\/continuous-delivery-intake/);
  });

  it('documents every shipped intake subcommand from the CLI registration', () => {
    assert.equal(intakeSubcommands.length, 9, 'expected nine shipped intake subcommands');
    for (const subcommand of intakeSubcommands) {
      assert.match(
        intakeSection,
        new RegExp(`\\| \`${subcommand}\` \\|`),
        `cli.mdx intake section must document subcommand ${subcommand}`
      );
    }
  });

  it('documents record sources from VALID_SOURCES', () => {
    assert.deepEqual(validSources, ['manual', 'ci_failure', 'git_ref_change', 'schedule', 'vision_scan']);
    for (const source of validSources) {
      assert.match(
        intakeSection,
        new RegExp(`\`${source}\``),
        `cli.mdx intake section must mention record source ${source}`
      );
    }
  });

  it('documents scan sources from SCAN_SOURCES and excludes manual', () => {
    assert.deepEqual(scanSources, ['ci_failure', 'git_ref_change', 'schedule']);
    for (const source of scanSources) {
      assert.match(
        intakeSection,
        new RegExp(`\`${source}\``),
        `cli.mdx intake section must mention scan source ${source}`
      );
    }
    assert.match(intakeSection, /`manual` is intentionally excluded/i);
  });

  it('documents the governance boundary between approval, planning, start, and resolve', () => {
    assert.match(intakeSection, /approve.*does not start a governed run/i);
    assert.match(intakeSection, /plan.*does not start execution/i);
    assert.match(intakeSection, /start.*planned -> executing/i);
    assert.match(intakeSection, /handoff.*coordinator workstream/i);
    assert.match(intakeSection, /target_workstream/);
    assert.match(intakeSection, /super_run_id/);
    assert.match(intakeSection, /target_run/);
    assert.match(intakeSection, /target_turn/);
    assert.match(intakeSection, /resolve.*blocked.*, `completed`, and `failed` outcomes/i);
    assert.match(intakeSection, /`active` and `paused` remain `no_change`/i);
  });

  it('documents the repo-local workspace boundary', () => {
    assert.match(intakeSection, /repo-local/i);
    assert.match(intakeSection, /agentxchain\.json/);
    assert.match(intakeSection, /agentxchain-multi\.json/);
    assert.match(intakeSection, /use `multi` there/i);
  });
});

describe('CLI intake docs spec alignment', () => {
  it('ships a standalone intake CLI docs contract spec', () => {
    assert.match(SPEC, /Status:\s+\*\*Shipped\*\*/);
    assert.match(SPEC, /Discrepancies Found/);
    assert.match(SPEC, /AT-CLI-INTAKE-001/);
    assert.match(SPEC, /AT-CLI-INTAKE-007/);
  });
});
