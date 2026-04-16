import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..', '..');

function read(relPath) {
  return readFileSync(join(REPO_ROOT, relPath), 'utf8');
}

const V2_SCOPE = read('.planning/V2_SCOPE_BOUNDARY.md');
const V2_DASHBOARD = read('.planning/V2_DASHBOARD_SPEC.md');
const V21_SCOPE = read('.planning/V2_1_SCOPE_BOUNDARY.md');
const V21_DRILLDOWN = read('.planning/V2_1_DASHBOARD_DRILLDOWN_SPEC.md');
const DASHBOARD_IMPL_PLAN = read('.planning/DASHBOARD_IMPLEMENTATION_PLAN.md');
const HISTORICAL_SPEC = read('.planning/DASHBOARD_HISTORICAL_SCOPE_QUARANTINE_SPEC.md');

describe('Dashboard historical scope quarantine', () => {
  it('AT-DASH-HIST-001: keeps V2 scope boundary historical and points to the current live-dashboard contract', () => {
    assert.match(V2_SCOPE, /Historical release-boundary note/i);
    assert.match(V2_SCOPE, /current authority for live dashboard mutability/i);
    assert.match(V2_SCOPE, /DASHBOARD_GATE_ACTIONS_SPEC\.md/);
    assert.match(V2_SCOPE, /DASHBOARD_DOCS_CONTRACT_SPEC\.md/);
    assert.match(V2_SCOPE, /authenticated .*approve-gate.*HTTP mutations/is);
    assert.match(V2_SCOPE, /WebSocket channel remains read-only/i);
    assert.match(V2_SCOPE, /replay export.*read-only/i);
  });

  it('AT-DASH-HIST-002: keeps V2 dashboard spec historical without lying about the shipped live approve-gate path', () => {
    assert.match(V2_DASHBOARD, /Historical spec note/i);
    assert.match(V2_DASHBOARD, /current authority for live dashboard mutability/i);
    assert.match(V2_DASHBOARD, /authenticated `approve-gate` HTTP mutations/i);
    assert.match(V2_DASHBOARD, /WebSocket channel remains read-only/i);
    assert.match(V2_DASHBOARD, /original v2\.0 baseline/i);
    assert.match(V2_DASHBOARD, /Historical v2\.0 boundary only/i);
  });

  it('AT-DASH-HIST-003: keeps V2.1 scope boundary historical and limits the superseding write path correctly', () => {
    assert.match(V21_SCOPE, /Historical release-boundary note/i);
    assert.match(V21_SCOPE, /current shipped dashboard mutability contract/i);
    assert.match(V21_SCOPE, /Later releases added only authenticated `approve-gate`/i);
    assert.match(V21_SCOPE, /broader dashboard write authority is still deferred/i);
    assert.match(V21_SCOPE, /DEC-V2_1-SCOPE-005/);
  });

  it('AT-DASH-HIST-004: keeps the V2.1 drill-down spec historical and replay-safe', () => {
    assert.match(V21_DRILLDOWN, /Historical slice note/i);
    assert.match(V21_DRILLDOWN, /not the current authority for live dashboard mutability/i);
    assert.match(V21_DRILLDOWN, /Later releases superseded that for the live dashboard with a narrow authenticated `approve-gate` action/i);
    assert.match(V21_DRILLDOWN, /replay export.*read-only/i);
  });

  it('AT-DASH-HIST-005: keeps the dashboard implementation plan historical without teaching obsolete mutability as current truth', () => {
    assert.match(DASHBOARD_IMPL_PLAN, /Historical implementation-plan note/i);
    assert.match(DASHBOARD_IMPL_PLAN, /not the current authority for live dashboard mutability/i);
    assert.match(DASHBOARD_IMPL_PLAN, /DASHBOARD_GATE_ACTIONS_SPEC\.md/);
    assert.match(DASHBOARD_IMPL_PLAN, /DASHBOARD_DOCS_CONTRACT_SPEC\.md/);
    assert.match(DASHBOARD_IMPL_PLAN, /authenticated `approve-gate` HTTP mutation/i);
    assert.match(DASHBOARD_IMPL_PLAN, /WebSocket channel.*read-only/i);
    assert.match(DASHBOARD_IMPL_PLAN, /Historical v2\.0 baseline: read-only/i);
  });

  it('ships a durable quarantine spec for these historical dashboard files', () => {
    assert.match(HISTORICAL_SPEC, /Dashboard Historical Scope Quarantine Spec/);
    assert.match(HISTORICAL_SPEC, /AT-DASH-HIST-001/);
    assert.match(HISTORICAL_SPEC, /AT-DASH-HIST-005/);
    assert.match(HISTORICAL_SPEC, /approve-gate/);
    assert.match(HISTORICAL_SPEC, /WebSocket remains read-only/);
  });
});
