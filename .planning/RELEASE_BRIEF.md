# Release Brief — AgentXchain Governed CLI v1.1.0

Purpose: give Shivam a single handoff document for the v1.1.0 release cut.

## Current Status

**The product and protocol work for v1.1.0 are implemented and test-backed, but this brief is still future-facing. The immediate public release track remains `1.0.0` until that cut is complete and the operator intentionally starts a `1.1.0` release candidate cycle.**

- Normative v1.1 spec: **complete** (`SPEC-GOVERNED-v5.md`)
- Frozen v1.1 release gate: **complete** (`V1_1_RELEASE_CHECKLIST.md`)
- Governed CLI surface spec: **complete** (`.planning/CLI_SPEC.md`)
- README upgrade and operator guidance: **complete**
- `cli/CHANGELOG.md` `1.1.0` delta entry: **complete**
- Remaining autonomous release-prep gap before a real `1.1.0` cut: **none**
- Remaining human work for today: **the active release path is still the `1.0.0` cut in `.planning/HUMAN_TASKS.md`**

## What v1.1.0 Ships

v1.1.0 graduates exactly five already-implemented features:

1. Parallel governed turns
2. `api_proxy` auto-retry with backoff
3. Preemptive tokenization
4. Anthropic-specific provider error mapping
5. Persistent blocked state

Compatibility contract:

- v1.0 sequential behavior remains the default
- `max_concurrent_turns = 1` preserves the single-turn flow
- retry and preflight remain opt-in
- provider mapping and blocked-state visibility are automatic improvements
- v1.1 reads and migrates v1.0 state, but v1.0 does not read v1.1 state

## Release Readiness Snapshot

From the current planning state:

- Feature implementation: **complete**
- Automated acceptance matrix: **mapped and green**
- `1.1.0` human handoff sequencing: **defined** (`V1_1_RELEASE_HANDOFF_SPEC.md`)
- Normative/operator docs:
  - `SPEC-GOVERNED-v5.md`: done
  - `.planning/CLI_SPEC.md`: done
  - `README.md`: done
  - `.planning/RELEASE_BRIEF.md`: reconciled
  - `cli/CHANGELOG.md`: done
- Release-preflight retargeting for `1.1.0`: **complete** (`--target-version <semver>`)
- Human-gated release execution for `1.1.0`: **future**, not the active release-day path yet

## Canonical Release Sequence

Do **not** use this sequence as the active public-release checklist until the `1.0.0` release is complete and the operator intentionally starts a `1.1.0` release candidate cycle.

```bash
cd cli

# 1. Confirm the release candidate workspace is clean
git status --short

# 2. Re-run the full test baseline from the clean workspace
npm test

# 3. Re-run release preflight against the target release
bash scripts/release-preflight.sh --target-version 1.1.0

# 4. From the clean tree, cut the version/tag (creates release commit + v1.1.0 tag)
npm version 1.1.0

# 5. Re-run strict preflight after the bump
bash scripts/release-preflight.sh --target-version 1.1.0 --strict

# 6. Push the tag to trigger automated publish
git push origin v1.1.0
# This triggers .github/workflows/publish-npm-on-tag.yml which:
#   - Checks out the tag ref (not branch head)
#   - Runs npm ci in cli/
#   - Calls scripts/publish-from-tag.sh
#   - Enforces package.json.version === tag semver
#   - Runs strict preflight before publish
#   - Publishes via temporary .npmrc (no token on CLI)
#   - Polls npm view until the registry serves the version

# 7. Verify the registry serves the published artifact (workflow does this;
#    manual fallback if workflow fails)
npm view agentxchain@1.1.0 version

# 8. Update Homebrew tap with the published tarball URL + SHA256
```

Note: `npm version 1.1.0` remains the canonical version-bump, release-commit, and tag step while `git-tag-version = true`. The push-to-publish contract is: human owns the version identity (`npm version`); CI owns the publish execution (`publish-npm-on-tag.yml`). See DEC-RELEASE-AUTO-001.

## Non-Gating Validation Track

Scenario D live escalation dogfood remains valuable, but it is **not** a hard v1.1 release gate. Product correctness is already covered by automated specs and tests; Scenario D is post-release operator-validation evidence.

## Where To Look

| Artifact | Purpose |
|----------|---------|
| [`SPEC-GOVERNED-v5.md`](/Users/shivamtiwari.highlevel/VS Code/1008apps/agentXchain.ai/agentXchain.dev/SPEC-GOVERNED-v5.md) | Normative v1.1 product spec |
| [`V1_1_RELEASE_SCOPE_SPEC.md`](V1_1_RELEASE_SCOPE_SPEC.md) | Frozen v1.1 scope |
| [`V1_1_RELEASE_CHECKLIST.md`](V1_1_RELEASE_CHECKLIST.md) | Acceptance gate |
| [`V1_1_RELEASE_HANDOFF_SPEC.md`](V1_1_RELEASE_HANDOFF_SPEC.md) | Sequencing rule for when the v1.1 handoff becomes actionable |
| [`HUMAN_TASKS.md`](HUMAN_TASKS.md) | Human-only tasks, including release execution |
| [`cli/CHANGELOG.md`](/Users/shivamtiwari.highlevel/VS Code/1008apps/agentXchain.ai/agentXchain.dev/cli/CHANGELOG.md) | Completed v1.1 delta entry |
| [`cli/scripts/release-preflight.sh`](/Users/shivamtiwari.highlevel/VS Code/1008apps/agentXchain.ai/agentXchain.dev/cli/scripts/release-preflight.sh) | One-command release check |
| [`SCENARIO_D_ESCALATION_DOGFOOD_SPEC.md`](SCENARIO_D_ESCALATION_DOGFOOD_SPEC.md) | Non-gating live validation track |
| [`vision-discussion.md`](vision-discussion.md) | Full collaboration record |
