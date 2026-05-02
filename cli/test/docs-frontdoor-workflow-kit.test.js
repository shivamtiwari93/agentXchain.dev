import { strict as assert } from 'node:assert';
import { describe, it } from 'vitest';
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
 * The core structural markers that workflow-kit validation enforces.
 * These are the contract from governed-templates.js and must appear
 * in the quickstart so operators know what the proof checks.
 * ----------------------------------------------------------------*/
const STRUCTURAL_MARKERS = ['Approved:', '## Phases', '## Purpose', '## Interface', '## Acceptance Tests', '| Req # |', '## Verdict:'];

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

    it('documents generate planning as the scaffold recovery path', () => {
      assert.ok(
        ROOT_README.includes('agentxchain generate planning'),
        'root README must document `agentxchain generate planning` as the planning-artifact recovery path'
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

    it('documents generate planning in the legacy utility surface', () => {
      assert.ok(
        CLI_README.includes('generate planning'),
        'cli README must mention `generate planning` so planning-artifact recovery is discoverable'
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

    it('documents generate planning as the recovery path for deleted scaffold files', () => {
      assert.ok(
        QUICKSTART.includes('agentxchain generate planning'),
        'quickstart must document `generate planning` as the way to restore scaffold-owned planning files'
      );
    });

    it('documents the structural markers', () => {
      for (const marker of STRUCTURAL_MARKERS) {
        assert.ok(
          QUICKSTART.includes(marker),
          `quickstart must document structural marker: ${marker}`
        );
      }
    });

    it('distinguishes scaffold proof from gate readiness', () => {
      assert.ok(
        QUICKSTART.includes('Approved: YES')
          && QUICKSTART.includes('## Verdict: PENDING')
          && QUICKSTART.includes('passing `Status` values'),
        'quickstart must explain that template validate proves scaffold integrity, while governed gates require Approved: YES, a passing acceptance matrix, and an affirmative verdict'
      );
    });

    it('documents implementation notes as a planning artifact', () => {
      assert.ok(
        QUICKSTART.includes('IMPLEMENTATION_NOTES.md'),
        'quickstart must mention IMPLEMENTATION_NOTES.md in planning artifacts'
      );
    });

    it('documents implementation gate requirements', () => {
      assert.ok(
        QUICKSTART.includes('## Changes') && QUICKSTART.includes('## Verification'),
        'quickstart must document that implementation gate requires ## Changes and ## Verification sections'
      );
    });

    it('documents RELEASE_NOTES.md as a planning artifact', () => {
      assert.ok(
        QUICKSTART.includes('RELEASE_NOTES.md'),
        'quickstart must mention RELEASE_NOTES.md in planning artifacts'
      );
    });

    it('documents release notes gate requirements', () => {
      assert.ok(
        QUICKSTART.includes('## User Impact') && QUICKSTART.includes('## Verification Summary'),
        'quickstart must document that release notes gate requires ## User Impact and ## Verification Summary sections'
      );
    });
  });
});
