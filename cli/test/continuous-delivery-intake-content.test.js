import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..', '..');

const read = (rel) => readFileSync(join(REPO_ROOT, rel), 'utf8');

const DOC_PATH = 'website-v2/docs/continuous-delivery-intake.mdx';
const DOC = read(DOC_PATH);
const SIDEBARS = read('website-v2/sidebars.ts');
const DOCS_SURFACE_SPEC = read('.planning/DOCS_SURFACE_SPEC.md');
const DOC_SPEC = read('.planning/CONTINUOUS_DELIVERY_INTAKE_DOC_SPEC.md');
const V3_SCOPE = read('.planning/V3_SCOPE.md');

// Code-backed sources: read the implementation directly
const INTAKE_SRC = read('cli/src/lib/intake.js');
const TEMPLATES_SRC = read('cli/src/lib/governed-templates.js');
const AGENTXCHAIN_JS = read('cli/bin/agentxchain.js');

describe('Continuous delivery intake docs surface', () => {
  it('ships the Docusaurus page and planning spec', () => {
    assert.ok(existsSync(join(REPO_ROOT, DOC_PATH)), 'intake docs page must exist');
    assert.ok(
      existsSync(join(REPO_ROOT, '.planning/CONTINUOUS_DELIVERY_INTAKE_DOC_SPEC.md')),
      'intake docs spec must exist'
    );
  });

  it('adds the page under a Continuous Delivery docs section', () => {
    assert.match(SIDEBARS, /label:\s*'Continuous Delivery'/);
    assert.match(SIDEBARS, /'continuous-delivery-intake'/);
  });

  it('documents all eight shipped intake subcommands', () => {
    for (const cmd of [
      'intake record', 'intake triage', 'intake approve', 'intake plan',
      'intake start', 'intake resolve', 'intake scan', 'intake status',
    ]) {
      assert.ok(DOC.includes(cmd), `intake docs must mention ${cmd}`);
    }
  });

  it('documents artifact paths and key schema fields', () => {
    for (const term of [
      '.agentxchain/intake/',
      '.agentxchain/intake/events/',
      '.agentxchain/intake/intents/',
      '.agentxchain/intake/observations/',
      'loop-state.json',
      'dedup_key',
      'approved_by',
      'planning_artifacts',
      'target_run',
      'target_turn',
      'started_at',
    ]) {
      assert.ok(DOC.includes(term), `intake docs must mention ${term}`);
    }
  });

  it('documents the coordinator-workspace boundary and child-repo workflow', () => {
    for (const term of [
      'repo-local',
      'agentxchain.json',
      'agentxchain-multi.json',
      'child governed repo',
      'agentxchain multi step',
    ]) {
      assert.ok(DOC.includes(term), `intake docs must mention ${term}`);
    }
  });
});

