# System Spec — Release v2.155.73 to npm and Homebrew

**Run:** `run_ada69e8852f7487d`
**Baseline:** git:eb39a38fa (HEAD at planning start)
**Package version:** `agentxchain@2.155.72` (pre-bump)
**Target version:** `agentxchain@2.155.73`

## Purpose

Cut release v2.155.73 from the current main branch. 186 commits (806 files, 9,336 insertions, 1,928 deletions) have accumulated since v2.155.72 (2026-04-30). This is a release-only run — no code changes, only version surface updates and release identity creation.

**Key changes shipping in v2.155.73:**
- Recovery classification system — structured event enrichment + governance report rendering (M4/ROADMAP:61)
- PID liveness guard for crash resume — `step --resume` rejects alive workers, cleans stale dispatch-progress (M4/ROADMAP:62)
- Ghost blocker session checkpoint fix — `clearGhostBlockerAfterReissue` persistence + main loop recovery guard (BUG-FIX)
- Configurable per-turn deadline — dispatch timeout sourced from `per_turn_minutes` config (M1)
- Intake persistence — intent/event intake survives restarts
- Claude Node incompatibility recovery (BUG-113)
- Claude auth refreshed recovery (BUG-114)
- Claude provider timeout recovery (BUG-112)
- Retained Claude auth reclassification (BUG-111)
- DOGFOOD-100 shipped npx entrypoint + credential smoke helper

---

## 1. Release Sequence Overview

The release uses the established `release-bump.sh` script (not raw `npm version patch`) and the CI-based `publish-npm-on-tag.yml` workflow (not manual `npm publish`).

| Step | Command | Owner | Phase |
|------|---------|-------|-------|
| 1 | Update 14 release-alignment surfaces | Dev | Pre-publish |
| 2 | `bash cli/scripts/release-bump.sh --target-version 2.155.73 --coauthored-by "Claude Opus 4.6 <noreply@anthropic.com>"` | Dev | Pre-publish |
| 3 | QA verification of local release identity | QA | Pre-publish |
| 4 | `git push origin main --follow-tags` | Human | Publish trigger |
| 5 | Wait for `publish-npm-on-tag.yml` CI | CI | Publish |
| 6 | `npm view agentxchain version` → `2.155.73` | Human | Post-publish |
| 7 | `bash cli/scripts/verify-post-publish.sh --target-version 2.155.73` | Human | Post-publish |
| 8 | `bash marketing/post-release.sh "v2.155.73" "Recovery classification, crash resume PID guard, ghost blocker fix, configurable deadlines"` | Human | Post-publish |

Steps 1-3 are dev/QA scope. Steps 4-8 are human-gated.

---

## 2. Release-Alignment Surfaces (Dev Scope)

The `check-release-alignment.mjs --scope prebump --target-version 2.155.73` reports 14 surfaces needing update. Dev must update all of them before `release-bump.sh` will succeed.

### 2.1 CHANGELOG Entry (required, gates preflight)

**File:** `cli/CHANGELOG.md`
**Action:** Prepend a `## 2.155.73` section at the top of the file (above `## 2.155.72`).

Content must include:
- Bullet points for key features (recovery classification, PID liveness guard, ghost blocker fix, configurable deadlines, intake persistence, BUG-111 through BUG-114, DOGFOOD-100 npx entrypoint)
- Aggregate evidence line matching the test suite output format: `npm test -- --test-timeout=60000 -> NNNN tests / NNNN suites / 0 failures / N skipped`
- Dev must run the full test suite to get the current counts

### 2.2 Release Notes Page (required, gates alignment)

**File:** `website-v2/docs/releases/v2-155-73.mdx`
**Action:** Create new file following the template from `v2-155-72.mdx`.

Required structure:
```
---
sidebar_position: 0
title: "v2.155.73 Release Notes"
---

# AgentXchain v2.155.73

<summary paragraph>

## What's New
<feature highlights>

## Bug Fixes
<bug fix highlights>

## Evidence
<test suite aggregate line>

## Tester Re-Run Contract
Verify: `npx --yes -p agentxchain@2.155.73 -c "agentxchain --version"`
```

### 2.3 Version Reference Surfaces (12 files)

| Surface | File | What to Update |
|---------|------|----------------|
| Homepage badge | `website-v2/src/pages/index.tsx` | Version badge → `v2.155.73` |
| Homepage proof stat | `website-v2/src/pages/index.tsx` | Test count stat (after CHANGELOG is updated) |
| Capabilities | `.agentxchain-conformance/capabilities.json` | `"version": "2.155.73"` |
| Implementor guide | `website-v2/docs/protocol-implementor-guide.mdx` | `"version": "2.155.73"` |
| Launch evidence | `.planning/LAUNCH_EVIDENCE_REPORT.md` | Title → `v2.155.73` |
| Show HN draft | `.planning/SHOW_HN_DRAFT.md` | Version ref → `v2.155.73` |
| Twitter thread | `.planning/MARKETING/TWITTER_THREAD.md` | Version ref → `v2.155.73` |
| LinkedIn post | `.planning/MARKETING/LINKEDIN_POST.md` | Version ref → `v2.155.73` |
| Reddit posts | `.planning/MARKETING/REDDIT_POSTS.md` | Version ref → `v2.155.73` |
| HN submission | `.planning/MARKETING/HN_SUBMISSION.md` | Version ref → `v2.155.73` |
| llms.txt | `website-v2/static/llms.txt` | Add `/docs/releases/v2-155-73` route |
| Onboarding docs | `website-v2/docs/getting-started.mdx`, `quickstart.mdx`, `five-minute-tutorial.mdx` | `Minimum CLI version: \`agentxchain 2.155.73\` or newer` |

