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
    { path: '.planning/COORDINATOR_BLOCKED_RECOVERY_SPEC.md', name: 'blocked recovery' },
    { path: '.planning/RECOVERY_REPORT_CONTRACT_SPEC.md', name: 'recovery report contract' },
    { path: '.planning/RECOVERY_REPORT_RENDERING_SPEC.md', name: 'recovery report rendering' },
    { path: '.planning/COORDINATOR_REPORT_ACTIONS_SPEC.md', name: 'coordinator report actions' },
    { path: '.planning/ADAPTER_DOCS_CONTRACT_SPEC.md', name: 'adapter docs contract' },
    { path: '.planning/MULTI_SESSION_CONTINUITY_SPEC.md', name: 'multi-session continuity' },
    { path: '.planning/CONTINUOUS_BUDGET_ENFORCEMENT_SPEC.md', name: 'continuous budget enforcement' },
    { path: '.planning/BUDGET_WARN_ON_EXCEED_SPEC.md', name: 'budget warn on exceed' },
    { path: '.planning/BUDGET_WARN_CLI_SURFACE_SPEC.md', name: 'budget warn CLI surface' },
    { path: '.planning/PHASE_TRANSITION_INTENT_SPEC.md', name: 'phase transition intent' },
  ];

  for (const { path, name } of completedSpecs) {
    it(`${name} spec is not marked proposed or in-progress`, () => {
      const content = readSpec(path);
      assert.doesNotMatch(
        content,
        /\*\*Status:\*\*\s*(proposed|in.progress|draft)/i,
        `${path} still claims proposed/in-progress/draft status but the feature is shipped`
      );
    });
  }

  it('coordinator retry spec is marked shipped after autopilot auto-retry landed', () => {
    const content = readSpec('.planning/COORDINATOR_RETRY_SPEC.md');
    assert.match(content, /\*\*Status:\*\*\s*Shipped/i);
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
    {
      path: '.planning/COORDINATOR_BLOCKED_RECOVERY_SPEC.md',
      name: 'blocked recovery',
      stalePattern: /Today the coordinator can enter `status: "blocked"`/,
    },
    {
      path: '.planning/RECOVERY_REPORT_CONTRACT_SPEC.md',
      name: 'recovery report contract',
      stalePattern: /there is currently no artifact requirement/i,
    },
    {
      path: '.planning/RECOVERY_REPORT_RENDERING_SPEC.md',
      name: 'recovery report rendering',
      stalePattern: /agentxchain export does not include this file/i,
    },
    {
      path: '.planning/COORDINATOR_REPORT_ACTIONS_SPEC.md',
      name: 'coordinator report actions',
      stalePattern: /It still fails the most practical operator question/i,
    },
    {
      path: '.planning/PHASE_TRANSITION_INTENT_SPEC.md',
      name: 'phase transition intent',
      stalePattern: /Currently the prompt lists all valid phase names but never tells/,
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

  it('V2_2_PROTOCOL_CONFORMANCE_SPEC is marked Superseded', () => {
    const content = readSpec('.planning/V2_2_PROTOCOL_CONFORMANCE_SPEC.md');
    assert.match(
      content,
      /\*\*Status:\*\*\s*Superseded/i,
      'V2_2_PROTOCOL_CONFORMANCE_SPEC must be marked Superseded — it documents the v6 contract, not the current v7 contract'
    );
    assert.match(
      content,
      /PROTOCOL_V7_SPEC/,
      'V2_2_PROTOCOL_CONFORMANCE_SPEC must point to PROTOCOL_V7_SPEC.md as the current contract'
    );
  });

  it('REMOTE_PROTOCOL_VERIFICATION_SPEC examples use the current protocol version', () => {
    const content = readSpec('.planning/REMOTE_PROTOCOL_VERIFICATION_SPEC.md');
    const v6Matches = content.match(/"protocol_version":\s*"v6"/g);
    assert.equal(
      v6Matches,
      null,
      'REMOTE_PROTOCOL_VERIFICATION_SPEC must not contain v6 protocol examples — the current protocol is v7'
    );
  });

  it('multi-repo docs describe blocked recovery as a shipped operator path', () => {
    const multiRepoDoc = readFileSync(
      join(REPO_ROOT, 'website-v2/docs/multi-repo.mdx'),
      'utf8'
    );
    assert.match(multiRepoDoc, /agentxchain multi resume/, 'multi-repo docs must document multi resume');
    assert.match(
      multiRepoDoc,
      /RECOVERY_REPORT\.md/,
      'multi-repo docs must document the recovery report requirement'
    );
    assert.doesNotMatch(
      multiRepoDoc,
      /no shipped recovery path|no corresponding CLI command/i,
      'multi-repo docs must not describe blocked recovery as unshipped'
    );
  });
});
