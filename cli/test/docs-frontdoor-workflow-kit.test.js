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

const ROOT_README = read('README.md');
const CLI_README = read('cli/README.md');
const QUICKSTART = read('website-v2/docs/quickstart.mdx');

/* ------------------------------------------------------------------
 * The four structural markers that workflow-kit validation enforces.
 * These are the contract from governed-templates.js and must appear
 * in the quickstart so operators know what the proof checks.
 * ----------------------------------------------------------------*/
const STRUCTURAL_MARKERS = ['Approved:', '## Phases', '| Req # |', '## Verdict:'];

describe('Front-door docs — workflow-kit coverage', () => {
  describe('README.md (root)', () => {
    it('mentions template validate in canonical commands', () => {
      assert.ok(
        ROOT_README.includes('template validate'),
        'root README must mention "template validate" in the canonical commands section'
      );
    });

    it('mentions workflow_kit JSON block', () => {
      assert.ok(
        ROOT_README.includes('workflow_kit') || ROOT_README.includes('workflow-kit'),
        'root README must reference workflow-kit or workflow_kit'
      );
    });
  });

  describe('cli/README.md', () => {
    it('lists template validate in the governed command table', () => {
      assert.ok(
        CLI_README.includes('template validate'),
        'cli README must list "template validate" in the command table'
      );
    });

    it('mentions workflow_kit JSON block', () => {
      assert.ok(
        CLI_README.includes('workflow_kit') || CLI_README.includes('workflow-kit'),
        'cli README must reference workflow-kit or workflow_kit'
      );
    });
  });

  describe('quickstart.mdx', () => {
    it('mentions template validate as a validation step', () => {
      assert.ok(
        QUICKSTART.includes('template validate'),
        'quickstart must mention "template validate" as a scaffold proof step'
      );
    });

    it('mentions workflow-kit or workflow_kit', () => {
      assert.ok(
        QUICKSTART.includes('workflow_kit') || QUICKSTART.includes('workflow-kit'),
        'quickstart must reference the workflow-kit proof layer'
      );
    });

    it('documents the four structural markers', () => {
      for (const marker of STRUCTURAL_MARKERS) {
        assert.ok(
          QUICKSTART.includes(marker),
          `quickstart must document structural marker: ${marker}`
        );
      }
    });
  });
});
