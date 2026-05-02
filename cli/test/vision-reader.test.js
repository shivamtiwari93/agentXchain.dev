import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { randomUUID } from 'crypto';

import {
  parseVisionDocument,
  deriveVisionCandidates,
  deriveRoadmapCandidates,
  detectRoadmapExhaustedVisionOpen,
  isGoalAddressed,
  loadCompletedIntentSignals,
  resolveVisionPath,
  captureVisionHeadingsSnapshot,
  computeVisionContentSha,
  buildSourceManifest,
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

function writeIntent(dir, { intentId, status, charter }) {
  const intentsDir = join(dir, '.agentxchain', 'intake', 'intents');
  mkdirSync(intentsDir, { recursive: true });
  const intent = {
    schema_version: '1.0',
    intent_id: intentId,
    event_id: `evt_${Date.now()}_0001`,
    status,
    priority: 'p2',
    template: 'generic',
    charter,
    acceptance_contract: [charter],
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    history: [],
  };
  writeFileSync(join(intentsDir, `${intentId}.json`), JSON.stringify(intent, null, 2));
  return intentId;
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

  describe('deriveRoadmapCandidates', () => {
    it('BUG-76: derives first unchecked milestone item from ROADMAP before vision idle', () => {
      mkdirSync(join(tmpDir, '.planning'), { recursive: true });
      writeFileSync(join(tmpDir, '.planning', 'ROADMAP.md'), `# Roadmap

### M27: Complete Thing
- [x] Already done

### M28: Static Sensitivity Class Inference from Manifest Evidence (~0.5 day)
- [ ] Add classifySensitivity(capability) pure deterministic function
- [ ] Capabilities with zero static evidence MUST receive unknown

### M29: Static Auth Requirements Inference from Manifest Evidence (~0.5 day)
- [ ] Add classifyAuthRequirements(capability)
`);

      const result = deriveRoadmapCandidates(tmpDir);
      assert.equal(result.ok, true);
      assert.equal(result.candidates.length, 3);
      assert.equal(result.candidates[0].source, 'roadmap_open_work');
      assert.match(result.candidates[0].section, /^M28:/);
      assert.equal(result.candidates[0].goal, 'Add classifySensitivity(capability) pure deterministic function');
      assert.equal(result.candidates[0].line, 7);
    });

    it('BUG-76: skips unchecked roadmap items that already have active intent coverage', () => {
      mkdirSync(join(tmpDir, '.planning'), { recursive: true });
      writeFileSync(join(tmpDir, '.planning', 'ROADMAP.md'), `# Roadmap

### M28: Static Sensitivity Class Inference
- [ ] Add classifySensitivity capability deterministic function
`);
      writeIntent(tmpDir, {
        intentId: 'intent_existing_m28',
        status: 'approved',
        charter: 'M28 Static Sensitivity Class Inference add classifySensitivity capability deterministic function',
      });

      const result = deriveRoadmapCandidates(tmpDir);
      assert.equal(result.ok, true);
      assert.equal(result.candidates.length, 0);
    });

    it('M1 tracking: skips unchecked roadmap items with tracking annotations', () => {
      mkdirSync(join(tmpDir, '.planning'), { recursive: true });
      writeFileSync(join(tmpDir, '.planning', 'ROADMAP.md'), `# Roadmap

### M1: Self-Governance Hardening
- [ ] Acceptance: zero ghost turns across 10 consecutive self-governed runs <!-- tracking: 3/10 zero-ghost runs (8485b804, 984f0f8c, 936b36c7) as of 2026-05-02 -->

### M2: Vision Derivation
- [ ] Fix idle-expansion heuristic
`);

      const result = deriveRoadmapCandidates(tmpDir);
      assert.equal(result.ok, true);
      assert.equal(result.candidates.length, 1);
      assert.match(result.candidates[0].section, /^M2:/);
      assert.equal(result.candidates[0].goal, 'Fix idle-expansion heuristic');
    });

    it('M1 tracking: keeps normal HTML comments actionable', () => {
      mkdirSync(join(tmpDir, '.planning'), { recursive: true });
      writeFileSync(join(tmpDir, '.planning', 'ROADMAP.md'), `# Roadmap

### M2: Vision Derivation
- [ ] Preserve this open item <!-- owner: dev -->
- [ ] Preserve tracking word without annotation
`);

      const result = deriveRoadmapCandidates(tmpDir);
      assert.equal(result.ok, true);
      assert.equal(result.candidates.length, 2);
      assert.equal(result.candidates[0].goal, 'Preserve this open item <!-- owner: dev -->');
      assert.equal(result.candidates[1].goal, 'Preserve tracking word without annotation');
    });
  });

  describe('detectRoadmapExhaustedVisionOpen', () => {
    it('M2 idle expansion: treats tracking-annotated roadmap items as exhausted', () => {
      const visionPath = writeVision(tmpDir, `# Vision

## Connector Ecosystem

- add additional local IDE connectors
`);
      mkdirSync(join(tmpDir, '.planning'), { recursive: true });
      writeFileSync(join(tmpDir, '.planning', 'ROADMAP.md'), `# Roadmap

### M1: Self-Governance Hardening
- [x] Add startup heartbeat protocol
- [ ] Acceptance: zero ghost turns across 10 consecutive self-governed runs <!-- tracking: 3/10 zero-ghost runs as of 2026-05-02 -->
`);

      const roadmap = deriveRoadmapCandidates(tmpDir);
      assert.equal(roadmap.ok, true);
      assert.equal(roadmap.candidates.length, 0);

      const result = detectRoadmapExhaustedVisionOpen(tmpDir, visionPath);
      assert.equal(result.open, true);
      assert.equal(result.reason, 'roadmap_exhausted_vision_open');
      assert.deepEqual(result.unplanned_sections, ['Connector Ecosystem']);
      assert.equal(result.total_milestones, 1);
      assert.match(result.latest_milestone, /^M1:/);
    });

    it('M2 idle expansion: keeps actionable unchecked roadmap items open', () => {
      const visionPath = writeVision(tmpDir, `# Vision

## Connector Ecosystem

- add additional local IDE connectors
`);
      mkdirSync(join(tmpDir, '.planning'), { recursive: true });
      writeFileSync(join(tmpDir, '.planning', 'ROADMAP.md'), `# Roadmap

### M2: Vision Derivation
- [ ] Fix idle-expansion heuristic
`);

      const result = detectRoadmapExhaustedVisionOpen(tmpDir, visionPath);
      assert.equal(result.open, false);
      assert.equal(result.reason, 'has_unchecked');
    });

    it('M2 idle expansion: reports vision fully mapped when exhausted roadmap covers all vision sections', () => {
      const visionPath = writeVision(tmpDir, `# Vision

## Vision Derivation

- derive bounded roadmap increments
`);
      mkdirSync(join(tmpDir, '.planning'), { recursive: true });
      writeFileSync(join(tmpDir, '.planning', 'ROADMAP.md'), `# Roadmap

### M2: Vision Derivation
- [x] Fix idle-expansion heuristic
`);

      const result = detectRoadmapExhaustedVisionOpen(tmpDir, visionPath);
      assert.equal(result.open, false);
      assert.equal(result.reason, 'vision_fully_mapped');
      assert.deepEqual(result.mapped_sections, ['Vision Derivation']);
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

  // -------------------------------------------------------------------
  // BUG-60 Slice 3: Vision snapshot helpers
  // -------------------------------------------------------------------

  describe('captureVisionHeadingsSnapshot', () => {
    it('extracts H1, H2, H3 headings from VISION.md content', () => {
      const content = `# Top Level
## Section A
Some text
### Sub Section
## Section B
`;
      const headings = captureVisionHeadingsSnapshot(content);
      assert.deepEqual(headings, ['Top Level', 'Section A', 'Sub Section', 'Section B']);
    });

    it('deduplicates identical heading text', () => {
      const content = `## Goals
- thing
## Goals
- other thing
`;
      const headings = captureVisionHeadingsSnapshot(content);
      assert.equal(headings.length, 1);
      assert.equal(headings[0], 'Goals');
    });

    it('returns empty array for null/empty content', () => {
      assert.deepEqual(captureVisionHeadingsSnapshot(null), []);
      assert.deepEqual(captureVisionHeadingsSnapshot(''), []);
    });

    it('ignores H4+ headings', () => {
      const content = `## Valid
#### Too Deep
##### Way Too Deep
`;
      const headings = captureVisionHeadingsSnapshot(content);
      assert.deepEqual(headings, ['Valid']);
    });
  });

  describe('computeVisionContentSha', () => {
    it('returns consistent SHA-256 hex for same content', () => {
      const content = '## My Vision\n- build the thing\n';
      const sha1 = computeVisionContentSha(content);
      const sha2 = computeVisionContentSha(content);
      assert.equal(sha1, sha2);
      assert.equal(sha1.length, 64); // SHA-256 hex is 64 chars
    });

    it('returns different hash for different content', () => {
      const sha1 = computeVisionContentSha('## A\n');
      const sha2 = computeVisionContentSha('## B\n');
      assert.notEqual(sha1, sha2);
    });

    it('returns empty string for null/empty', () => {
      assert.equal(computeVisionContentSha(null), '');
      assert.equal(computeVisionContentSha(''), '');
    });
  });

  describe('buildSourceManifest', () => {
    it('builds manifest with present VISION.md', () => {
      writeVision(tmpDir, '## Goals\n- build it\n');
      const result = buildSourceManifest(tmpDir, ['.planning/VISION.md']);
      assert.ok(result.ok);
      assert.equal(result.entries.length, 1);
      assert.equal(result.entries[0].present, true);
      assert.ok(result.entries[0].byte_count > 0);
      assert.ok(result.entries[0].headings.includes('Goals'));
      assert.ok(result.entries[0].preview.includes('Goals'));
    });

    it('fails hard when VISION.md is missing', () => {
      const result = buildSourceManifest(tmpDir, ['.planning/VISION.md']);
      assert.ok(!result.ok);
      assert.ok(result.error.includes('VISION.md not found'));
    });

    it('warns but continues when non-VISION source is missing', () => {
      writeVision(tmpDir, '## Goals\n- build it\n');
      const result = buildSourceManifest(tmpDir, [
        '.planning/VISION.md',
        '.planning/ROADMAP.md',
      ]);
      assert.ok(result.ok);
      assert.equal(result.entries.length, 2);
      assert.equal(result.entries[1].present, false);
      assert.equal(result.entries[1].warning, 'file_not_found');
    });

    it('warns when non-VISION source has no headings', () => {
      writeVision(tmpDir, '## Goals\n- build it\n');
      const roadmapDir = join(tmpDir, '.planning');
      mkdirSync(roadmapDir, { recursive: true });
      writeFileSync(join(roadmapDir, 'ROADMAP.md'), 'Just plain text, no headings.\n', 'utf8');
      const result = buildSourceManifest(tmpDir, [
        '.planning/VISION.md',
        '.planning/ROADMAP.md',
      ]);
      assert.ok(result.ok);
      assert.equal(result.entries[1].warning, 'no_headings');
    });

    it('returns error for empty sources array', () => {
      const result = buildSourceManifest(tmpDir, []);
      assert.ok(!result.ok);
      assert.ok(result.error.includes('No sources configured'));
    });

    it('truncates large previews with head+tail marker', () => {
      writeVision(tmpDir, '## Goals\n- build it\n');
      const roadmapDir = join(tmpDir, '.planning');
      mkdirSync(roadmapDir, { recursive: true });
      // Write a large ROADMAP that exceeds 16KB per-source cap
      const bigContent = '## Roadmap\n' + 'x'.repeat(20000) + '\n';
      writeFileSync(join(roadmapDir, 'ROADMAP.md'), bigContent, 'utf8');
      const result = buildSourceManifest(tmpDir, [
        '.planning/VISION.md',
        '.planning/ROADMAP.md',
      ]);
      assert.ok(result.ok);
      assert.ok(result.entries[1].preview.includes('[...truncated middle...]'));
      // Preview should be bounded
      const previewBytes = Buffer.byteLength(result.entries[1].preview, 'utf8');
      assert.ok(previewBytes <= 16 * 1024 + 100); // small tolerance for marker
    });

    it('extracts H1 and H2 headings only in manifest', () => {
      writeVision(tmpDir, '## Goals\n- build it\n');
      const roadmapDir = join(tmpDir, '.planning');
      mkdirSync(roadmapDir, { recursive: true });
      writeFileSync(join(roadmapDir, 'ROADMAP.md'), '# Phase 1\n## Milestone A\n### Detail\n', 'utf8');
      const result = buildSourceManifest(tmpDir, [
        '.planning/VISION.md',
        '.planning/ROADMAP.md',
      ]);
      assert.ok(result.ok);
      // ROADMAP manifest headings should include H1 and H2 only
      assert.ok(result.entries[1].headings.includes('Phase 1'));
      assert.ok(result.entries[1].headings.includes('Milestone A'));
      assert.ok(!result.entries[1].headings.includes('Detail'));
    });
  });
});
