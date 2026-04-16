import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..', '..');

const read = (rel) => readFileSync(join(REPO_ROOT, rel), 'utf8');

const RELEASE_PAGE = read('website-v2/docs/releases/v2-103-0.mdx');
const SPEC = read('.planning/VERIFY_EXPORT_RELEASE_HISTORY_SPEC.md');

describe('verify export release-notes truth boundary', () => {
  it('AT-REL-VE-001: v2.103.0 keeps export authoring, verifier enforcement, and report rendering distinct', () => {
    assert.match(RELEASE_PAGE, /Export summaries now preserve repo-decision authority metadata/i);
    assert.match(RELEASE_PAGE, /`verify export` now rejects drift or tampering in that metadata/i);
    assert.match(RELEASE_PAGE, /governance reports render the preserved values from verifier-clean artifacts/i);
    assert.match(SPEC, /AT-REL-VE-001/);
  });
});
