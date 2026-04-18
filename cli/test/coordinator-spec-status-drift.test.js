import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..', '..');

function readSpec(relPath) {
  return readFileSync(join(REPO_ROOT, relPath), 'utf8');
}

describe('Coordinator spec status alignment', () => {
  const completedSpecs = [
    { path: '.planning/COORDINATOR_WAVE_EXECUTION_SPEC.md', name: 'wave execution' },
    { path: '.planning/MISSION_PLAN_LAUNCH_ALL_READY_SPEC.md', name: '--all-ready' },
    { path: '.planning/MISSION_AUTOPILOT_SPEC.md', name: 'autopilot' },
    { path: '.planning/COORDINATOR_RETRY_REAL_AGENT_SPEC.md', name: 'retry real-agent proof' },
    { path: '.planning/COORDINATOR_CHILD_RUN_E2E_SPEC.md', name: 'child-run E2E proof' },
    { path: '.planning/COORDINATOR_RECOVERY_REAL_AGENT_SPEC.md', name: 'recovery real-agent proof' },
    { path: '.planning/COORDINATOR_WAVE_FAILURE_REAL_AGENT_SPEC.md', name: 'wave-failure real-agent proof' },
    { path: '.planning/MISSION_COORDINATOR_LAUNCH_SPEC.md', name: 'coordinator launch' },
    { path: '.planning/MISSION_DECOMPOSITION_SPEC.md', name: 'mission decomposition' },
    { path: '.planning/MULTI_REPO_MISSION_BRIDGE_SPEC.md', name: 'multi-repo mission bridge' },
  ];

  for (const { path, name } of completedSpecs) {
    it(`${name} spec is not marked proposed or in-progress`, () => {
      const content = readSpec(path);
      assert.doesNotMatch(
        content,
        /\*\*Status:\*\*\s*(proposed|in.progress)/i,
        `${path} still claims proposed/in-progress status but the feature is shipped`
      );
    });
  }

  it('coordinator retry spec is correctly marked partial (phase 1 shipped, auto-retry deferred)', () => {
    const content = readSpec('.planning/COORDINATOR_RETRY_SPEC.md');
    assert.match(content, /\*\*Status:\*\*\s*partial/i);
  });

  it('wave execution spec does not claim fail-closed as current behavior', () => {
    const content = readSpec('.planning/COORDINATOR_WAVE_EXECUTION_SPEC.md');
    assert.doesNotMatch(
      content,
      /Today these commands are fail-closed/,
      'Wave execution spec still claims fail-closed as current behavior'
    );
  });

  // Guard against stale present-tense "Today" problem statements in completed specs.
  // Completed specs must use past tense for pre-implementation problem descriptions.
  const specsWithShippedFeatures = [
    {
      path: '.planning/MISSION_PLAN_LAUNCH_ALL_READY_SPEC.md',
      name: '--all-ready',
      stalePattern: /Today `mission plan launch` launches one workstream/,
    },
    {
      path: '.planning/COORDINATOR_RETRY_SPEC.md',
      name: 'coordinator retry',
      stalePattern: /Today, coordinator workstream failures are terminal/,
    },
  ];

  for (const { path, name, stalePattern } of specsWithShippedFeatures) {
    it(`${name} spec does not describe shipped behavior as present-tense "Today" problem`, () => {
      const content = readSpec(path);
      assert.doesNotMatch(
        content,
        stalePattern,
        `${path} still uses stale "Today" language for a shipped feature`
      );
    });
  }

  // Guard: missions.mdx must describe coordinator --all-ready, autopilot, and --retry as shipped
  it('missions docs describe coordinator wave execution as shipped, not fail-closed', () => {
    const missionsDoc = readFileSync(
      join(REPO_ROOT, 'website-v2/docs/missions.mdx'),
      'utf8'
    );
    assert.match(missionsDoc, /--all-ready/, 'missions.mdx must document --all-ready');
    assert.match(missionsDoc, /autopilot/, 'missions.mdx must document autopilot');
    assert.match(missionsDoc, /--retry/, 'missions.mdx must document --retry');
    assert.doesNotMatch(
      missionsDoc,
      /coordinator.*--all-ready.*fail.closed|coordinator.*autopilot.*fail.closed/i,
      'missions.mdx must not claim coordinator wave execution is fail-closed'
    );
  });
});
