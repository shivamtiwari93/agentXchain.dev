# PM Signoff — Release v2.155.73 to npm and Homebrew

Approved: YES

**Run:** `run_ada69e8852f7487d`
**Phase:** planning
**Turn:** `turn_0ea48581670cf4c2`
**Date:** 2026-05-02

## Discovery Checklist
- [x] Target user defined
- [x] Core pain point defined
- [x] Core workflow defined
- [x] MVP scope defined
- [x] Out-of-scope list defined
- [x] Success metric defined

### Target User

AgentXchain operators and downstream consumers who install via `npm install -g agentxchain` or `brew install shivamtiwari93/tap/agentxchain`. 185+ commits have accumulated since v2.155.72 (2026-04-30) with significant recovery, resilience, and observability improvements that are not yet available on the public registry.

### Core Pain Point

v2.155.72 is published but does not include the recovery classification system, PID liveness guard for crash resume, ghost blocker session checkpoint fix, configurable per-turn deadlines, or intake persistence. Users running governed sessions encounter these issues without the fixes unless they build from source.

### Root Cause

Normal release cadence gap — 186 commits (806 files, 9,336 insertions, 1,928 deletions) accumulated since the v2.155.72 tag without a release cut.

### Core Workflow

1. **PM (this turn)** — Charters dev with the pre-publish release prep sequence, using the established `release-bump.sh` (not raw `npm version patch`)
2. **Dev** — Prepares all 14 release-alignment surfaces (CHANGELOG, release notes, version refs, marketing drafts), then runs `release-bump.sh` to create local release identity (commit + annotated tag)
3. **QA** — Verifies release identity is correct: tag exists, package.json shows 2.155.73, CHANGELOG is accurate, preflight passes
4. **Human** — Pushes tag (`git push origin main --follow-tags`), waits for CI (`publish-npm-on-tag.yml`), runs post-publish verification and marketing

### MVP Scope (this run)

**PM deliverables (this turn):**
1. PM_SIGNOFF.md: Release planning with dev charter
2. SYSTEM_SPEC.md: Release specification with file-level scope for all 14 alignment surfaces + release-bump.sh execution
3. ROADMAP.md: Phases table updated for release run

**Dev deliverables:**
1. CHANGELOG.md entry for v2.155.73 (aggregate evidence line required)
2. Release notes page: `website-v2/docs/releases/v2-155-73.mdx`
3. All 14 release-alignment surfaces updated to reference v2.155.73
4. Run `release-bump.sh --target-version 2.155.73` (creates commit + tag + runs inline preflight)

**Human deliverables (post-QA):**
1. `git push origin main --follow-tags` (triggers CI publish)
2. Wait for `publish-npm-on-tag.yml` to complete
3. `bash cli/scripts/verify-post-publish.sh --target-version 2.155.73`
4. `bash marketing/post-release.sh "v2.155.73" "Recovery classification, crash resume PID guard, ghost blocker fix, configurable deadlines"`

### Out of Scope

- Running `npm publish` manually (CI-only trusted publishing)
- Code changes — this is a release cut, all features are already merged
- Homebrew SHA update (handled automatically by CI workflow and sync-homebrew.sh)
- Creating the GitHub Release (handled by CI workflow)
- Any feature work from ROADMAP.md M5+ milestones

### Success Metric

Maps directly to the acceptance contract:

| # | Acceptance Item | Verified By | Owner |
|---|----------------|-------------|-------|
| 1 | `npm view agentxchain version` returns `2.155.73` | CI publish-npm-on-tag.yml + human `npm view` check | CI + Human |
| 2 | Homebrew formula updated with correct SHA | CI sync-homebrew.sh step + verify-post-publish.sh step 3 | CI + Human |
| 3 | `verify-post-publish.sh` passes | Human runs `bash cli/scripts/verify-post-publish.sh --target-version 2.155.73` | Human |
| 4 | Release notes posted to social channels | Human runs `bash marketing/post-release.sh` | Human |

**Items 1-3 cannot be verified until after CI completes.** Dev's responsibility ends at creating a correct local release identity. QA validates the pre-publish state. Human handles push and post-publish verification.

### Risk Assessment

