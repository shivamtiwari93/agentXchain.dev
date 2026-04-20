import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..', '..');
const read = (rel) => readFileSync(resolve(ROOT, rel), 'utf8');

describe('release planning surface classification', () => {
  it('RELEASE_PLAYBOOK.md is the single current release-cut playbook', () => {
    const playbook = read('.planning/RELEASE_PLAYBOOK.md');
    assert.doesNotMatch(playbook, /\*\*SUPERSEDED/i, 'release playbook must be current');
    assert.match(playbook, /publish-npm-on-tag\.yml/, 'playbook must reference canonical publish workflow');
    assert.match(playbook, /npm run preflight:release -- --target-version <semver>/,
      'playbook must require explicit target-version preflight');
    assert.match(playbook, /npm run preflight:release:strict -- --target-version <semver>/,
      'playbook must require strict preflight');
    assert.match(playbook, /npm run bump:release/, 'playbook must use bump:release to create release identity');
    assert.match(playbook, /npm run postflight:release -- --target-version <semver>/,
      'playbook must require postflight verification');
    assert.match(playbook, /bash marketing\/post-release\.sh "v<semver>" "one-line summary"/,
      'playbook must require the executable post-release announcement step');
    assert.match(playbook, /Homebrew/i, 'playbook must include Homebrew update sequencing');
    assert.match(playbook, /fails before npm publication/i,
      'playbook must document the pre-publish canonical-tap prereq gate');
    assert.match(playbook, /release-preflight\.sh --dry-run/,
      'playbook must document --dry-run preview as the recommended first step');
    assert.match(playbook, /check-release-alignment\.mjs.*--report/,
      'playbook must document the alignment reporter');
    assert.match(playbook, /--dry-run.*mutually exclusive.*--strict.*--publish-gate/,
      'playbook must document --dry-run flag exclusivity');
    assert.match(playbook, /test\/claim-reality-preflight\.test\.js/,
      'playbook must explicitly document packaged claim-reality proof as part of preflight');
    assert.match(playbook, /test\/beta-tester-scenarios\/\*\.test\.js/,
      'playbook must explicitly document beta-tester scenario coverage as part of preflight');
    assert.match(playbook, /false closures ship/i,
      'playbook must explain why claim-reality and beta-tester suites stay in the release gate');
  });

  // -- Current contracts: these must NOT be marked SUPERSEDED --

  it('RELEASE_PREFLIGHT_VNEXT_SPEC.md is a current contract', () => {
    const spec = read('.planning/RELEASE_PREFLIGHT_VNEXT_SPEC.md');
    assert.doesNotMatch(spec, /\*\*SUPERSEDED/i, 'preflight vnext spec must not be superseded');
    assert.match(spec, /--target-version/, 'must document --target-version flag');
    assert.match(spec, /--strict/, 'must document --strict flag');
    assert.match(spec, /explicit `2\.0\.0`/, 'must state the actual fallback default');
    assert.doesNotMatch(spec, /explicit `1\.0\.0`/, 'must not carry stale v1 default text');
  });

  it('RELEASE_POSTFLIGHT_SPEC.md is a current contract', () => {
    const spec = read('.planning/RELEASE_POSTFLIGHT_SPEC.md');
    assert.doesNotMatch(spec, /\*\*SUPERSEDED/i, 'postflight spec must not be superseded');
    assert.match(spec, /--target-version/, 'must document --target-version flag');
    assert.match(spec, /Install smoke/, 'must document install smoke check');
    assert.match(spec, /Operator front-door smoke/, 'must document operator front-door smoke check');
    assert.match(spec, /isolated/, 'must require isolated install, not ambient PATH');
    assert.match(spec, /npm run postflight:release -- --target-version 2\.0\.1/,
      'must document the actual npm script entrypoint');
    assert.match(spec, /npx --yes -p agentxchain@<version> -c "agentxchain --version"/,
      'postflight spec must document the exact npx smoke command');
    assert.match(spec, /ambiguous operator error/,
      'postflight spec must explicitly reject the ambiguous npx shorthand when it mentions it');
    assert.match(spec, /init --governed --template cli-tool --goal "Release operator smoke"/,
      'postflight spec must document the scaffolded operator smoke path');
    assert.match(spec, /validate --mode kickoff --json/,
      'postflight spec must document the governed validation smoke command');
  });

  // -- Superseded specs: these MUST be marked SUPERSEDED --

  const supersededSpecs = [
    { file: '.planning/RELEASE_CUT_SPEC.md', reason: 'v1.0.0 was never published' },
    { file: '.planning/RELEASE_BRIEF.md', reason: 'v2.1.0 was never published' },
    { file: '.planning/V1_1_RELEASE_HANDOFF_SPEC.md', reason: 'v1.1.0 was never published' },
    { file: '.planning/V1_RELEASE_CHECKLIST.md', reason: 'v1.0.0 was never published' },
    { file: '.planning/V1_1_RELEASE_CHECKLIST.md', reason: 'v1.1.0 was never published' },
    { file: '.planning/V1_1_RELEASE_SCOPE_SPEC.md', reason: 'v1.1.0 was never published' },
    { file: '.planning/RELEASE_PREFLIGHT_SPEC.md', reason: 'replaced by vnext spec' },
    { file: '.planning/RELEASE_RECOVERY.md', reason: 'v2.0.0/v2.0.1 were never published' },
    { file: '.planning/V2_1_RELEASE_NOTES_SPEC.md', reason: 'v2.1.0 was never published' },
    { file: '.planning/V2_1_RELEASE_NOTES.md', reason: 'v2.1.0 was never published' },
    { file: '.planning/POST_V1_ROADMAP.md', reason: 'v1.0.0 was never published' },
  ];

  for (const { file, reason } of supersededSpecs) {
    it(`${file.split('/').pop()} is marked SUPERSEDED (${reason})`, () => {
      assert.ok(existsSync(resolve(ROOT, file)), `${file} must exist`);
      const content = read(file);
      assert.match(content, /\*\*SUPERSEDED/i,
        `${file} must be marked SUPERSEDED — it documents a version that was never published to npm`);
    });
  }

  // -- Preflight spec matches implementation --

  it('preflight spec default version matches the actual script', () => {
    const spec = read('.planning/RELEASE_PREFLIGHT_VNEXT_SPEC.md');
    const script = read('cli/scripts/release-preflight.sh');
    // Extract default from script: TARGET_VERSION="X.Y.Z"
    const scriptDefault = script.match(/TARGET_VERSION="(\d+\.\d+\.\d+)"/)?.[1];
    assert.ok(scriptDefault, 'script must have a TARGET_VERSION default');
    // Spec must mention the same default
    assert.match(spec, new RegExp(`Defaults to .${scriptDefault}.`),
      `spec default must match script default (${scriptDefault})`);
  });

  // -- Operator handoff doc is current --

  it('HUMAN_TASKS.md documents the trusted-publishing workflow as default release path', () => {
    const humanTasks = read('.planning/HUMAN_TASKS.md');
    assert.match(humanTasks, /trusted-publishing workflow/i);
    assert.match(humanTasks, /publish-npm-on-tag/);
  });

  // -- Publish workflow exists and has postflight --

  it('publish workflow includes postflight verification', () => {
    const workflow = read('.github/workflows/publish-npm-on-tag.yml');
    assert.match(workflow, /release-postflight\.sh/);
    assert.match(workflow, /RELEASE_POSTFLIGHT_RETRY_ATTEMPTS/);
  });

  it('publish workflow enforces a job timeout so stuck releases fail closed', () => {
    const workflow = read('.github/workflows/publish-npm-on-tag.yml');
    assert.match(
      workflow,
      /jobs:\s+publish:\s+[\s\S]*?runs-on:\s+ubuntu-latest\s+timeout-minutes:\s+45/,
      'publish job must have an explicit timeout-minutes guard',
    );
  });

  it('publish workflow includes downstream truth verification as completeness gate', () => {
    const workflow = read('.github/workflows/publish-npm-on-tag.yml');
    assert.match(workflow, /release-downstream-truth\.sh/,
      'publish workflow must run downstream truth as the final completeness gate');
    assert.match(workflow, /RELEASE_DOWNSTREAM_RETRY_ATTEMPTS/,
      'downstream truth must have retry configuration in CI');
    assert.match(workflow, /Verify canonical tap readiness before first publish/,
      'publish workflow must block first-time publish when canonical tap completion is impossible');
  });

  it('publish workflow separates tagged-state verification from npm publication', () => {
    const workflow = read('.github/workflows/publish-npm-on-tag.yml');
    assert.match(workflow, /name:\s+Re-verify tagged release before publish/);
    assert.match(workflow, /bash scripts\/release-preflight\.sh --publish-gate --target-version "\$\{RELEASE_TAG#v\}"/);
    assert.match(workflow, /bash scripts\/publish-from-tag\.sh --skip-preflight "\$\{RELEASE_TAG\}"/);
  });

  // -- Publish automation cannot silently fall back to a weaker preflight path --
  //
  // Rationale: claim-reality-preflight.test.js is the release-boundary packaged-proof
  // surface for BUG-47..51 (and any future tester-gated bug that lands packaged rows).
  // The shell script `release-preflight.sh --publish-gate` includes that file in
  // GATE_TEST_PATTERNS (locked by release-preflight.test.js). But the workflow YAML
  // can still regress independently: someone could remove a preflight step, swap
  // `--publish-gate` for `--strict` alone, drop the `--target-version` argument,
  // or add an alternative `npm publish` step that bypasses `publish-from-tag.sh`.
  // The tests below lock the workflow contract so the publish automation cannot
  // silently fall back to a weaker preflight path than the shell script advertises.

  it('publish workflow runs --publish-gate on BOTH publish paths (rerun AND first-publish)', () => {
    const workflow = read('.github/workflows/publish-npm-on-tag.yml');
    const gateInvocations = workflow.match(
      /bash scripts\/release-preflight\.sh --publish-gate --target-version "\$\{RELEASE_TAG#v\}"/g,
    ) ?? [];
    assert.ok(
      gateInvocations.length >= 2,
      `publish workflow must run --publish-gate on both the rerun (already_published == 'true') and first-publish (already_published != 'true') paths; found ${gateInvocations.length} invocation(s). Removing either step would let publish automation fall back to a weaker preflight than the shell script advertises.`,
    );
  });

  it('publish workflow rerun path gates on already_published == true and runs --publish-gate', () => {
    const workflow = read('.github/workflows/publish-npm-on-tag.yml');
    // Re-verify tagged release before postflight step must exist AND be conditioned on already_published == 'true' AND run --publish-gate.
    const rerunBlock = workflow.match(
      /- name: Re-verify tagged release before postflight\s+if: steps\.registry\.outputs\.already_published == 'true'\s+working-directory: cli\s+shell: bash\s+run: bash scripts\/release-preflight\.sh --publish-gate --target-version "\$\{RELEASE_TAG#v\}"/,
    );
    assert.ok(
      rerunBlock,
      'rerun path (already_published == \'true\') must re-verify via release-preflight.sh --publish-gate before the postflight/downstream verification steps. Without this gate, a re-run of the publish workflow on an existing tag would proceed to downstream truth without re-proving claim-reality against any source changes that landed after the original publish.',
    );
  });

  it('publish workflow first-publish path gates on already_published != true and runs --publish-gate before publish', () => {
    const workflow = read('.github/workflows/publish-npm-on-tag.yml');
    const firstPublishGateBlock = workflow.match(
      /- name: Re-verify tagged release before publish\s+if: steps\.registry\.outputs\.already_published != 'true'\s+working-directory: cli\s+shell: bash\s+run: bash scripts\/release-preflight\.sh --publish-gate --target-version "\$\{RELEASE_TAG#v\}"/,
    );
    assert.ok(
      firstPublishGateBlock,
      'first-publish path (already_published != \'true\') must run release-preflight.sh --publish-gate immediately before publish-from-tag.sh. Dropping this step would let publish-from-tag.sh --skip-preflight proceed with no gate at all.',
    );
  });

  it('publish workflow runs the gate BEFORE publish-from-tag.sh (positional)', () => {
    const workflow = read('.github/workflows/publish-npm-on-tag.yml');
    const firstPublishGateIdx = workflow.indexOf(
      'Re-verify tagged release before publish',
    );
    const publishStepIdx = workflow.indexOf(
      'bash scripts/publish-from-tag.sh --skip-preflight',
    );
    assert.ok(firstPublishGateIdx > -1, 'first-publish gate step must exist');
    assert.ok(publishStepIdx > -1, 'publish-from-tag.sh step must exist');
    assert.ok(
      firstPublishGateIdx < publishStepIdx,
      'release-preflight.sh --publish-gate must run BEFORE publish-from-tag.sh --skip-preflight. Reordering would mean the --skip-preflight flag runs with no prior gate, bypassing the entire claim-reality/beta-scenario lane.',
    );
  });

  it('publish workflow does not contain an alternate npm publish path that bypasses the gate', () => {
    const workflow = read('.github/workflows/publish-npm-on-tag.yml');
    // The only npm publish invocation must flow through publish-from-tag.sh, which
    // --skip-preflight is only safe because the gate step ran just before.
    // Raw `npm publish` or `npm exec -- npm publish` steps would bypass the gate entirely.
    assert.doesNotMatch(
      workflow,
      /^\s*run:\s*npm publish/m,
      'publish workflow must not contain a bare `npm publish` step. All publish must route through cli/scripts/publish-from-tag.sh which is gated by the preceding release-preflight.sh --publish-gate step.',
    );
    assert.doesNotMatch(
      workflow,
      /npm exec[^\n]*npm publish/,
      'publish workflow must not route publish through `npm exec` to bypass publish-from-tag.sh.',
    );
  });

  it('publish-npm.sh helper script runs --publish-gate before npm publish', () => {
    // WAYS-OF-WORKING section 9 prohibits bypassing the publish gate with manual
    // npm publish. `cli/scripts/publish-npm.sh` is documented in RELEASE_CUT_SPEC
    // as a non-canonical helper, but it must not drop below the same
    // release-boundary proof surface the canonical workflow enforces. Without
    // this lock, an operator running `npm run publish:npm` would publish a
    // tarball that never ran claim-reality-preflight / beta-tester scenarios.
    const script = read('cli/scripts/publish-npm.sh');
    const gateIdx = script.indexOf('bash scripts/release-preflight.sh --publish-gate');
    const publishIdx = script.indexOf('npm publish --access public');
    assert.ok(
      gateIdx > -1,
      'publish-npm.sh must invoke release-preflight.sh --publish-gate. Bare `npm publish` from this helper would bypass claim-reality/beta-tester packaged proof. Set ALLOW_PUBLISH_GATE_BYPASS=1 is the documented escape hatch for operator-owned manual proof.',
    );
    assert.ok(
      publishIdx > -1,
      'publish-npm.sh must still reach `npm publish --access public` (the helper is a publish path)',
    );
    assert.ok(
      gateIdx < publishIdx,
      'publish-npm.sh must run --publish-gate BEFORE `npm publish --access public`. Ordering matters: running the gate after publish is fake coverage.',
    );
    assert.match(
      script,
      /--target-version "\$\{NEW_VERSION\}"/,
      'publish-npm.sh must pass the bumped NEW_VERSION as --target-version so the gate validates alignment against the actual version being published.',
    );
  });

  it('publish workflow --skip-preflight is only used when paired with a prior --publish-gate step', () => {
    const workflow = read('.github/workflows/publish-npm-on-tag.yml');
    const skipPreflightIndices = [];
    const skipRegex = /publish-from-tag\.sh --skip-preflight/g;
    let skipMatch;
    while ((skipMatch = skipRegex.exec(workflow)) !== null) {
      skipPreflightIndices.push(skipMatch.index);
    }
    assert.ok(
      skipPreflightIndices.length >= 1,
      '--skip-preflight invocation of publish-from-tag.sh must exist (the workflow owns tagged-state verification via the preceding --publish-gate step).',
    );
    for (const idx of skipPreflightIndices) {
      const upstream = workflow.slice(0, idx);
      assert.match(
        upstream,
        /bash scripts\/release-preflight\.sh --publish-gate --target-version "\$\{RELEASE_TAG#v\}"/,
        'every publish-from-tag.sh --skip-preflight invocation must be preceded by a release-preflight.sh --publish-gate step in the same workflow. Otherwise --skip-preflight silently downgrades the release boundary.',
      );
    }
  });

  it('cli package exposes the documented postflight script alias', () => {
    const pkg = JSON.parse(read('cli/package.json'));
    assert.equal(pkg.scripts['postflight:release'], 'bash scripts/release-postflight.sh');
  });

  it('release docs do not regress to the ambiguous npx shorthand', () => {
    const playbook = read('.planning/RELEASE_PLAYBOOK.md');
    const launchBrief = read('.planning/LAUNCH_BRIEF.md');
    const changelog = read('cli/CHANGELOG.md');
    const release240 = read('website-v2/docs/releases/v2-24-0.mdx');
    const release241 = read('website-v2/docs/releases/v2-24-1.mdx');

    assert.match(playbook, /npx --yes -p agentxchain@<semver> -c "agentxchain --version"/);
    assert.doesNotMatch(playbook, /npx agentxchain@<semver> --version/);

    assert.match(launchBrief, /npm exec --yes --package=agentxchain@<target> -- agentxchain --version/);
    assert.doesNotMatch(launchBrief, /npx agentxchain@<target> --version/);

    assert.match(changelog, /npx --yes -p agentxchain@<version> -c "agentxchain --version"/);
    assert.doesNotMatch(changelog, /npx --yes agentxchain@<version> --version/);

    assert.match(release240, /npx --yes -p agentxchain@<version> -c "agentxchain --version"/);
    assert.doesNotMatch(release240, /npx --yes agentxchain@<version> --version/);

    assert.match(release241, /npx --yes -p agentxchain@<version> -c "agentxchain --version"/);
    assert.doesNotMatch(release241, /npx --yes agentxchain@<version> --version/);
  });

  it('historical release notes do not understate the live adapters contract', () => {
    const spec = read('.planning/HISTORICAL_ADAPTER_LINK_TRUTH_SPEC.md');
    const release240 = read('website-v2/docs/releases/v2-24-0.mdx');
    const release241 = read('website-v2/docs/releases/v2-24-1.mdx');
    const expectedLine =
      /See \[Adapters\]\(\/docs\/adapters\) for the current runtime contract across all five shipped adapter paths \(`manual`, `local_cli`, `api_proxy`, `mcp`, `remote_agent`\)\./;
    const staleSubset = /manual, local CLI, API-backed, and MCP paths/;

    assert.match(spec, /AT-HALT-001/);
    assert.match(spec, /AT-HALT-002/);
    assert.match(spec, /AT-HALT-003/);

    assert.match(release240, expectedLine);
    assert.doesNotMatch(release240, staleSubset);

    assert.match(release241, expectedLine);
    assert.doesNotMatch(release241, staleSubset);
  });

  // -- BUG-44/45/46 spec status must include tester-verification caveat (AT-BSC-001) --

  const bugSpecsMustSayOpen = [
    { file: '.planning/BUG_44_PHASE_SCOPED_INTENT_RETIREMENT_SPEC.md', bug: 'BUG-44' },
    { file: '.planning/BUG_45_RETAINED_TURN_INTENT_RECONCILIATION_SPEC.md', bug: 'BUG-45' },
    { file: '.planning/BUG_46_PACKAGED_CLAIM_REALITY_SPEC.md', bug: 'BUG-46' },
    { file: '.planning/BUG_46_VERIFICATION_PRODUCED_FILES_SPEC.md', bug: 'BUG-46 (produced_files)' },
    { file: '.planning/AUTHORITATIVE_LOCAL_CLI_ROLE_PROOF_SPEC.md', bug: 'BUG-46 (role proof)' },
  ];

  for (const { file, bug } of bugSpecsMustSayOpen) {
    it(`${file.split('/').pop()} status includes tester-verification caveat (${bug})`, () => {
      const content = read(file);
      assert.match(content, /Status:.*[Ss]hipped/i,
        `${bug} spec must be marked shipped`);
      assert.match(content, /tester verification|pending.*rule.*#?12/i,
        `${bug} spec status must include tester-verification caveat — bare "shipped" without the caveat implies closure`);
    });
  }

  const bugReleaseDocsMustSayOpenInIntro = [
    { file: 'website-v2/docs/releases/v2-139-0.mdx', bug: 'BUG-44' },
    { file: 'website-v2/docs/releases/v2-140-0.mdx', bug: 'BUG-45' },
    { file: 'website-v2/docs/releases/v2-141-1.mdx', bug: 'BUG-46' },
    { file: 'website-v2/docs/releases/v2-142-0.mdx', bug: 'BUG-46 hardening' },
    { file: 'website-v2/docs/releases/v2-143-0.mdx', bug: 'BUG-44/45/46 status carry-forward' },
  ];

  for (const { file, bug } of bugReleaseDocsMustSayOpenInIntro) {
    it(`${file.split('/').pop()} intro keeps ${bug} open pending tester verification`, () => {
      const intro = read(file).split('\n## ')[0];
      assert.match(intro, /tester verification|pending.*rule.*#?12/i,
        `${bug} release-note intro must include the tester-verification caveat because Docusaurus uses the intro paragraph for description metadata`);
    });
  }

  // -- BUG-47/51 schedule-recovery contract: historical release notes that
  // describe the schedule daemon's blocked-run behavior must not present
  // `agentxchain unblock <id>` as the universal recovery command. Post-
  // BUG-47/51, schedule daemon JSON propagates `recovery_action` and
  // `blocked_category`, and ghost/stale turns require `reissue-turn` not
  // `unblock`. (`DEC-BUG51-SCHEDULE-DOC-RECOVERY-001`,
  // `DEC-BUG51-CONTINUOUS-DOC-RECOVERY-001`)
  it('v2.117.0 release note clarifies that unblock is not universal for blocked schedule daemon runs (BUG-47/51 schedule-recovery contract)', () => {
    const release = read('website-v2/docs/releases/v2-117-0.mdx');
    assert.match(release, /Scheduler Auto-Resume on Unblock/,
      'v2.117.0 must still document the auto-resume feature historically');
    assert.match(release, /reissue-turn --reason ghost/,
      'v2.117.0 must reference reissue-turn --reason ghost (BUG-51) in the post-release recovery note');
    assert.match(release, /reissue-turn --reason stale/,
      'v2.117.0 must reference reissue-turn --reason stale (BUG-47) in the post-release recovery note');
    assert.match(release, /recovery_action/,
      'v2.117.0 must reference the surfaced recovery_action contract');
    assert.match(release, /blocked_category/,
      'v2.117.0 must reference the surfaced blocked_category contract');
    assert.match(release, /needs_human/,
      'v2.117.0 must scope unblock <id> to needs_human blockers');
    assert.match(release, /DEC-BUG51-SCHEDULE-DOC-RECOVERY-001/,
      'v2.117.0 must cite the binding decision');
    assert.doesNotMatch(
      release,
      /After `agentxchain unblock <id>`, the daemon continues the same schedule-owned run within one poll interval without requiring a separate operator command\./,
      'v2.117.0 must not regress to the universal-unblock wording — must read "After the operator runs the surfaced recovery command,..."',
    );
  });

  it('CHANGELOG v2.117.0 entry clarifies that unblock is not universal for blocked schedule daemon runs (BUG-47/51 schedule-recovery contract)', () => {
    const changelog = read('cli/CHANGELOG.md');
    // Locate the v2.117.0 section — `## 2.117.0` headline through the next `## ` headline.
    const match = changelog.match(/## 2\.117\.0\b[\s\S]*?(?=\n## )/);
    assert.ok(match, 'CHANGELOG must contain a v2.117.0 section');
    const section = match[0];
    assert.match(section, /Scheduler auto-resume on unblock/,
      'v2.117.0 changelog must still document the auto-resume feature historically');
    assert.match(section, /reissue-turn --reason ghost/,
      'v2.117.0 changelog must reference reissue-turn --reason ghost (BUG-51) in the post-release recovery note');
    assert.match(section, /reissue-turn --reason stale/,
      'v2.117.0 changelog must reference reissue-turn --reason stale (BUG-47) in the post-release recovery note');
    assert.match(section, /recovery_action/,
      'v2.117.0 changelog must reference the surfaced recovery_action contract');
    assert.match(section, /blocked_category/,
      'v2.117.0 changelog must reference the surfaced blocked_category contract');
    assert.match(section, /needs_human/,
      'v2.117.0 changelog must scope unblock <id> to needs_human blockers');
    assert.match(section, /DEC-BUG51-SCHEDULE-DOC-RECOVERY-001/,
      'v2.117.0 changelog must cite the binding decision');
    assert.doesNotMatch(
      section,
      /After `agentxchain unblock <id>`, the daemon continues within one poll interval \(`DEC-SCHEDULE-DAEMON-UNBLOCK-001`\)$/m,
      'v2.117.0 changelog must not regress to the universal-unblock wording',
    );
  });

  it('historical release notes do not present the live quickstart alias as a frozen historical route', () => {
    const spec = read('.planning/HISTORICAL_QUICKSTART_LINK_TRUTH_SPEC.md');
    const release213 = read('website-v2/docs/releases/v2-13-0.mdx');
    const staleHistoricalizedAlias =
      /was already shipped under `\/docs\/quickstart#multi-repo-cold-start`/;
    const currentWalkthroughLine =
      /See \[Quickstart\]\(\/docs\/quickstart#multi-repo-cold-start\) for the current multi-repo cold-start walkthrough\./;

    assert.match(spec, /AT-HQLT-001/);
    assert.match(spec, /AT-HQLT-002/);
    assert.match(spec, /AT-HQLT-003/);

    assert.doesNotMatch(release213, staleHistoricalizedAlias);
    assert.match(release213, currentWalkthroughLine);
  });
});
