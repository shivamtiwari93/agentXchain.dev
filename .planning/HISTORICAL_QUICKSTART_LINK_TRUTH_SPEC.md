# Historical Quickstart Link Truth Spec

> Contract for historical docs pages that point readers at the live `/docs/quickstart` alias or one of its anchors.

## Purpose

Prevent historical release notes from presenting the live quickstart alias as if it were a frozen historical document location. Historical pages may point readers to the current onboarding path, but the surrounding prose must make that boundary explicit instead of implying that the live `/docs/quickstart` route itself is a historical artifact.

## Interface

Files under this contract:

- `website-v2/docs/releases/v2-13-0.mdx`
- `website-v2/docs/quickstart.mdx`
- `cli/test/release-docs-content.test.js`

## Behavior

1. Historical release notes may link to `/docs/quickstart` or a `/docs/quickstart#...` anchor for the current onboarding flow.
2. When they do, the prose must describe that link as the current walkthrough or current first-run path, not as a historical route where content "was already shipped under" the live alias.
3. Historical pages may still describe the release-era problem they fixed, but they must not freeze the live quickstart alias into the past-tense product boundary.
4. The live quickstart page remains the authority for the current governed onboarding flow.

## Error Cases

- A historical release note says content "was already shipped under `/docs/quickstart...`", treating the live alias as a frozen historical location.
- A historical release note links to `/docs/quickstart` but uses wording that blurs whether the link points to a current walkthrough or a historical snapshot.
- The regression guard checks only the page prose and not the contract, leaving the same drift easy to reintroduce.

## Acceptance Tests

- `AT-HQLT-001`: `v2-13-0.mdx` does not say the multi-repo walkthrough "was already shipped under" the live `/docs/quickstart#multi-repo-cold-start` alias.
- `AT-HQLT-002`: `v2-13-0.mdx` links to `/docs/quickstart#multi-repo-cold-start` using current-walkthrough wording.
- `AT-HQLT-003`: `cli/test/release-docs-content.test.js` rejects the stale historicalized quickstart-alias wording for `v2-13-0.mdx`.

## Open Questions

None.
