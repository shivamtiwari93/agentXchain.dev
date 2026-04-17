# Homebrew Mirror Direct-Push Spec

> `DEC-HOMEBREW-MIRROR-DIRECT-PUSH-001` — eliminate the PR deadlock for repo-mirror Homebrew sync

---

## Purpose

Every release previously stranded an open Homebrew mirror PR because:

1. `github-actions[bot]` creates the PR using `GITHUB_TOKEN`
2. `github-actions[bot]` cannot self-approve (same actor)
3. Branch protection requires 1 approving review before merge
4. Auto-merge cannot satisfy the approval requirement
5. Result: every release leaves PR `chore/homebrew-sync-v*` open until manual intervention

The canonical tap (`shivamtiwari93/homebrew-tap`) is already updated directly. The repo mirror (`cli/homebrew/`) is explicitly NOT part of canonical downstream truth (`DEC-HOMEBREW-SYNC-012`). The PR path was pure waste — creating, attempting to merge, then auto-closing every release.

## Solution (Updated 2026-04-17)

`DEC-HOMEBREW-MIRROR-NO-PR-001`: The PR fallback path is **removed entirely**. When direct push fails, the workflow warns and moves on. The canonical tap is already correct. Agents sync the repo mirror during release follow-up.

### Strategy

1. After `sync-homebrew.sh` updates the local mirror files, check if there are changes in `homebrew/`.
2. **Primary path (direct push):** Fetch `origin/main`, create a commit on top of it with only `homebrew/` changes, and push directly to `main` using `REPO_PUSH_TOKEN` (preferred) or `GITHUB_TOKEN` or `HOMEBREW_TAP_TOKEN`.
3. **If direct push fails:** Warn and exit cleanly. No PR is created. The canonical tap is already correct. Agents sync the repo mirror on their next push.

### Safety constraints

- The direct push commit MUST only contain changes to `homebrew/agentxchain.rb` and `homebrew/README.md`.
- The commit must be on top of `origin/main` (fast-forward safe).
- The push uses `--ff-only` semantics implicitly (fresh checkout of `origin/main` + commit + push).
- If the push is rejected for any reason, warn and skip — never force-push to `main`, never create a PR.

## Interface

No new scripts. Changes to `.github/workflows/publish-npm-on-tag.yml` only.

New secret (optional but preferred): `REPO_PUSH_TOKEN`

- Purpose: direct push for the repo mirror update in `shivamtiwari93/agentXchain.dev`
- Scope: `contents:write` on `shivamtiwari93/agentXchain.dev` with branch-protection bypass
- Precedence: `REPO_PUSH_TOKEN` > `GITHUB_TOKEN` > `HOMEBREW_TAP_TOKEN`

## Acceptance Tests

- AT-HM-DP-001: Workflow attempts direct push to `main` using the selected token.
- AT-HM-DP-002: Direct push commit only contains `homebrew/agentxchain.rb` and `homebrew/README.md`.
- AT-HM-DP-003: If direct push succeeds, no PR is created.
- AT-HM-DP-004: If direct push fails, no PR is created — workflow warns and moves on.
- AT-HM-DP-006: Workflow never force-pushes to `main`.
- AT-HM-DP-007: Workflow prefers `REPO_PUSH_TOKEN` > `GITHUB_TOKEN` > `HOMEBREW_TAP_TOKEN` for repo-mirror direct push.
- AT-HM-DP-008: Release docs describe the repo-mirror path truthfully.
- AT-HM-DP-009: Workflow does not request `pull-requests: write` permission.

## Decisions

`DEC-HOMEBREW-MIRROR-DIRECT-PUSH-001`: The publish workflow attempts a direct push to `main` for Homebrew mirror updates. Direct push is safe because: (a) the commit scope is limited to `homebrew/` files, (b) the push is on top of `origin/main` (fast-forward), and (c) failure is non-fatal since the canonical tap is already correct.

`DEC-HOMEBREW-MIRROR-NO-PR-001`: The PR fallback path is removed. Creating PRs that cannot self-merge is waste. When direct push fails (branch protection blocks `GITHUB_TOKEN` and `REPO_PUSH_TOKEN` is not configured), the workflow warns and agents sync the mirror on the next push. This supersedes `DEC-HOMEBREW-SYNC-014`, `DEC-HOMEBREW-MIRROR-AUTOCLOSE-001`, and the PR-based mirror update contract.

`DEC-HOMEBREW-REPO-PUSH-TOKEN-001`: To enable CI direct push, configure `REPO_PUSH_TOKEN` as a GitHub Actions secret — a classic PAT with `repo` scope and branch-protection bypass on `main`. Without it, `GITHUB_TOKEN` is tried but typically blocked by branch protection.

## Open Questions

- None. The permanent fix for operator action: configure `REPO_PUSH_TOKEN` in GitHub Actions secrets. Until then, agent release follow-up includes a manual `git push` for the mirror SHA.