describe('Intake docs state machine — code-backed verification', () => {
  // Extract VALID_TRANSITIONS from intake.js
  const transitionsMatch = INTAKE_SRC.match(/const VALID_TRANSITIONS = \{([\s\S]*?)\};/);
  assert.ok(transitionsMatch, 'VALID_TRANSITIONS must exist in intake.js');

  // Parse transitions from source
  const transitionBlock = transitionsMatch[1];
  const transitionPairs = [];
  for (const line of transitionBlock.split('\n')) {
    const match = line.match(/(\w+):\s*\[([^\]]+)\]/);
    if (match) {
      const from = match[1];
      const tos = match[2].match(/'(\w+)'/g).map(s => s.replace(/'/g, ''));
      for (const to of tos) {
        transitionPairs.push(`${from} -> ${to}`);
      }
    }
  }

  it('documents every shipped transition from VALID_TRANSITIONS', () => {
    for (const pair of transitionPairs) {
      assert.ok(DOC.includes(pair), `docs must include transition: ${pair}`);
    }
  });

  it('does not contain ghost transitions not in VALID_TRANSITIONS under "Implemented now"', () => {
    // Extract the "Implemented now" section
    const implMatch = DOC.match(/### Implemented now\s*```text([\s\S]*?)```/);
    assert.ok(implMatch, 'docs must have an "Implemented now" section with a code block');
    const implBlock = implMatch[1];
    const docTransitions = implBlock.match(/\w+ -> \w+/g) || [];
    for (const dt of docTransitions) {
      assert.ok(
        transitionPairs.includes(dt),
        `docs "Implemented now" contains ghost transition: ${dt}`
      );
    }
  });

  it('documents deferred states separately from shipped transitions', () => {
    assert.match(DOC, /Deferred beyond the shipped intake surface/);
    assert.match(DOC, /completed -> awaiting_release_approval/);
  });
});

describe('Intake docs sources — code-backed verification', () => {
  // Extract VALID_SOURCES
  const sourcesMatch = INTAKE_SRC.match(/const VALID_SOURCES = \[([^\]]+)\]/);
  assert.ok(sourcesMatch, 'VALID_SOURCES must exist in intake.js');
  const validSources = sourcesMatch[1].match(/'(\w+)'/g).map(s => s.replace(/'/g, ''));

  // Extract SCAN_SOURCES
  const scanMatch = INTAKE_SRC.match(/const SCAN_SOURCES = \[([^\]]+)\]/);
  assert.ok(scanMatch, 'SCAN_SOURCES must exist in intake.js');
  const scanSources = scanMatch[1].match(/'(\w+)'/g).map(s => s.replace(/'/g, ''));

  it('documents all VALID_SOURCES for intake record', () => {
    for (const source of validSources) {
      assert.ok(DOC.includes(source), `docs must mention source: ${source}`);
    }
  });

  it('documents SCAN_SOURCES for intake scan', () => {
    for (const source of scanSources) {
      assert.ok(DOC.includes(source), `docs must mention scan source: ${source}`);
    }
  });

  it('documents that manual is excluded from scan', () => {
    assert.match(DOC, /`manual` is excluded/);
  });
});

describe('Intake docs template IDs — code-backed verification', () => {
  const templateMatch = TEMPLATES_SRC.match(/VALID_GOVERNED_TEMPLATE_IDS = Object\.freeze\(\[([\s\S]*?)\]\)/);
  assert.ok(templateMatch, 'VALID_GOVERNED_TEMPLATE_IDS must exist in governed-templates.js');
  const templateIds = templateMatch[1].match(/'([^']+)'/g).map(s => s.replace(/'/g, ''));

  it('documents all governed template IDs', () => {
    for (const id of templateIds) {
      assert.ok(DOC.includes(id), `docs must mention template: ${id}`);
    }
  });
});

describe('Intake docs start behavior — code-backed verification', () => {
  it('documents idle bootstrap behavior', () => {
    assert.match(DOC, /[Ii]dle bootstrap/);
    assert.ok(
      DOC.includes('initializes a new governed run') || DOC.includes('initialize'),
      'docs must explain that intake start can bootstrap from idle'
    );
  });

  it('documents paused resume behavior', () => {
    assert.match(DOC, /[Pp]aused resume/);
    assert.ok(
      DOC.includes('reactivates the run') || DOC.includes('reactivate'),
      'docs must explain that intake start can resume a paused run'
    );
  });

  it('documents pending gate rejection distinctly from paused resume', () => {
    assert.ok(
      DOC.includes('pending_phase_transition') && DOC.includes('pending_run_completion'),
      'docs must mention both pending gate fields'
    );
  });

  it('does NOT claim paused is unconditionally non-resumable', () => {
    assert.doesNotMatch(
      DOC,
      /`paused` is an approval-held state, not a generic resumable idle state for intake/,
      'the old lie about paused being unconditionally non-resumable must be removed'
    );
  });
});

describe('Intake docs resolve outcome — code-backed verification', () => {
  it('documents run_blocked_recovery field', () => {
    assert.ok(DOC.includes('run_blocked_recovery'), 'docs must mention run_blocked_recovery');
  });

  it('documents run_failed_at field', () => {
    assert.ok(DOC.includes('run_failed_at'), 'docs must mention run_failed_at');
  });

  it('documents run_completed_at and run_final_turn fields', () => {
    assert.ok(DOC.includes('run_completed_at'), 'docs must mention run_completed_at');
    assert.ok(DOC.includes('run_final_turn'), 'docs must mention run_final_turn');
  });

  it('documents all resolve outcome states from implementation', () => {
    // The implementation handles: blocked, failed, completed, active, paused, idle
    for (const state of ['blocked', 'failed', 'completed', 'active', 'paused', 'idle']) {
      assert.ok(
        DOC.includes(`\`${state}\``),
        `resolve outcome mapping must reference governed state: ${state}`
      );
    }
  });

  it('documents no-change semantics for active and paused', () => {
    assert.ok(DOC.includes('no_change'), 'docs must mention no_change');
  });
});

describe('Intake docs scan contract — code-backed verification', () => {
  it('documents snapshot item validation contract', () => {
    assert.match(DOC, /items` must be a non-empty array/);
    assert.ok(DOC.includes('signal') && DOC.includes('evidence'), 'docs must mention signal and evidence requirements');
  });

  it('documents per-item result semantics', () => {
    for (const status of ['created', 'deduplicated', 'rejected']) {
      assert.ok(DOC.includes(status), `docs must mention scan item status: ${status}`);
    }
  });

  it('documents all-rejected aggregate failure rule', () => {
    assert.ok(
      DOC.includes('every') && DOC.includes('rejected') && (DOC.includes('ok: false') || DOC.includes('scan fails')),
      'docs must document that all-rejected snapshots produce scan-level failure'
    );
  });

  it('documents captured_at as informational', () => {
    assert.ok(DOC.includes('captured_at'), 'docs must mention captured_at');
    assert.match(DOC, /informational/);
  });
});

describe('Intake docs planning specs alignment', () => {
  it('keeps planning specs aligned with the public route, shipped slices, and resolved v3 questions', () => {
    assert.match(DOCS_SURFACE_SPEC, /\/docs\/continuous-delivery-intake/);
    assert.match(DOC_SPEC, /\/docs\/continuous-delivery-intake/);
    assert.match(V3_SCOPE, /V3-S1 \(shipped\)/);
    assert.match(V3_SCOPE, /V3-S2 \(shipped\)/);
    assert.match(V3_SCOPE, /V3-S3 \(shipped\)/);
    assert.match(V3_SCOPE, /V3-S4 \(shipped\)/);
    assert.match(V3_SCOPE, /V3-S5 \(shipped\)/);
    assert.match(V3_SCOPE, /intake lifecycle is feature-complete for now/i);
    assert.match(V3_SCOPE, /`schedule` is a first-class event source/i);
    assert.match(V3_SCOPE, /append-only child records under `\.agentxchain\/intake\/observations\/`/i);
    assert.match(V3_SCOPE, /fallback template is `generic`/i);
  });
});