| Risk | Severity | Mitigation |
|------|----------|------------|
| Release-alignment surfaces are stale | Medium | `check-release-alignment.mjs` gates release-bump.sh — 14 surfaces must be updated first |
| Test suite failure during inline preflight | Medium | Dev runs full suite before bump; release-bump.sh re-runs as gate |
| CI publish fails | Low | publish-npm-on-tag.yml has retry logic and idempotent re-run support |
| Homebrew tap push fails (missing HOMEBREW_TAP_TOKEN) | Low | CI checks token availability before first publish; canonical tap push is gated |
| Marketing post fails (missing API tokens) | Low | post-release.sh reports per-channel pass/fail; partial success is acceptable |

## Challenge to Previous Work

### OBJ-PM-001: Previous planning artifacts describe a different feature (severity: high)

PM_SIGNOFF.md, SYSTEM_SPEC.md, and ROADMAP.md Phases table all describe "M4: Checkpoint-Restore Verification" from run `run_da40a332eed44f56`. This run's intent is a release cut for v2.155.73. All three artifacts have been rewritten from scratch.

### OBJ-PM-002: Intent's release sequence is simplified vs established infrastructure (severity: medium)

The intent prescribes `cd cli && npm version patch` + manual `git tag v2.155.73`. The codebase has `release-bump.sh` with 10 steps: tree validation, release-alignment check, Homebrew auto-alignment, version bump, commit creation, inline preflight (tests + pack + docs build), and annotated tag creation. Dev charter uses release-bump.sh to get the full safety net.

### OBJ-PM-003: Post-publish acceptance items require human action (severity: medium)

Acceptance items 1-4 all require the tag to be pushed to remote and CI to complete. Dev and QA can only verify pre-publish correctness. The turn result will explicitly note which acceptance items are human-gated.

## Notes for Dev

**Your charter is release prep + release-bump.sh execution. No code changes.**

1. **Update all 14 release-alignment surfaces** per SYSTEM_SPEC.md Section 2. The `check-release-alignment.mjs --scope prebump --target-version 2.155.73` command must report 0 needing update before release-bump.sh will succeed.

2. **Run `bash cli/scripts/release-bump.sh --target-version 2.155.73 --coauthored-by "Claude Opus 4.6 <noreply@anthropic.com>"`** which will:
   - Validate tree state (only allowed release paths dirty)
   - Check release alignment (all 14 surfaces)
   - Auto-align Homebrew mirror URL (SHA carried from previous version — post-publish truth)
   - Bump package.json + package-lock.json to 2.155.73
   - Create release commit with message `2.155.73`
   - Run inline preflight: full test suite + npm pack dry-run + docs build
   - Create annotated tag `v2.155.73`

3. **Do NOT push to remote.** That is a human action after QA approval.

4. **Key features to highlight in CHANGELOG and release notes:**
   - Recovery classification system (emitRunEvent enrichment + governance report rendering)
   - PID liveness guard for crash resume (`step --resume` rejects alive workers)
   - Ghost blocker session checkpoint fix (clearGhostBlockerAfterReissue persistence)
   - Configurable per-turn deadline (dispatch timeout from per_turn_minutes)
   - Intake persistence (intent/event intake survives restarts)
   - Claude Node incompatibility recovery (BUG-113)
   - Claude auth refreshed recovery (BUG-114)
   - Claude provider timeout recovery (BUG-112)
   - Retained Claude auth reclassification (BUG-111)
   - DOGFOOD-100 shipped npx entrypoint

## Notes for QA

- Verify `v2.155.73` tag exists locally: `git rev-parse v2.155.73`
- Verify tag is annotated: `git cat-file -t v2.155.73` should be `tag`
- Verify package.json shows `2.155.73`
- Verify CHANGELOG.md has `## 2.155.73` with aggregate evidence line
- Verify release notes page exists at `website-v2/docs/releases/v2-155-73.mdx`
- Verify `check-release-alignment.mjs --scope prebump --target-version 2.155.73` reports 0 needing update
- Verify `npm run test` passes (release-bump.sh already ran this, but QA should re-verify)
- **Do NOT push to remote** — that is human-gated

## Acceptance Contract

1. **npm view returns 2.155.73** — Human-gated: requires push + CI. Dev creates correct local release identity.
2. **Homebrew formula updated with correct SHA** — Human-gated: requires post-publish sync. Dev's release-bump auto-aligns URL; SHA is post-publish truth.
3. **verify-post-publish.sh passes** — Human-gated: requires npm publish to have completed. Dev ensures script exists and pre-publish state is correct.
4. **Release notes posted to social channels** — Human-gated: `marketing/post-release.sh` requires API tokens. Dev ensures marketing drafts are updated.
