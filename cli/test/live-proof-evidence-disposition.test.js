import { strict as assert } from 'node:assert';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'vitest';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..');

function read(relativePath) {
  return readFileSync(join(ROOT, relativePath), 'utf8');
}

const SPEC_PATH = '.planning/LIVE_PROOF_EVIDENCE_DISPOSITION_SPEC.md';
const SPEC = read(SPEC_PATH);
const EVIDENCE_DIR = join(ROOT, 'examples', 'live-governed-proof', 'evidence');
const evidenceFiles = readdirSync(EVIDENCE_DIR).filter((name) => name.endsWith('.latest.json')).sort();

const EVIDENCE_BACKED = {
  'run-multi-repo-proof.mjs': {
    artifact: 'multi-repo-proof.latest.json',
    docs: ['website-v2/docs/multi-repo.mdx'],
  },
  'run-continuous-3run-proof.mjs': {
    artifact: 'continuous-3run-proof.latest.json',
    docs: [
      'website-v2/docs/examples/live-governed-proof.mdx',
      'website-v2/docs/examples/live-continuous-3run-proof.mdx',
    ],
  },
  'run-checkpoint-handoff-proof.mjs': {
    artifact: 'checkpoint-handoff-proof.latest.json',
    docs: [
      'website-v2/docs/examples/live-governed-proof.mdx',
      'website-v2/docs/examples/checkpoint-handoff-proof.mdx',
    ],
  },
  'run-continuous-mixed-proof.mjs': {
    artifact: 'continuous-mixed-proof.latest.json',
    docs: [
      'website-v2/docs/examples/live-governed-proof.mdx',
      'website-v2/docs/lights-out-operation.mdx',
    ],
  },
};

const SCRIPT_ONLY = [
  'run-live-turn.mjs',
  'run-multi-provider-proof.mjs',
  'run-proposed-authority-proof.mjs',
  'run-escalation-recovery-proof.mjs',
  'run-mcp-real-model-proof.mjs',
  'run-coordinator-event-aggregation-proof.mjs',
  'run-coordinator-event-surfaces-proof.mjs',
  'run-coordinator-event-websocket-proof.mjs',
  'run-coordinator-replay-roundtrip-proof.mjs',
];

describe('live proof evidence disposition contract', () => {
  it('AT-LPED-001: spec records all 13 harnesses and exactly 4 evidence-backed entries', () => {
    assert.ok(existsSync(join(ROOT, SPEC_PATH)), 'disposition spec must exist');
    const allHarnesses = [...Object.keys(EVIDENCE_BACKED), ...SCRIPT_ONLY];
    for (const harness of allHarnesses) {
      assert.match(SPEC, new RegExp(harness.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    }
    assert.equal(Object.keys(EVIDENCE_BACKED).length, 4, 'expected exactly 4 evidence-backed harnesses');
    assert.equal(SCRIPT_ONLY.length, 9, 'expected exactly 9 script-only harnesses');
  });

  it('AT-LPED-002: evidence directory contains exactly the approved 4 latest artifacts', () => {
    const expected = Object.values(EVIDENCE_BACKED).map((entry) => entry.artifact).sort();
    assert.deepEqual(evidenceFiles, expected);
  });

  it('AT-LPED-003: each evidence-backed harness has a public docs surface naming its checked-in artifact', () => {
    for (const [scriptName, entry] of Object.entries(EVIDENCE_BACKED)) {
      assert.match(SPEC, new RegExp(scriptName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
      assert.match(SPEC, new RegExp(entry.artifact.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
      for (const docPath of entry.docs) {
        const doc = read(docPath);
        assert.match(
          doc,
          new RegExp(entry.artifact.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
          `${docPath} must reference ${entry.artifact}`,
        );
      }
    }
  });

  it('AT-LPED-004: script-only harnesses do not have checked-in latest-artifact peers', () => {
    for (const scriptName of SCRIPT_ONLY) {
      const artifactName = scriptName.replace(/^run-/, '').replace(/\.mjs$/, '.latest.json');
      assert.ok(
        !evidenceFiles.includes(artifactName),
        `${scriptName} should remain script-only, but found ${artifactName} in evidence/`,
      );
    }
  });
});
