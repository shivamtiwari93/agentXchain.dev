import { strict as assert } from 'node:assert';
import { describe, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..', '..');

const SPEC_PATH = '.planning/MISSION_COORDINATOR_LAUNCH_SPEC.md';
const SPEC = readFileSync(join(REPO_ROOT, SPEC_PATH), 'utf8');

describe('Mission coordinator launch spec', () => {
  it('ships the durable planning spec with required sections', () => {
    assert.ok(existsSync(join(REPO_ROOT, SPEC_PATH)), 'MISSION_COORDINATOR_LAUNCH_SPEC.md must exist');
    for (const heading of ['## Purpose', '## Interface', '## Behavior', '## Error Cases', '## Acceptance Tests', '## Open Questions']) {
      assert.match(SPEC, new RegExp(heading.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    }
  });

  it('marks the coordinator launch surface as implemented', () => {
    assert.match(SPEC, /\*\*Status:\*\* implemented/);
  });

  it('keeps AT-MISSION-COORD-LAUNCH-005 and 006 aligned with shipped coordinator wave behavior', () => {
    assert.match(
      SPEC,
      /AT-MISSION-COORD-LAUNCH-005`: `mission plan launch --all-ready` dispatches currently-ready coordinator workstreams sequentially and synchronizes barrier state instead of fail-closing/
    );
    assert.match(
      SPEC,
      /AT-MISSION-COORD-LAUNCH-006`: `mission plan autopilot` dispatches coordinator workstreams in dependency waves until the plan completes or a failure boundary stops execution instead of fail-closing/
    );
    assert.doesNotMatch(
      SPEC,
      /AT-MISSION-COORD-LAUNCH-00[56]`: .*fails closed for coordinator-bound missions/
    );
  });

  it('does not leave already-shipped coordinator wave work as an open question', () => {
    assert.match(
      SPEC,
      /None for this slice\. Coordinator `--all-ready`, coordinator autopilot, targeted `--retry`, and unattended coordinator auto-retry are now shipped\./
    );
    assert.match(SPEC, /COORDINATOR_RETRY_SPEC\.md/);
    assert.doesNotMatch(SPEC, /Should a later slice let `mission plan launch --all-ready` run one coordinator dispatch per ready workstream/);
  });
});
