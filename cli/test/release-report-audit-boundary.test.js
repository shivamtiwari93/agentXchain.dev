import { strict as assert } from 'node:assert';
import { describe, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..', '..');

const read = (rel) => readFileSync(join(REPO_ROOT, rel), 'utf8');

const RELEASE_231 = read('website-v2/docs/releases/v2-31-0.mdx');
const RELEASE_241 = read('website-v2/docs/releases/v2-41-0.mdx');
const RELEASE_277 = read('website-v2/docs/releases/v2-77-0.mdx');
const SPEC = read('.planning/REPORT_AUDIT_RELEASE_HISTORY_SPEC.md');

describe('release history keeps report/audit boundary truthful', () => {
  it('AT-REL-RA-001: v2.31.0 keeps workflow-kit report history but notes later audit boundary', () => {
    assert.match(RELEASE_231, /artifact-backed/i);
    assert.match(RELEASE_231, /Later releases added `agentxchain audit` as the live workspace audit surface/i);
    assert.match(RELEASE_231, /`report` remained the verified-export path/i);
    assert.match(SPEC, /AT-REL-RA-001/);
  });

  it('AT-REL-RA-002: v2.41.0 keeps original IDE flow history but marks audit as the later live path', () => {
    assert.match(RELEASE_241, /That was the real IDE contract in `v2\.41\.0`/i);
    assert.match(RELEASE_241, /later releases switched the live workspace path to `agentxchain audit --format json`/i);
    assert.match(RELEASE_241, /`report` remained the artifact-backed surface/i);
    assert.match(SPEC, /AT-REL-RA-002/);
  });

  it('AT-REL-RA-003: v2.77.0 remains the explicit transition point to audit', () => {
    assert.match(RELEASE_277, /First-class live audit surface/i);
    assert.match(RELEASE_277, /Replaces the old `export` \+ `report` double-hop pattern in the VS Code extension/i);
    assert.match(RELEASE_277, /IDE now calls `audit --format json` as a single subprocess/i);
    assert.match(SPEC, /AT-REL-RA-003/);
  });
});
