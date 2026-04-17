import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { randomUUID } from 'crypto';

import {
  parseVisionDocument,
  deriveVisionCandidates,
  isGoalAddressed,
  loadCompletedIntentSignals,
  resolveVisionPath,
} from '../src/lib/vision-reader.js';

function createTmpProject() {
  const dir = join(tmpdir(), `axc-vision-test-${randomUUID().slice(0, 8)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function writeVision(dir, content) {
  const planDir = join(dir, '.planning');
  mkdirSync(planDir, { recursive: true });
  writeFileSync(join(planDir, 'VISION.md'), content, 'utf8');
  return join(planDir, 'VISION.md');
}

function writeCompletedIntent(dir, charter) {
  const intentsDir = join(dir, '.agentxchain', 'intake', 'intents');
  mkdirSync(intentsDir, { recursive: true });
  const id = `intent_${Date.now()}_${randomUUID().slice(0, 4)}`;
  const intent = {
    schema_version: '1.0',
    intent_id: id,
    event_id: `evt_${Date.now()}_0001`,
    status: 'completed',
    charter,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    history: [],
  };
  writeFileSync(join(intentsDir, `${id}.json`), JSON.stringify(intent, null, 2));
  return id;
}

describe('Vision Reader', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = createTmpProject();
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('parseVisionDocument', () => {
    it('AT-VCONT-PARSE-001: extracts H2 sections with bullet goals', () => {
      const doc = `# My Vision

## Core Thesis

- explicit roles
- explicit turn structure
- explicit decision history

## Product Shape

- protocol layer
- runner layer
`;
      const result = parseVisionDocument(doc);
      assert.equal(result.sections.length, 2);
      assert.equal(result.sections[0].heading, 'Core Thesis');
      assert.equal(result.sections[0].goals.length, 3);
      assert.ok(result.sections[0].goals.includes('explicit roles'));
      assert.equal(result.sections[1].heading, 'Product Shape');
      assert.equal(result.sections[1].goals.length, 2);
    });

    it('AT-VCONT-PARSE-002: handles empty or null content', () => {
      assert.deepEqual(parseVisionDocument('').sections, []);
      assert.deepEqual(parseVisionDocument(null).sections, []);
    });

    it('AT-VCONT-PARSE-003: extracts H3 sections as well', () => {
      const doc = `## Main

### Sub Section

- governed delivery
- multi-agent coordination
`;
      const result = parseVisionDocument(doc);
      assert.ok(result.sections.length >= 1);
      const sub = result.sections.find(s => s.heading === 'Sub Section');
      assert.ok(sub);
      assert.ok(sub.goals.includes('governed delivery'));
    });
  });

  describe('isGoalAddressed', () => {
    it('AT-VCONT-MATCH-001: matches when >= 60% keyword overlap', () => {
      const goal = 'explicit decision history tracking';
      const signals = ['implemented decision history and explicit tracking surface'];
      assert.ok(isGoalAddressed(goal, signals));
    });

    it('AT-VCONT-MATCH-002: no match when low keyword overlap', () => {
      const goal = 'explicit decision history tracking';
      const signals = ['added a new button to the homepage'];
      assert.ok(!isGoalAddressed(goal, signals));
    });
  });

  describe('deriveVisionCandidates', () => {
    it('AT-VCONT-001-PARTIAL: derives candidates from unaddressed vision goals', () => {
      const visionPath = writeVision(tmpDir, `## Core Thesis

- explicit roles and mandates
- explicit turn structure
- explicit decision history
`);
      const result = deriveVisionCandidates(tmpDir, visionPath);
      assert.ok(result.ok);
      assert.ok(result.candidates.length >= 2);
      assert.equal(result.candidates[0].section, 'Core Thesis');
    });

    it('AT-VCONT-002: returns idle when all goals are addressed', () => {
      const visionPath = writeVision(tmpDir, `## Core Thesis

- explicit roles and mandates
`);
      writeCompletedIntent(tmpDir, 'explicit roles and mandates implementation');
      const result = deriveVisionCandidates(tmpDir, visionPath);
      assert.ok(result.ok);
      assert.equal(result.candidates.length, 0);
    });

    it('AT-VCONT-003: fails with clear error when VISION.md missing', () => {
      const result = deriveVisionCandidates(tmpDir, join(tmpDir, '.planning', 'VISION.md'));
      assert.ok(!result.ok);
      assert.ok(result.error.includes('VISION.md not found'));
      assert.ok(result.error.includes('Create a .planning/VISION.md'));
    });

    it('AT-VCONT-EMPTY: fails with clear error on empty VISION.md', () => {
      const visionPath = writeVision(tmpDir, '# Just a title\n\nNo sections here.\n');
      const result = deriveVisionCandidates(tmpDir, visionPath);
      assert.ok(!result.ok);
      assert.ok(result.error.includes('no extractable sections'));
    });
  });

  describe('resolveVisionPath', () => {
    it('AT-VCONT-008: resolves relative path against project root', () => {
      const resolved = resolveVisionPath('/my/project', '.planning/VISION.md');
      assert.equal(resolved, '/my/project/.planning/VISION.md');
    });

    it('AT-VCONT-008b: preserves absolute path', () => {
      const resolved = resolveVisionPath('/my/project', '/other/project/.planning/VISION.md');
      assert.equal(resolved, '/other/project/.planning/VISION.md');
    });
  });

  describe('loadCompletedIntentSignals', () => {
    it('returns empty array when no intents dir exists', () => {
      assert.deepEqual(loadCompletedIntentSignals(tmpDir), []);
    });

    it('returns lowercased charters of completed intents', () => {
      writeCompletedIntent(tmpDir, 'Build the Protocol Layer');
      const signals = loadCompletedIntentSignals(tmpDir);
      assert.equal(signals.length, 1);
      assert.equal(signals[0], 'build the protocol layer');
    });
  });
});
