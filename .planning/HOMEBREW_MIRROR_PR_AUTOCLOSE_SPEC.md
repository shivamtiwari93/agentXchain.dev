# Homebrew Mirror PR Auto-Close Spec

> `DEC-HOMEBREW-MIRROR-AUTOCLOSE-001` — stop accumulating orphan Homebrew mirror PRs

---

## Purpose

The publish workflow creates a `chore/homebrew-sync-v*` PR when direct push to `main` fails for the repo mirror (`cli/homebrew/`). Due to branch protection (1 required review, `enforce_admins: false`), `github-actions[bot]` cannot self-approve or merge its own PRs. This results in orphan PRs accumulating every release.

Evidence from 20+ releases: most mirror PRs are either closed (superseded by the next release) or sit open indefinitely until manual intervention. The canonical Homebrew tap (`shivamtiwari93/homebrew-tap`) is always updated directly and is the truth source for `brew install agentxchain`. The repo mirror is cosmetic (`DEC-HOMEBREW-SYNC-012`).

## Solution

When the workflow's "Close out Homebrew mirror PR" step determines it cannot merge the PR (due to review requirements, auto-merge failure, or any other branch policy blocker), it should **auto-close the PR** with a clear comment instead of leaving it open as `needs_manual_followup` or `manual_approval_required`.

### Behavior change

**Before**: Workflow exits with `status=needs_manual_followup` or `status=manual_approval_required`, leaving the PR open.

**After**: Workflow closes the PR with a comment:
> Canonical Homebrew tap (`shivamtiwari93/homebrew-tap`) is already updated for vX.Y.Z. This repo mirror PR could not be self-merged due to branch protection (required review). Closing automatically — agents will sync the repo mirror on the next push. To eliminate this fallback entirely, configure `REPO_PUSH_TOKEN` (admin PAT with `contents:write` on this repo).

Then deletes the branch and exits with `status=auto_closed`.

### What stays the same

- Direct push path (primary): unchanged
- PR creation (fallback): unchanged
- Auto-merge attempt: unchanged
- Stale PR supersession: unchanged
- The auto-close only fires AFTER auto-merge has been attempted and failed
- If the closeout step receives an empty or invalid `pr_number`, it must recover the PR by querying the deterministic branch `chore/homebrew-sync-v<version>` before deciding no closeout work exists

## Interface

Changes to `.github/workflows/publish-npm-on-tag.yml` only — specifically the "Close out Homebrew mirror PR" step.

No new scripts, no new secrets, no new test files.

## Acceptance Tests

- AT-HM-AC-001: When direct push fails and PR auto-merge fails due to review requirements, the PR is closed (not left open).
- AT-HM-AC-002: The close comment includes the canonical tap status, the reason for closure, and the `REPO_PUSH_TOKEN` recommendation.
- AT-HM-AC-003: The PR branch is deleted after closure.
- AT-HM-AC-004: The step output is `status=auto_closed` (not `needs_manual_followup` or `manual_approval_required`).
- AT-HM-AC-005: If auto-merge succeeds, the PR is NOT auto-closed (merge path still works).
- AT-HM-AC-006: If the PR is already merged by the time closeout runs, no action is taken.
- AT-HM-AC-007: If the closeout step receives an invalid `pr_number` output, it re-resolves the PR from `chore/homebrew-sync-v<version>` instead of failing the workflow or silently skipping real closeout work.

## Decisions

`DEC-HOMEBREW-MIRROR-AUTOCLOSE-001`: The publish workflow must auto-close Homebrew mirror PRs that cannot be self-merged, instead of leaving them open as manual follow-up. Rationale: (a) the canonical tap is always correct, (b) the repo mirror is cosmetic, (c) orphan PRs accumulate noise, (d) agents sync the mirror on next push. The `REPO_PUSH_TOKEN` direct-push path (`DEC-HOMEBREW-MIRROR-DIRECT-PUSH-001`) remains the preferred zero-PR solution.

## Open Questions

None.
