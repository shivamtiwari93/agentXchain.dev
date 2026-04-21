Status: In execution — step 1 shipped Turn 115; workflow trigger shrink and repo-accurate plan corrections shipped Turn 116.

# CI/CD Reduction Plan — Move Testing Local, Keep Only Irreducible Remote Workflows

## Purpose

Reduce the repo's GitHub Actions footprint to the minimum that **cannot** be done locally (OIDC-based npm trusted publishing, GCP docs deploy), and move everything else (tests, proofs, scanning on every commit) to local execution before the commit lands. Motivated by a specific 18-hour incident on 2026-04-20/21 that blocked the v2.149.x release cycle.

## What happened (the 2026-04-20/21 incident, in order)

1. **19:01 UTC 2026-04-20** — Turn 104 cut `v2.149.0`: package bumped, 17 release-alignment surfaces updated, tag pushed to origin. `publish-npm-on-tag.yml` fired.
2. **23:03 → 02:53 UTC** — v2.149.0 publish workflow sat queued, then picked up, then ran 3h50m total. Failed at the release-preflight step: `claim-reality-preflight.test.js` asserted `auth_preflight` warning should fire before `command_presence` on a Claude `local_cli` runtime with missing-binary-and-missing-auth. v2.149.0 had them in the wrong order. Preflight refused to publish. **The gate did its job — this was not the defect.**
3. **Turn 106** — GPT 5.4 diagnosed the ordering bug correctly, shipped the v2.149.1 hotfix (`4de3d469 fix(bug-54): auth-preflight fires before command_presence` + alignment bumps + version cut). Did NOT push the tag. Did NOT log the turn in AGENT-TALK.md. (Pre-existing pattern — same failure mode as Turn 104.)
4. **Turn 107 start** — human pushed `main` and the `v2.149.1` tag. Publish workflow fired (run `24702442866`). Entered queue.
5. **Turn 107 mid-turn** — Codex noticed publish was queued for 10+ minutes, formed the theory "queued means stuck, runner pool is contested by adjacent workflows, cancel them to free capacity." Cancelled 13 workflows including the v2.149.1 release-commit's CI + CI Runner Proof + Governed Todo App Proof + Deploy Website runs. Then cancelled the queued v2.149.1 publish and redispatched via `workflow_dispatch` (run `24702845949`). The new run also queued, because cancelling other workflows had not freed any capacity that the publish workflow could consume.
6. **Human override inserted** into `.planning/AGENT-TALK.md`: "queued ≠ stuck; concurrency groups are per-tag; runner pool is global; do not cancel; wait." Turn 107 (Claude Opus 4.7) respected it and logged the restraint.
7. **Human diagnostic pass** on GitHub state — found 52 runs queued, **19 CI runs `in_progress` from 10–14 hours ago** despite GitHub-hosted `ubuntu-latest` having a 6-hour max job duration. Zero self-hosted runners. Account is on GitHub Free. GitHub Free caps concurrent jobs at 20 per account. **The 19 zombies were holding 19 of the 20 concurrent-slot tokens.** Queue depth was not the blocker; concurrent-slot saturation was.
8. **Human cancelled the 19 zombies manually.** Within 2 minutes, the queued v2.149.1 publish (run `24702845949`) picked up a slot, ran preflight (now passing), completed trusted-publish. **v2.149.1 went live on npm.**

## Root causes

Three independent failures compounded. Each one alone is survivable; stacked they produced an 18-hour stall.

1. **Zombie-run accumulation.** GitHub-hosted runners sometimes crash or disconnect mid-job. GitHub's reaper should mark those runs `completed/cancelled` after the 6-hour timeout. In practice it doesn't reliably. 19 zombies accumulated over the 2026-04-20 agent loop (~49 push-to-main commits in 30 hours, each triggering 2–4 workflows). Zombies hold concurrent-slot tokens indefinitely until manually cancelled.
2. **Workflow density per commit.** Every push-to-main fires CI + CI Runner Proof + Governed Todo App Proof + (sometimes) CodeQL + (sometimes) Deploy Website. 49 commits × ~3.5 avg workflows = ~170 workflow runs in 30 hours. On a 20-concurrent-slot account, even without zombies this is near saturation.
3. **Agent misinterpretation of `queued` state.** Codex formed an incorrect mental model ("queued = stuck, cancel adjacent workflows to free capacity") and acted on it. Each cancel-and-redispatch cycle added a red ❌ to the tag's audit trail and did not free any concurrent-slot tokens (since the cancelled workflows were `queued`, not `in_progress` — only `in_progress` cancellations release slot tokens).

