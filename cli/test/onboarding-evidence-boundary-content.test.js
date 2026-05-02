import { strict as assert } from 'node:assert';
import { describe, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..', '..');

const read = (rel) => readFileSync(join(REPO_ROOT, rel), 'utf8');

const QUICKSTART = read('website-v2/docs/quickstart.mdx');
const GETTING_STARTED = read('website-v2/docs/getting-started.mdx');
const FIVE_MINUTE = read('website-v2/docs/five-minute-tutorial.mdx');
const TUTORIAL = read('website-v2/docs/tutorial.mdx');
const SPEC = read('.planning/ONBOARDING_EVIDENCE_BOUNDARY_SPEC.md');

describe('Onboarding evidence boundary docs contract', () => {
  it('AT-ONBOARD-EVID-001/002: all onboarding pages distinguish live audit from artifact-based report', () => {
    for (const [label, doc] of [
      ['quickstart', QUICKSTART],
      ['getting-started', GETTING_STARTED],
      ['five-minute-tutorial', FIVE_MINUTE],
      ['tutorial', TUTORIAL],
    ]) {
      assert.match(doc, /agentxchain audit --format markdown/, `${label} must show the audit command`);
      assert.match(doc, /agentxchain export --format json > governance-export\.json/, `${label} must show export before report`);
      assert.match(doc, /agentxchain report --input governance-export\.json --format markdown/, `${label} must show report with explicit input`);
      assert.match(
        doc,
        /audit.*live current repo|audit.*live current repo\/workspace/i,
        `${label} must describe audit as live state`,
      );
      assert.match(
        doc,
        /report --input.*existing export artifact|report --input.*already have an export artifact|report.*reads an existing export artifact/i,
        `${label} must describe report as artifact-based`,
      );
    }
    assert.match(SPEC, /AT-ONBOARD-EVID-001/);
    assert.match(SPEC, /AT-ONBOARD-EVID-002/);
  });

  it('AT-ONBOARD-EVID-003: all onboarding pages preserve the partial coordinator artifact boundary', () => {
    for (const [label, doc] of [
      ['quickstart', QUICKSTART],
      ['getting-started', GETTING_STARTED],
      ['five-minute-tutorial', FIVE_MINUTE],
      ['tutorial', TUTORIAL],
    ]) {
      assert.match(doc, /repo_ok_count.*repo_error_count/, `${label} must mention export-health counts`);
      assert.match(
        doc,
        /failed repo row plus error|failed repo row and error|failed repos keep the repo row plus error/i,
        `${label} must mention failed repo row + error`,
      );
      assert.match(
        doc,
        /do not fabricate failed-child drill-down|failed-child drill-down stays absent/i,
        `${label} must reject fabricated failed-child drill-down`,
      );
    }
    assert.match(SPEC, /AT-ONBOARD-EVID-003/);
  });

  it('AT-ONBOARD-EVID-004: tutorial verify step shows audit, export, and report together', () => {
    const verifySection = TUTORIAL.match(/## Step 9 — Verify[\s\S]*?(?=\n## )/);
    assert.ok(verifySection, 'tutorial verify section must exist');
    assert.match(verifySection[0], /agentxchain status/);
    assert.match(verifySection[0], /agentxchain audit --format markdown/);
    assert.match(verifySection[0], /agentxchain export --format json > governance-export\.json/);
    assert.match(verifySection[0], /agentxchain report --input governance-export\.json --format markdown/);
    assert.match(SPEC, /AT-ONBOARD-EVID-004/);
  });
});
