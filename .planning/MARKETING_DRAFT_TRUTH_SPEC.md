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
- Canonical current release truth sources:
  - `cli/package.json`
  - `cli/CHANGELOG.md`
- Downstream launch-facing alignment surface:
  - `.planning/LAUNCH_EVIDENCE_REPORT.md`
- Derived proof corpus:
  - `.agentxchain-conformance/fixtures/`

## Behavior

1. Reusable marketing drafts must reference the current released version from `cli/package.json`.
2. Exact release version and aggregate evidence numbers are canonical in `cli/package.json` and the top `cli/CHANGELOG.md` section, not in manually edited launch prose.
3. Reusable marketing drafts must carry the current aggregate evidence line from the top `cli/CHANGELOG.md` section.
4. `.planning/LAUNCH_EVIDENCE_REPORT.md` must mirror the same current version and aggregate evidence line so the report cannot drift into a competing numeric authority.
5. Reusable marketing drafts must carry the current conformance corpus size.
6. Reusable marketing drafts must preserve the shipped adapter-proof boundary:
   - all five adapter types are proven live
   - `local_cli`, `api_proxy`, `mcp`, and `remote_agent` have real-model proof
   - `manual` is the governed human control path
7. Reusable marketing drafts must point their primary CTA at a current front door:
   - `https://agentxchain.dev` is the canonical general-purpose landing URL
   - current docs URLs such as `/docs/quickstart` are allowed as supporting links
   - the historical `/launch` snapshot must not be presented as the primary destination for fresh marketing traffic
8. Reusable marketing drafts must not fall back to stale launch-era counts, stale release versions, or the pre-remote-agent four-adapter story.

## Error Cases

- A draft still says `v2.24` or `v2.25.2` after the current release has moved on.
- `.planning/LAUNCH_EVIDENCE_REPORT.md` still carries the previous release evidence line after the top `cli/CHANGELOG.md` section has advanced.
- A draft still says `All 4 adapters proven live` or omits `remote_agent` from the real-model proof list.
- A draft still carries `4,500+ tests`, `970+ suites`, `2,486+ tests`, or other stale proof-floor wording after the top changelog section has moved.
- A draft says or implies that `manual` is proven with a real AI model.
- A reusable current-truth draft sends fresh traffic to `https://agentxchain.dev/launch` as its primary CTA.

## Acceptance Tests

- `AT-MARKETING-TRUTH-001`: Each reusable marketing draft contains the current `cli/package.json` version string.
- `AT-MARKETING-TRUTH-002`: Each reusable marketing draft contains the current aggregate release evidence line from the top `cli/CHANGELOG.md` section.
- `AT-MARKETING-TRUTH-003`: Each reusable marketing draft contains the current conformance corpus size.
- `AT-MARKETING-TRUTH-004`: Each reusable marketing draft preserves the current five-adapter live-proof boundary and includes `remote_agent`.
- `AT-MARKETING-TRUTH-005`: Each reusable marketing draft states that `manual` is the governed human control path rather than a real-model proof path.
- `AT-MARKETING-TRUTH-006`: Reusable marketing drafts reject stale four-adapter phrasing and stale release-version phrasing.
- `AT-MARKETING-TRUTH-007`: The spec defines `cli/package.json` plus the top `cli/CHANGELOG.md` section as the canonical numeric authority, and `.planning/LAUNCH_EVIDENCE_REPORT.md` is required to mirror that same current version and aggregate evidence line.
- `AT-MARKETING-TRUTH-008`: Reusable marketing drafts use `https://agentxchain.dev` as the canonical primary landing URL and do not present the historical `/launch` snapshot as the primary CTA.

## Open Questions

- Should release automation eventually regenerate these drafts from structured release metadata instead of relying on guard-tested manual updates?
