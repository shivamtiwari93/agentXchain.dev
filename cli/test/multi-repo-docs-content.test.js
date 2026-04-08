import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..', '..');

const read = (rel) => readFileSync(join(REPO_ROOT, rel), 'utf8');

const PAGE = read('website-v2/docs/multi-repo.mdx');
const SIDEBARS = read('website-v2/sidebars.ts');
const CLI_DOCS = read('website-v2/docs/cli.mdx');
const PROTOCOL_DOCS = read('website-v2/docs/protocol.mdx');
const MULTI_IMPL = read('cli/src/commands/multi.js');
const COORDINATOR_CONFIG = read('cli/src/lib/coordinator-config.js');
const COORDINATOR_STATE = read('cli/src/lib/coordinator-state.js');
const COORDINATOR_HOOKS = read('cli/src/lib/coordinator-hooks.js');
const CROSS_REPO_CONTEXT = read('cli/src/lib/cross-repo-context.js');
const COORDINATOR_PHASE_E2E = read('cli/test/e2e-coordinator-custom-phases.test.js');
const SPEC = read('.planning/MULTI_REPO_DOC_PAGE_SPEC.md');

describe('Multi-repo docs surface', () => {
  it('ships the dedicated docs page and wires it into the sidebar', () => {
    assert.ok(existsSync(join(REPO_ROOT, 'website-v2/docs/multi-repo.mdx')));
    assert.match(SIDEBARS, /'multi-repo'/);
  });

  it('is linked from the CLI and protocol docs', () => {
    assert.match(CLI_DOCS, /\/docs\/multi-repo/);
    assert.match(PROTOCOL_DOCS, /\/docs\/multi-repo/);
  });
});

describe('Multi-repo docs content', () => {
  it('documents the real config file and artifact root', () => {
    assert.match(PAGE, /agentxchain-multi\.json/);
    assert.match(PAGE, /\.agentxchain\/multirepo\//);
    assert.match(COORDINATOR_CONFIG, /agentxchain-multi\.json/);
    assert.match(COORDINATOR_STATE, /\.agentxchain\/multirepo/);
  });

  it('documents coordinator-child phase-order alignment', () => {
    assert.match(COORDINATOR_CONFIG, /repo_phase_alignment_invalid/);
    assert.match(PAGE, /same ordered routing phases/i);
    assert.match(PAGE, /multi init.*rejects phase-order mismatches/i);
  });

  it('documents coordinator custom phases and no-skip transitions', () => {
    assert.match(COORDINATOR_PHASE_E2E, /phase_skip_forbidden/);
    assert.match(PAGE, /planning -> design -> implementation -> qa/);
    assert.match(PAGE, /`phase_transition_request` may only target the immediate next declared phase/i);
    assert.match(PAGE, /planning -> implementation.*phase_skip_forbidden/i);
  });

  it('documents the full operator loop including repo-local accept-turn', () => {
    for (const term of [
      'multi init',
      'multi step',
      'multi resume',
      'multi approve-gate',
      'multi resync --dry-run',
      'accept-turn',
    ]) {
      assert.match(PAGE, new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    }
  });

  it('documents step auto-resync and repo-local authority', () => {
    assert.match(MULTI_IMPL, /detectDivergence/);
    assert.match(MULTI_IMPL, /resyncFromRepoAuthority/);
    assert.match(PAGE, /auto-resync|auto-resyncs|resyncs from repo authority/i);
    assert.match(PAGE, /repo-local .* authoritative|repo-local governed state is authoritative/i);
  });

  it('documents blocked-state recovery distinctly from divergence resync', () => {
    assert.match(PAGE, /multi resume/i);
    assert.match(PAGE, /blocked state/i);
    assert.match(PAGE, /multi step|multi approve-gate/i);
  });

  it('documents recovery report requirement for multi resume', () => {
    assert.match(PAGE, /RECOVERY_REPORT\.md/);
    assert.match(PAGE, /## Trigger/);
    assert.match(PAGE, /## Impact/);
    assert.match(PAGE, /## Mitigation/);
    assert.match(PAGE, /ambiguous resync results|resync that finds an ambiguous gate/i);
  });

  it('documents the shipped barrier types', () => {
    for (const barrierType of [
      'all_repos_accepted',
      'ordered_repo_sequence',
      'interface_alignment',
      'shared_human_gate',
    ]) {
      assert.match(COORDINATOR_CONFIG, new RegExp(barrierType));
      assert.match(PAGE, new RegExp(barrierType));
    }
  });

  it('documents the explicit interface_alignment config contract', () => {
    assert.match(COORDINATOR_CONFIG, /decision_ids_by_repo/);
    assert.match(PAGE, /decision_ids_by_repo/);
    assert.match(PAGE, /declared `DEC-NNN` decisions|declared DEC-NNN decisions/i);
  });

  it('documents the shipped coordinator hook phases', () => {
    for (const phase of [
      'before_assignment',
      'after_acceptance',
      'before_gate',
      'on_escalation',
    ]) {
      assert.match(COORDINATOR_HOOKS, new RegExp(phase));
      assert.match(PAGE, new RegExp(phase));
    }
  });

  it('documents coordinator context artifacts', () => {
    assert.match(CROSS_REPO_CONTEXT, /COORDINATOR_CONTEXT\.json/);
    assert.match(CROSS_REPO_CONTEXT, /COORDINATOR_CONTEXT\.md/);
    assert.match(PAGE, /COORDINATOR_CONTEXT\.json/);
    assert.match(PAGE, /COORDINATOR_CONTEXT\.md/);
    assert.match(PAGE, /decision IDs still required/i);
  });
});

describe('Interface alignment end-to-end example', () => {
  it('shows a complete agentxchain-multi.json with interface_alignment as completion_barrier', () => {
    assert.match(PAGE, /completion_barrier.*interface_alignment/s);
    assert.match(PAGE, /"interface_alignment":\s*\{[\s\S]*?"decision_ids_by_repo"/);
  });

  it('shows turn result decisions array with declared DEC-NNN', () => {
    assert.match(PAGE, /turn-result\.json/);
    assert.match(PAGE, /"decisions":\s*\[[\s\S]*?"id":\s*"DEC-101"/);
  });

  it('shows coordinator context surfacing required decision IDs for the target repo', () => {
    assert.match(PAGE, /Required decision IDs for web: DEC-201/);
    assert.match(PAGE, /alignment_decision_ids/);
  });

  it('shows barrier progression from partially_satisfied to satisfied', () => {
    assert.match(PAGE, /partially_satisfied/);
    assert.match(PAGE, /barrier.*satisfied/i);
  });
});

describe('Multi-repo doc spec alignment', () => {
  it('ships a standalone spec with the current route and acceptance contract', () => {
    assert.match(SPEC, /\*\*Status:\*\*\s+Shipped/i);
    assert.match(SPEC, /\/docs\/multi-repo/);
    assert.match(SPEC, /AT-MRD-001/);
    assert.match(SPEC, /AT-MRD-008/);
  });
});