## What the agents cannot figure out from the AGENT-TALK log alone

None of the above three failure modes was covered by an existing rule or decision record. The 13 discipline rules in HUMAN-ROADMAP.md all address bug-closure correctness, not CI/CD infrastructure. `DEC-RELEASE-CUT-AND-PUSH-AS-ATOMIC-001` addresses "cut includes push," not "wait for queue honestly." `DEC-TURN-LOG-MANDATORY-ON-EXECUTION-TURNS-001` addresses logging, not diagnosis correctness.

The agents have no built-in knowledge of GitHub Free plan limits, zombie-run behavior, or per-tag concurrency semantics. They have a tendency to invent explanations when observations don't fit a simpler model ("queue is long because of contention" is simpler than "runner pool is saturated by zombies on GitHub Free"). Without infrastructure domain knowledge written into the repo, they will rediscover this class of failure on future releases.

## The shrink plan — concrete workflow changes

Goal: max 1–2 workflow runs per commit, down from ~3.5. Max 1 workflow run per release tag (publish only). Move every quality gate local.

### 1. `.github/workflows/publish-npm-on-tag.yml` — KEEP as-is

- Fires on `v*.*.*` tag push (OIDC trusted publishing requires GitHub Actions).
- Preflight + `npm publish` + post-publish verification, ~2 min runtime.
- Uses 1 concurrent-slot for 2 min per release.
- **No change.** This is the one workflow that must stay remote — npm trusted publishing is bound to the GitHub Actions OIDC provider.

### 2. `.github/workflows/ci.yml` — RESTRICT to pull_request only

**Current:** fires on `push` to main and on `pull_request`.

**Change:** remove the `push` trigger. Fire only on `pull_request` to main.

**Effect:** agent loop commits directly to main and gets no CI run per commit. Human/external contributors still get CI on their PRs. The release-cut path (agent pushes tag → publish workflow runs preflight) is unchanged.

**What we lose:** catching a regression the agent didn't catch locally. Mitigation: local prepublish-gate (§5 below) runs the same tests before tagging. Regressions can reach an untagged commit on main but cannot reach users, because users install from npm, which only exposes tagged versions.

### 3. `.github/workflows/ci-runner-proof.yml` — REMOVE

This was added at some point as a "runner is available" proof. It's redundant with CI and with the publish workflow's preflight. The existence of this workflow alone contributed ~25% of the zombie accumulation.

### 4. `.github/workflows/governed-todo-app-proof.yml` — CONVERT to schedule + release

**Current:** fires on every push to main. Long-running end-to-end proof against a real sample app.

**Change:** fire on `schedule: 0 7 * * *` (nightly UTC) + `push: tags: ['v*.*.*']`.

**Effect:** nightly regression coverage + coverage on every release. No per-commit pressure.

### 5. `.github/workflows/deploy-gcs.yml` — ADD paths filter

**Current before CICD-SHRINK:** fires on every push to main, regardless of whether any docs file changed. **Repo correction:** the actual file is `.github/workflows/deploy-gcs.yml`, not `deploy-website.yml`.

**Change:** add/keep a `paths:` filter so it only fires when `website-v2/**`, `docs/**`, or `.github/workflows/deploy-gcs.yml` itself changes.

**Effect:** agent's code-only commits don't eat docs-deploy slots. Docs-only commits still deploy automatically.

### 6. CodeQL default setup — VERIFY weekly frequency

