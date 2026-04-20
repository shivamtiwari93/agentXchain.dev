import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..', '..');

const read = (rel) => readFileSync(join(REPO_ROOT, rel), 'utf8');
const readJSON = (rel) => JSON.parse(read(rel));

const GUIDE_PATH = 'website-v2/docs/protocol-implementor-guide.mdx';
const GUIDE = read(GUIDE_PATH);
const SIDEBARS = read('website-v2/sidebars.ts');
const DOCS_SURFACE_SPEC = read('.planning/DOCS_SURFACE_SPEC.md');
const GUIDE_SPEC = read('.planning/PROTOCOL_IMPLEMENTOR_GUIDE_SPEC.md');
const PKG_VERSION = process.env.AGENTXCHAIN_RELEASE_TARGET_VERSION || readJSON('cli/package.json').version;
const CAPABILITIES = readJSON('.agentxchain-conformance/capabilities.json');
const FIXTURE_README = read('.agentxchain-conformance/fixtures/README.md');

function extractSection(doc, heading) {
  const escaped = heading.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = doc.match(new RegExp(`### \`${escaped}\`\\n\\n([\\s\\S]*?)(?=\\n### \`|\\n## |$)`));
  assert.ok(match, `Missing section for ${heading}`);
  return match[1];
}

function extractJsonCodeBlockAfter(label) {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = GUIDE.match(new RegExp(`${escaped}\\n\\n\`\`\`json\\n([\\s\\S]*?)\\n\`\`\``));
  assert.ok(match, `Missing JSON code block after "${label}"`);
  return JSON.parse(match[1]);
}

function extractSetupHelpers(doc) {
  return new Set([...doc.matchAll(/`setup\.([a-z_]+)`/g)].map((match) => match[1]));
}

