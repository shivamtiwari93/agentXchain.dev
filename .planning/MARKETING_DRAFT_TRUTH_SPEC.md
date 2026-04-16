# Marketing Draft Truth Spec

> Contract for reusable launch-linked marketing drafts under `.planning/MARKETING/`.

## Purpose

Keep repo-owned marketing drafts aligned with the current shipped release surface instead of letting them decay into stale launch folklore.

These drafts are reused for posting, editing, and downstream launch copy. If they lag version, proof counts, or adapter boundaries, the repo republishes false product truth.

## Interface

- Drafts:
  - `.planning/MARKETING/TWITTER_THREAD.md`
  - `.planning/MARKETING/REDDIT_POSTS.md`
  - `.planning/MARKETING/HN_SUBMISSION.md`
- Current release truth sources:
  - `cli/package.json`
  - `cli/CHANGELOG.md`
  - `.planning/LAUNCH_EVIDENCE_REPORT.md`
  - `.agentxchain-conformance/fixtures/`

## Behavior

1. Reusable marketing drafts must reference the current released version from `cli/package.json`.
2. Reusable marketing drafts must carry the current aggregate evidence line from the top `cli/CHANGELOG.md` section.
3. Reusable marketing drafts must carry the current conformance corpus size.
4. Reusable marketing drafts must preserve the shipped adapter-proof boundary:
   - all five adapter types are proven live
   - `local_cli`, `api_proxy`, `mcp`, and `remote_agent` have real-model proof
   - `manual` is the governed human control path
5. Reusable marketing drafts must not fall back to stale launch-era counts, stale release versions, or the pre-remote-agent four-adapter story.

## Error Cases

- A draft still says `v2.24` or `v2.25.2` after the current release has moved on.
- A draft still says `All 4 adapters proven live` or omits `remote_agent` from the real-model proof list.
- A draft still carries `4,500+ tests`, `970+ suites`, `2,486+ tests`, or other stale proof-floor wording after the top changelog section has moved.
- A draft says or implies that `manual` is proven with a real AI model.

## Acceptance Tests

- `AT-MARKETING-TRUTH-001`: Each reusable marketing draft contains the current `cli/package.json` version string.
- `AT-MARKETING-TRUTH-002`: Each reusable marketing draft contains the current aggregate release evidence line from the top `cli/CHANGELOG.md` section.
- `AT-MARKETING-TRUTH-003`: Each reusable marketing draft contains the current conformance corpus size.
- `AT-MARKETING-TRUTH-004`: Each reusable marketing draft preserves the current five-adapter live-proof boundary and includes `remote_agent`.
- `AT-MARKETING-TRUTH-005`: Each reusable marketing draft states that `manual` is the governed human control path rather than a real-model proof path.
- `AT-MARKETING-TRUTH-006`: Reusable marketing drafts reject stale four-adapter phrasing and stale release-version phrasing.

## Open Questions

- Should release automation eventually regenerate these drafts from structured release metadata instead of relying on guard-tested manual updates?