**Repo correction:** `.github/workflows/codeql.yml` does not exist on HEAD. CodeQL is configured through GitHub default setup. Verification on 2026-04-21 returned `state=configured`, `query_suite=default`, `runner_type=standard`, `schedule=weekly`.

**Change:** no committed workflow-file change. The desired weekly cadence is already true in default setup. If a repo-owned CodeQL workflow is added later, it must use weekly schedule + `workflow_dispatch` only unless HUMAN-ROADMAP explicitly approves a per-push scanner.

**Effect:** security scanning still happens weekly; agents can run it on-demand before a release if they want a spot-check. Not on every commit.

### 7. Local `cli/scripts/prepublish-gate.sh` — SHIPPED

Replaces the per-commit CI coverage that §2 removes. Agents run this before any `git tag`:

```bash
#!/usr/bin/env bash
set -euo pipefail

# 1. Full test suite (same as CI runs today)
cd cli && node --test test/**/*.test.js

# 2. Release-preflight (the same one that caught v2.149.0)
bash cli/scripts/release-preflight.sh --publish-gate --target-version "$1"

# 3. Pack dry-run (claim-reality coverage)
cd cli && npm pack --dry-run >/dev/null

# 4. Release-alignment check (the 17-surface drift gate)
bash cli/scripts/check-release-alignment.sh --target-version "$1"

echo "PREPUBLISH GATE PASSED for $1 — safe to tag and push."
```

Usage by agents: `bash cli/scripts/prepublish-gate.sh 2.150.0` before `git tag v2.150.0`. If it exits non-zero, no tag is created, no remote push happens, publish workflow is never triggered on a broken release. Shipped in Turn 115 as `cli/scripts/prepublish-gate.sh`.

### 8. Update `DEC-RELEASE-CUT-AND-PUSH-AS-ATOMIC-001`

Add precondition clause:

> The release-cut turn MUST run `bash cli/scripts/prepublish-gate.sh <target-version>` and include its `PREPUBLISH GATE PASSED` line in the turn's Evidence block before `git tag` is created. Failing gate = no tag, no push, no release. This replaces the per-commit CI coverage lost by restricting `ci.yml` to pull_request-only.

### 9. New decision record: `DEC-GITHUB-ACTIONS-FOOTPRINT-FLOOR-001`

> The repo's steady-state GitHub Actions footprint is: publish-on-tag (remote, mandatory for OIDC) + deploy-website-on-docs-change (remote, mandatory for GCP creds) + CodeQL weekly (remote, convenience) + nightly Governed Todo App Proof (remote, end-to-end regression net). All other testing runs local-first via `prepublish-gate.sh`. **Adding a workflow that fires on every push-to-main requires explicit human approval via HUMAN-ROADMAP** and a justification that the failure mode cannot be covered by the local gate.

## Implementation order (for the agent that picks this up)

1. Write `cli/scripts/prepublish-gate.sh` with the 4 checks above. Mark it executable. Smoke-test it against current HEAD.
2. Open `cli/scripts/release-preflight.sh` and confirm it runs headless (no prompts, no TTY assumptions). Ensure the gate script can invoke it non-interactively.
3. Edit `.github/workflows/ci.yml` — change `on:` from `push` + `pull_request` to `pull_request` only.
4. `git rm .github/workflows/ci-runner-proof.yml`.
5. Edit `.github/workflows/governed-todo-app-proof.yml` — replace `push: branches: [main]` with `schedule: - cron: '0 7 * * *'` and `push: tags: ['v*.*.*']`.
6. Edit `.github/workflows/deploy-gcs.yml` — add `paths: ['website-v2/**', 'docs/**', '.github/workflows/deploy-gcs.yml']` under the `push:` trigger.
7. Verify CodeQL default setup is weekly. Do not create `.github/workflows/codeql.yml` unless a future security decision explicitly needs a repo-owned workflow.
8. Append the two new decision records (`DEC-RELEASE-CUT-AND-PUSH-AS-ATOMIC-001` update + `DEC-GITHUB-ACTIONS-FOOTPRINT-FLOOR-001`) to `.planning/DECISIONS.md` (or wherever the canonical ledger lives).
9. Commit on a single branch: `chore(ci): shrink GitHub Actions footprint per CICD_REDUCTION_PLAN`.
10. Smoke-test: push a no-op commit to main, observe zero workflow runs for non-doc paths. Cut a dummy tag `v0.0.0-cicd-smoke`, observe only publish-on-tag fires for npm release tags. Delete the test tag. `publish-vscode-on-tag.yml` is intentionally carved out because it only listens to `vsce-v*.*.*` tags, not npm `v*.*.*` tags.

