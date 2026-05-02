import { strict as assert } from 'node:assert';
import { describe, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..', '..');

const read = (rel) => readFileSync(join(REPO_ROOT, rel), 'utf8');
const readJSON = (rel) => JSON.parse(read(rel));

const SPEC_PATH = '.planning/PROTOCOL_V8_BOUNDARY_SPEC.md';
const SPEC = read(SPEC_PATH);
const PROTOCOL_REFERENCE = read('website-v2/docs/protocol-reference.mdx');
const IMPLEMENTOR_GUIDE = read('website-v2/docs/protocol-implementor-guide.mdx');
const ROOT_PROTOCOL = read('PROTOCOL-v7.md');
const CAPABILITIES = readJSON('.agentxchain-conformance/capabilities.json');

describe('Protocol v8 boundary spec', () => {
  it('ships the durable planning spec', () => {
    assert.ok(existsSync(join(REPO_ROOT, SPEC_PATH)), 'PROTOCOL_V8_BOUNDARY_SPEC.md must exist');
    for (const heading of ['## Purpose', '## Interface', '## Behavior', '## Error Cases', '## Acceptance Tests']) {
      assert.match(SPEC, new RegExp(heading.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    }
  });
});

describe('Protocol v8 boundary docs', () => {
  it('freezes mission/dashboard/report surfaces as outside protocol-v7 requirements', () => {
    for (const term of [
      '.agentxchain/missions/',
      'mission hierarchy',
      'mission plans',
      'dashboard APIs',
      'export, report, and release operator surfaces',
    ]) {
      assert.ok(PROTOCOL_REFERENCE.includes(term), `protocol reference must mention ${term}`);
    }
    assert.match(PROTOCOL_REFERENCE, /non-reference runner can truthfully claim protocol-v7 conformance without implementing those features/i);
  });

  it('tells implementors they do not owe reference-runner workflow kit features for v7', () => {
    for (const term of [
      '.agentxchain/missions/',
      'dashboard APIs',
      'export, report, and release operator surfaces',
      'future protocol-v8 cut needs promoted conformance or a new normative artifact/state contract',
    ]) {
      assert.ok(IMPLEMENTOR_GUIDE.includes(term), `implementor guide must mention ${term}`);
    }
    assert.match(IMPLEMENTOR_GUIDE, /can still claim protocol `v7` without implementing these reference-runner workflow surfaces/i);
  });

  it('keeps the root protocol reference explicit about what would justify v8', () => {
    for (const term of [
      '.agentxchain/missions/',
      'export, report, and release operator surfaces',
      'future v8 requires promoted conformance coverage or a new normative artifact/state contract',
    ]) {
      assert.ok(ROOT_PROTOCOL.includes(term), `PROTOCOL-v7.md must mention ${term}`);
    }
  });
});

describe('Protocol v8 boundary capabilities contract', () => {
  it('keeps the current protocol version at v7', () => {
    assert.equal(CAPABILITIES.protocol_version, 'v7');
  });

  it('does not silently claim non-fixture workflow surfaces', () => {
    for (const surface of ['mission', 'missions', 'dashboard', 'report', 'export', 'release']) {
      assert.equal(
        Object.prototype.hasOwnProperty.call(CAPABILITIES.surfaces || {}, surface),
        false,
        `capabilities.json must not claim "${surface}" as a conformance surface`
      );
    }
  });
});
