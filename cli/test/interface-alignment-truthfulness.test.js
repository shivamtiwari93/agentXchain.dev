import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, '..', '..');

function read(rel) {
  return readFileSync(join(repoRoot, rel), 'utf8');
}

describe('interface_alignment contract guard', () => {
  it('AT-IA-001: runtime uses declared decision_ids_by_repo instead of heuristic placeholder language', () => {
    const config = read('cli/src/lib/coordinator-config.js');
    const barriers = read('cli/src/lib/coordinator-barriers.js');

    assert.match(config, /decision_ids_by_repo/);
    assert.match(barriers, /alignment_decision_ids/);
    assert.doesNotMatch(barriers, /heuristic placeholder/i);
  });

  it('AT-IA-002: public docs describe explicit per-repo decision ids', () => {
    for (const rel of [
      'website-v2/docs/multi-repo.mdx',
      'website-v2/docs/protocol-reference.mdx',
      'website-v2/docs/protocol-implementor-guide.mdx',
    ]) {
      const content = read(rel);
      assert.match(content, /decision_ids_by_repo/);
      assert.match(content, /interface_alignment/);
    }
  });

  it('AT-IA-003: planning specs describe explicit decision ids', () => {
    for (const rel of [
      '.planning/INTERFACE_ALIGNMENT_CONTRACT_SPEC.md',
      '.planning/V2_2_PROTOCOL_CONFORMANCE_SPEC.md',
      '.planning/MULTI_REPO_ORCHESTRATION_SPEC.md',
    ]) {
      const content = read(rel);
      assert.match(content, /decision_ids_by_repo/);
      assert.match(content, /interface_alignment/);
    }
  });

  it('AT-IA-004: Tier 3 conformance now includes interface_alignment fixture coverage', () => {
    const fixtures = read('.agentxchain-conformance/fixtures/README.md');
    const fixture = read('.agentxchain-conformance/fixtures/3/coordinator/CR-008.json');

    assert.match(fixtures, /CR-008/);
    assert.match(fixtures, /interface_alignment/);
    assert.match(fixture, /interface_alignment/);
    assert.match(fixture, /decision_ids_by_repo/);
  });
});