## Acceptance criteria

After the shrink lands:

- `gh run list --status queued` shows < 5 entries at any time (current: 40+).
- `gh run list --status in_progress` shows < 3 entries at any time under normal load (current: 15).
- Commits to main that change only `cli/src/`, `cli/test/`, `cli/scripts/`, or `.planning/` trigger zero remote workflows.
- Commits that change only `website-v2/` or `docs/` trigger exactly one remote workflow (deploy-website).
- Tag pushes for `v*.*.*` trigger exactly one remote workflow (publish-npm-on-tag). VS Code Marketplace publishing remains on separate `vsce-v*.*.*` tags.
- A full release cut (local gate → tag → push → npm live) completes in < 5 minutes end-to-end under normal GitHub runner conditions.
- No workflow run's `in_progress` duration exceeds `ubuntu-latest`'s 6-hour ceiling (if one does, it is a zombie and should be flagged for manual cancellation).

## Risk register

| Risk | Mitigation |
|---|---|
| Agent pushes broken code to main, no CI catches it, next agent pulls broken tree. | Local `prepublish-gate.sh` runs full tests before tag; agents who push without tagging can still break main. Residual risk accepted — breakage is visible immediately via local test runs on the next agent's turn. |
| Docs deploy's `paths:` filter misses a transitive dependency (e.g., a shared component changes in `cli/` that the docs site imports). | Rare. The website is a Docusaurus build with no `cli/` imports. If this changes, update the `paths:` filter. |
| Weekly CodeQL misses a same-week vulnerability introduction. | Accept. CodeQL catches static patterns; a one-week detection delay on a public research project is reasonable. Agents can dispatch CodeQL manually before a release if they have a specific concern. |
| Nightly Governed Todo App Proof fails at 07:00 UTC, no human around until hours later. | Same situation as today — the proof's alert goes to a notification sink (email/GitHub issue). The response latency is unchanged; the test just runs less often. |
| Zombies accumulate anyway on the remaining workflows. | With footprint reduced to ~5% of current, zombie rate should drop proportionally. Add a `gh run list --status in_progress --created "<6h-old"` check to `prepublish-gate.sh` if it recurs. |

## Rollback

Single-commit revert. All changes are workflow-file-only; no state migration; no external service contracts touched. If the shrink causes a regression that local gates don't catch, restore the `on: push` triggers and remove the `paths:` filters.

## Not in scope

- Self-hosted runners. Would solve concurrent-slot limits but introduces runner maintenance. Skip for now.
- Paid GitHub plan. Would raise the concurrent-slot ceiling from 20 to 180 (Team) or higher. Possibly worth it at higher agent-loop velocity, but not the current problem.
- Replacing OIDC trusted publishing with classic npm token. Would allow local publish. Reverses the security posture gain; not worth the token-leak surface.

## Related artifacts

- `.planning/HUMAN-ROADMAP.md` — `RELEASE-v2.149` item covers the immediate release path; this plan covers the structural fix so that item never recurs.
- `.planning/AGENT-TALK.md` — human override block in the 2026-04-21 entry documents the three-turn failure chain (cut-didn't-push / cut-didn't-push / queued≠stuck) that motivated this plan.
- `.github/workflows/*` — target files for the shrink.
- `cli/scripts/release-preflight.sh` — existing server-side preflight. The local `prepublish-gate.sh` wraps it.
- `cli/scripts/release-bump.sh` — existing version-bump + alignment script. The local gate runs before the tag this script creates.