### 2.4 Homebrew Mirror (auto-aligned by release-bump.sh)

**Files:** `cli/homebrew/agentxchain.rb`, `cli/homebrew/README.md`
**Action:** Dev does NOT manually edit these. `release-bump.sh` step 6 auto-aligns the URL to the expected registry tarball path and carries the previous version's SHA (post-publish truth — the real SHA is set by `sync-homebrew.sh` after npm publish).

---

## 3. Release Identity Creation (Dev Scope)

After all 14 alignment surfaces are updated, dev runs:

```bash
cd cli
bash scripts/release-bump.sh \
  --target-version 2.155.73 \
  --coauthored-by "Claude Opus 4.6 <noreply@anthropic.com>"
```

This script executes 10 steps:
1. Check current version (2.155.72 → 2.155.73)
2. Assert only allowed release-surface dirt is present
3. Assert tag `v2.155.73` does not exist
4. Verify release alignment via `check-release-alignment.mjs --scope prebump`
5. Normalize release-note sidebar positions
6. Auto-align Homebrew mirror to 2.155.73 (URL + carried SHA)
7. Update package.json + package-lock.json to 2.155.73
8. Stage version files + allowed release surfaces
9. Create release commit with message `2.155.73` + Co-Authored-By trailer
9.5. Run inline preflight: full test suite + npm pack dry-run + docs build
10. Create annotated tag `v2.155.73`

**Exit state:** Local repo has an annotated `v2.155.73` tag on a release commit. NOT pushed.

---

## 4. CI Publish Workflow (Human-Triggered)

After QA approval, human pushes: `git push origin main --follow-tags`

This triggers `.github/workflows/publish-npm-on-tag.yml` which:
1. Checks out the tagged commit
2. Detects if already published (idempotent re-run)
3. Verifies canonical tap readiness (HOMEBREW_TAP_TOKEN)
4. Runs release-preflight.sh --publish-gate
5. Records runner-local pack SHA (diagnostic)
6. Runs `publish-from-tag.sh` → npm publish
7. Runs `release-postflight.sh` → verifies npm serves the version
8. Compares pack SHA to registry (diagnostic)
9. Runs `sync-homebrew.sh --push-tap` → updates canonical Homebrew tap
10. Commits Homebrew mirror updates (direct push or fallback)
11. Creates GitHub Release with rendered release body
12. Runs `release-downstream-truth.sh` → verifies all downstream surfaces

---

## 5. Post-Publish Verification (Human Scope)

After CI completes, human runs:

```bash
# Verify npm serves the version
npm view agentxchain version  # → 2.155.73

# Full post-publish verification (5 steps: npm check, Homebrew sync, mirror SHA match, npx smoke, full test suite)
cd cli && bash scripts/verify-post-publish.sh --target-version 2.155.73

# Post to social channels
bash marketing/post-release.sh "v2.155.73" "Recovery classification, crash resume PID guard, ghost blocker fix, configurable deadlines"
```

---

## Interface

### No New Exports

This is a release-only run. No new code, APIs, or behavioral changes.

### Behavioral Contract

The published `agentxchain@2.155.73` package includes all commits from v2.155.72..HEAD. The Homebrew formula at `shivamtiwari93/homebrew-tap` serves the same version with the correct SHA256.

---

## Dev Charter

### Scope

**Phase 1: Run full test suite (pre-alignment baseline)**
```bash
cd cli && npm test
```
Record test count (files, tests, failures) for the CHANGELOG aggregate evidence line.

**Phase 2: Update release-alignment surfaces**

Update all 14 surfaces listed in Section 2. The key deliverables are:
1. `cli/CHANGELOG.md` — New `## 2.155.73` section with feature bullets + aggregate evidence
2. `website-v2/docs/releases/v2-155-73.mdx` — New release notes page
3. 12 version-reference files — Update version strings from 2.155.72 → 2.155.73

**Phase 3: Verify alignment**
```bash
cd cli && node scripts/check-release-alignment.mjs --scope prebump --target-version 2.155.73
```
Must report 0 needing update.

**Phase 4: Run release-bump.sh**
```bash
cd cli && bash scripts/release-bump.sh \
  --target-version 2.155.73 \
  --coauthored-by "Claude Opus 4.6 <noreply@anthropic.com>"
```
Must exit 0. Creates commit + annotated tag.

**Phase 5: Verify local release identity**
```bash
git rev-parse v2.155.73          # tag exists
git cat-file -t v2.155.73        # "tag" (annotated)
node -e "console.log(JSON.parse(require('fs').readFileSync('cli/package.json','utf8')).version)"  # "2.155.73"
```

### Out of Scope

- Pushing to remote (human-gated)
- Running `npm publish` (CI-only)
- Post-publish verification (human-gated)
- Marketing posts (human-gated)
- Any code changes beyond release-surface version bumps
- Homebrew SHA update (post-publish truth, auto-handled by CI)

### Verification

Dev must confirm:
1. `check-release-alignment.mjs` reports 0 needing update
2. `release-bump.sh` exits 0 (includes inline preflight: tests + pack + docs build)
3. Tag `v2.155.73` exists locally as an annotated tag
4. package.json version is `2.155.73`

## Acceptance Tests

- [ ] CHANGELOG.md has `## 2.155.73` section with aggregate evidence line showing 0 failures
- [ ] Release notes page exists at `website-v2/docs/releases/v2-155-73.mdx`
- [ ] `check-release-alignment.mjs --scope prebump --target-version 2.155.73` reports 0 needing update
- [ ] `release-bump.sh` exits 0 (inline preflight passed)
- [ ] Annotated tag `v2.155.73` exists locally pointing to release commit
- [ ] package.json version is `2.155.73`
