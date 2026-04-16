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
const EXPORT_LIB = read('cli/src/lib/export.js');
const EXPORT_CMD = read('cli/src/commands/export.js');
const SPEC = read('.planning/RUN_EXPORT_SPEC.md');
const COORD_SPEC = read('.planning/COORDINATOR_EXPORT_SPEC.md');
const BOUNDARY_SPEC = read('.planning/CLI_EXPORT_AUDIT_REPORT_BOUNDARY_SPEC.md');

describe('Export CLI docs contract', () => {
  it('registers export with --format and --output in the CLI entrypoint', () => {
    const exportBlock = CLI_ENTRY.match(/\.command\('export'\)[\s\S]*?\.action\(exportCommand\)/);
    assert.ok(exportBlock, 'export command block found');
    assert.match(exportBlock[0], /--format <format>/);
    assert.match(exportBlock[0], /--output <path>/);
  });

  it('documents export in the command map and dedicated section', () => {
    assert.match(CLI_DOCS, /\| `export` \| Inspection \|/);
    assert.match(CLI_DOCS, /### `export`/);
  });

  it('documents the flag contract truthfully', () => {
    assert.match(CLI_DOCS, /agentxchain export \[--format json\] \[--output <path>\]/);
    assert.match(CLI_DOCS, /stdout by default/i);
  });

  it('documents the raw-byte integrity contract truthfully', () => {
    assert.match(CLI_DOCS, /content_base64/);
    assert.match(CLI_DOCS, /verify export/i);
  });

  it('AT-CLI-EAR-001/AT-CLI-EAR-004: keeps export distinct from audit and report', () => {
    assert.match(CLI_DOCS, /portable artifact for handoff, restore, or offline review/i);
    assert.match(CLI_DOCS, /use `export` and keep the artifact/i);
    assert.match(CLI_DOCS, /If you need an immediate governance audit for the current repo, use `audit`/i);
    assert.match(CLI_DOCS, /If you already have an artifact and want the derived summary, `report` verifies that existing artifact first/i);
    assert.match(BOUNDARY_SPEC, /AT-CLI-EAR-001/);
    assert.match(BOUNDARY_SPEC, /AT-CLI-EAR-004/);
  });

  it('AT-CLI-EAR-002/AT-CLI-EAR-003/AT-CLI-EAR-005: keeps audit and report source boundaries explicit', () => {
    assert.match(CLI_DOCS, /`audit` is the fast path for the repo you are standing in right now/i);
    assert.match(CLI_DOCS, /builds the same governed or coordinator export artifact that `agentxchain export` would build/i);
    assert.match(CLI_DOCS, /verifies that freshly built artifact/i);
    assert.match(CLI_DOCS, /`audit` does not accept `--input`/i);
    assert.match(CLI_DOCS, /`report` is for a previously created export artifact passed via `--input <path>` or stdin/i);
    assert.match(CLI_DOCS, /`report` turns a verified export artifact into a concise governance summary/i);
    assert.match(CLI_DOCS, /It verifies the export artifact first and fails closed on invalid artifacts/i);
    assert.match(BOUNDARY_SPEC, /AT-CLI-EAR-002/);
    assert.match(BOUNDARY_SPEC, /AT-CLI-EAR-003/);
    assert.match(BOUNDARY_SPEC, /AT-CLI-EAR-005/);
  });

  it('documents both governed project and coordinator workspace export', () => {
    assert.match(CLI_DOCS, /governed project/i);
    assert.match(CLI_DOCS, /coordinator workspace/i);
    assert.match(CLI_DOCS, /agentxchain-multi\.json/);
    assert.match(CLI_DOCS, /recursively embeds/i);
    assert.match(CLI_DOCS, /child repo/i);
  });

  it('documents detection priority: governed project over coordinator workspace', () => {
    assert.match(CLI_DOCS, /governed projects take detection priority/i);
  });

  it('documents child repo failure semantics', () => {
    assert.match(CLI_DOCS, /child repo export fails.*coordinator export still succeeds/i);
  });
});

describe('Export library contract', () => {
  it('exports both buildRunExport and buildCoordinatorExport', () => {
    assert.match(EXPORT_LIB, /export function buildRunExport/);
    assert.match(EXPORT_LIB, /export function buildCoordinatorExport/);
  });

  it('stores original file bytes for self-verification', () => {
    assert.match(EXPORT_LIB, /content_base64/);
  });

  it('coordinator export includes the correct file roots', () => {
    assert.match(EXPORT_LIB, /agentxchain-multi\.json/);
    assert.match(EXPORT_LIB, /\.agentxchain\/multirepo\/state\.json/);
    assert.match(EXPORT_LIB, /\.agentxchain\/multirepo\/history\.jsonl/);
    assert.match(EXPORT_LIB, /\.agentxchain\/multirepo\/barriers\.json/);
    assert.match(EXPORT_LIB, /\.agentxchain\/multirepo\/decision-ledger\.jsonl/);
    assert.match(EXPORT_LIB, /\.agentxchain\/multirepo\/barrier-ledger\.jsonl/);
  });

  it('coordinator export kind is agentxchain_coordinator_export', () => {
    assert.match(EXPORT_LIB, /agentxchain_coordinator_export/);
  });

  it('coordinator export calls buildRunExport for each child repo', () => {
    assert.match(EXPORT_LIB, /buildRunExport\(resolvedPath\)/);
  });
});

describe('Export command detection', () => {
  it('detects governed projects by agentxchain.json', () => {
    assert.match(EXPORT_CMD, /agentxchain\.json/);
  });

  it('detects coordinator workspaces by COORDINATOR_CONFIG_FILE', () => {
    assert.match(EXPORT_CMD, /COORDINATOR_CONFIG_FILE/);
  });

  it('governed detection takes priority over coordinator', () => {
    // The detectExportKind function checks agentxchain.json first
    const funcBody = EXPORT_CMD.match(/function detectExportKind[\s\S]*?return null/);
    assert.ok(funcBody, 'detectExportKind function found');
    const governedIndex = funcBody[0].indexOf('agentxchain.json');
    const coordIndex = funcBody[0].indexOf('COORDINATOR_CONFIG_FILE');
    assert.ok(governedIndex < coordIndex, 'governed check must come before coordinator check');
  });
});

describe('Run export spec alignment', () => {
  it('ships a standalone run export spec with acceptance tests', () => {
    assert.match(SPEC, /\*\*Status:\*\*\s+shipped/i);
    assert.match(SPEC, /AT-EXPORT-001/);
    assert.match(SPEC, /AT-EXPORT-008/);
    assert.match(SPEC, /content_base64/);
  });

  it('AT-EXPORT-009: scopes the planning spec to governed export and defers coordinator export to its own spec', () => {
    assert.match(SPEC, /governed-project half of the first-party `agentxchain export` audit surface/i);
    assert.match(SPEC, /COORDINATOR_EXPORT_SPEC\.md/);
    assert.match(SPEC, /1\.\s+`agentxchain\.json` present -> governed run export/i);
    assert.match(SPEC, /2\.\s+`agentxchain-multi\.json` present -> coordinator workspace export/i);
    assert.match(SPEC, /AT-EXPORT-009/);
    assert.equal(
      /Pure coordinator-workspace export from `agentxchain-multi\.json` roots with no governed `agentxchain\.json`/.test(SPEC),
      false,
      'run export spec must not claim shipped coordinator export is out of scope',
    );
  });
});

describe('Coordinator export spec alignment', () => {
  it('ships a standalone coordinator export spec with acceptance tests', () => {
    assert.match(COORD_SPEC, /AT-COORD-EXPORT-001/);
    assert.match(COORD_SPEC, /AT-COORD-EXPORT-008/);
    assert.match(COORD_SPEC, /agentxchain_coordinator_export/);
    assert.match(COORD_SPEC, /recursively/i);
    assert.match(COORD_SPEC, /content_base64/);
  });
});