describe('Protocol implementor guide surface', () => {
  it('ships the Docusaurus source page and planning spec', () => {
    assert.ok(existsSync(join(REPO_ROOT, GUIDE_PATH)), 'guide source must exist');
    assert.ok(
      existsSync(join(REPO_ROOT, '.planning/PROTOCOL_IMPLEMENTOR_GUIDE_SPEC.md')),
      'implementor guide spec must exist'
    );
  });

  it('adds the guide under the Protocol docs section', () => {
    assert.match(SIDEBARS, /label:\s*'Protocol'/);
    assert.match(SIDEBARS, /'protocol-implementor-guide'/);
  });

  it('documents the real conformance primitives', () => {
    for (const term of [
      'capabilities.json',
      'stdio-fixture-v1',
      'http-fixture-v1',
      'verify protocol',
      'not_implemented',
      'state_machine',
      'turn_result_validation',
      'gate_semantics',
      'decision_ledger',
      'history',
      'config_schema',
      'dispatch_manifest',
      'hook_audit',
      'coordinator',
      'ordered_repo_sequence',
      'shared_human_gate',
      'interface_alignment',
      'named_decisions',
    ]) {
      assert.ok(GUIDE.includes(term), `guide must mention ${term}`);
    }
  });

  it('documents the current Tier 3 proof boundary honestly', () => {
    assert.match(GUIDE, /cross-repo write isolation/i);
    assert.match(GUIDE, /decision_ids_by_repo/i);
    assert.doesNotMatch(GUIDE, /intentionally not fixture-promoted yet/i);
    assert.doesNotMatch(GUIDE, /current runtime still treats it as a heuristic placeholder/i);
  });

  it('describes workflow-file gate truth, not only abstract human approval', () => {
    assert.match(GUIDE, /PM_SIGNOFF\.md/);
    assert.match(GUIDE, /ship-verdict\.md/);
    assert.match(GUIDE, /run completion/i);
  });

  it('documents Tier 1 surface invariants at fixture-level detail', () => {
    const stateMachine = extractSection(GUIDE, 'state_machine');
    for (const term of ['idle', 'active', 'paused', 'blocked', 'completed', 'run_id']) {
      assert.match(stateMachine, new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    }

    const turnValidation = extractSection(GUIDE, 'turn_result_validation');
    for (const term of [
      'summary',
      'run_id',
      'turn_id',
      'reserved paths',
      'review_only',
      'DEC-NNN',
      'phase_transition',
      'run_completion',
      'needs_human',
    ]) {
      assert.match(turnValidation, new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    }

    const decisionLedger = extractSection(GUIDE, 'decision_ledger');
    for (const term of ['required fields', 'empty decision statements', 'invalid categories', 'duplicate decision IDs']) {
      assert.match(decisionLedger, new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    }

    const history = extractSection(GUIDE, 'history');
    for (const term of ['atomically', 're-accepting', 'non-active turn']) {
      assert.match(history, new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    }

    const configSchema = extractSection(GUIDE, 'config_schema');
    for (const term of ['minimal governed config', 'entry_role', 'undeclared runtimes', 'undeclared gates', 'schema_version']) {
      assert.match(configSchema, new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    }
  });

  it('documents Tier 1 v7-promoted surface invariants at fixture-level detail', () => {
    const delegation = extractSection(GUIDE, 'delegation');
    for (const term of ['charter', 'to_role', 'self-delegation', 'required_decision_ids', 'run_completion_request']) {
      assert.match(delegation, new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), `delegation section must mention "${term}"`);
    }

    const decisionCarryover = extractSection(GUIDE, 'decision_carryover');
    for (const term of ['durability.*repo', 'durability.*run', 'overrides', 'self-override']) {
      assert.match(decisionCarryover, new RegExp(term, 'i'), `decision_carryover section must match "${term}"`);
    }

    const parallelTurns = extractSection(GUIDE, 'parallel_turns');
    for (const term of ['max_concurrent_turns', 'sequential', 'non-integer']) {
      assert.match(parallelTurns, new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), `parallel_turns section must mention "${term}"`);
    }

    const eventLifecycle = extractSection(GUIDE, 'event_lifecycle');
    for (const term of ['run_started', 'run_completed', 'turn_dispatched', 'turn_accepted', 'timestamp', 'turn_id', 'ordering']) {
      assert.match(eventLifecycle, new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), `event_lifecycle section must mention "${term}"`);
    }
  });

  it('documents Tier 2 dispatch_manifest invariants at fixture-level detail', () => {
    const section = extractSection(GUIDE, 'dispatch_manifest');
    for (const term of [
      'SHA-256',
      'unexpected file',
      'content tampering',
      'deleted file',
      'MANIFEST.json',
      'size mismatch',
      'accumulated errors',
      'missing_manifest',
      'invalid_manifest',
      'required fields',
    ]) {
      assert.match(section, new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), `dispatch_manifest section must mention "${term}"`);
    }
  });

  it('documents Tier 2 hook_audit invariants at fixture-level detail', () => {
    const section = extractSection(GUIDE, 'hook_audit');
    for (const term of [
      'required fields',
      'transport.*http',
      'downgraded_block_to_warn',
      'blocked_failure',
      'aborted_tamper',
      'blocked.*stops the phase',
      'skipped',
      'blocked_invalid_output',
      'warned_invalid_output',
      'blocked_timeout',
      'warned_timeout',
      'warned_failure',
      'warned.*without blocking',
    ]) {
      assert.match(section, new RegExp(term, 'i'), `hook_audit section must match "${term}"`);
    }
  });

  it('documents Tier 3 coordinator invariants at fixture-level detail', () => {
    const section = extractSection(GUIDE, 'coordinator');
    for (const term of [
      'valid coordinator config',
      'cyclic.*dependencies.*rejected',
      'partially_satisfied',
      'satisfied',
      'cross-repo write isolation',
      'ordered_repo_sequence',
      'shared_human_gate',
      'interface_alignment',
      'named_decisions',
      'decision_ids_by_repo',
    ]) {
      assert.match(section, new RegExp(term, 'i'), `coordinator section must match "${term}"`);
    }
  });

  it('distinguishes adapter exit codes from verifier exit codes', () => {
    assert.match(GUIDE, /Adapter process \| `0=pass`, `1=fail`, `2=error`, `3=not_implemented`/);
    assert.match(GUIDE, /verify protocol` \| `0=overall pass`, `1=one or more fixture failures`, `2=verifier or adapter error`/);
    assert.match(GUIDE, /The verifier never exits `3`/);
  });

  it('keeps planning specs aligned with the public route', () => {
    assert.match(DOCS_SURFACE_SPEC, /\/docs\/protocol-implementor-guide/);
    assert.match(GUIDE_SPEC, /\/docs\/protocol-implementor-guide/);
    assert.match(GUIDE_SPEC, /Protocol Implementor Guide/i);
  });

  it('documents the same setup helper inventory as the fixture corpus README', () => {
    assert.deepEqual(
      extractSetupHelpers(GUIDE),
      extractSetupHelpers(FIXTURE_README),
      'implementor guide helper inventory must stay aligned with the fixture README'
    );
  });

  it('capabilities.json version must match package.json version', () => {
    assert.equal(
      CAPABILITIES.version,
      PKG_VERSION,
      `capabilities.json version "${CAPABILITIES.version}" does not match package.json version "${PKG_VERSION}"`
    );
  });

  it('implementor guide example must show current package version', () => {
    assert.ok(
      GUIDE.includes(`"version": "${PKG_VERSION}"`),
      `implementor guide example must show version "${PKG_VERSION}", not a stale version`
    );
  });

  it('reference CLI capabilities example matches the shipped surface claims', () => {
    const example = extractJsonCodeBlockAfter("This is the reference CLI's current file:");
    assert.deepEqual(
      example.surfaces,
      CAPABILITIES.surfaces,
      'implementor guide capabilities example must match the real shipped surfaces map'
    );
  });
});
