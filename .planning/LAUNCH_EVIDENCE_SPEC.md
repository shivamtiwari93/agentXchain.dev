# Launch Evidence Spec

> Contract for the current-release evidence authority that governs what launch-linked surfaces may safely claim.

---

## Purpose

Consolidate all evidence from live runs, shipped release verification, test suites, and dogfood sessions into a single artifact that anchors current launch-linked copy claims. This prevents reusable launch surfaces from drifting beyond what has actually been demonstrated for the currently shipped release.

## Interface

The output is a single Markdown file at `.planning/LAUNCH_EVIDENCE_REPORT.md` with four sections:

1. **Evidence Inventory** — every evidence source, its date, what it proved, and what it did NOT prove.
2. **Allowed Claims** — claims that launch surfaces (Show HN, README, website, npm description) may safely make, each anchored to a specific evidence source.
3. **Disallowed Claims** — claims that current evidence does NOT support. Any launch surface using this language must be patched.
4. **Evidence Gaps** — what would need to happen to unlock additional claims.

## Behavior

- The artifact is internal. It does not ship to npm or the website.
- Every claim in sections 2 and 3 must cite a specific evidence source from section 1.
- The artifact is active current-release authority, not a frozen launch-era snapshot. Historical launch artifacts may remain preserved as labeled history, but reusable launch-linked drafts and current launch-boundary docs must follow the current release truth captured here.
- The artifact is updated whenever new live evidence is collected or a release changes the aggregate proof line.
- The artifact must distinguish historical dashboard baselines from the current shipped live-dashboard contract. It must not describe the current local dashboard as fully read-only once authenticated `approve-gate` exists.
- Launch-boundary docs must not downgrade the current shipped dashboard contract to a historical shorthand such as "v2.0 observation surface." Current truth is narrower and more precise: local observation plus authenticated `approve-gate`, with broader mutations still deferred.
- The report must carry the current aggregate release evidence line from the top `cli/CHANGELOG.md` section for the shipped `cli/package.json` version. It must not fall back to launch-era floors once exact release verification exists.
- Launch surfaces (SHOW_HN_DRAFT.md, LAUNCH_BRIEF.md, README.md, `website-v2/src/pages/index.tsx`, `website-v2/src/pages/why.mdx`) must not make claims that appear in section 3.
- Named E-sections inside Section 1 (Evidence Inventory) are narrowly scoped. Per `DEC-LAUNCH-EVIDENCE-ESECTION-SCOPE-001`, a dedicated E-section is reserved for release-facing proof surfaces that are either (a) cross-defect or otherwise non-obvious without dedicated explanation, (b) tied to a public rerun contract, or (c) mark a materially new proof boundary. Ordinary "repo regression exists, tester rerun pending" state stays in the summary/status lines and does NOT warrant a dedicated E-section. This prevents the Evidence Inventory from inflating into a graveyard of every open rule-12 bug. The prior broader framing under `DEC-LAUNCH-EVIDENCE-COMBINED-SHAPE-VISIBILITY-001` is superseded by this narrower rule.

## Evidence Sources

The following evidence sources feed the authority contract:

| Source | Path |
|--------|------|
| Live Scenario A report | `.planning/LIVE_SCENARIO_A_REPORT.md` |
| Live API proxy preflight report | `.planning/LIVE_API_PROXY_PREFLIGHT_REPORT.md` |
| Test suite | `cli/test/` (run via `node --test`) |
| Release verification source of truth | `cli/CHANGELOG.md` top section for current `cli/package.json` version |
| Scenario D spec (post-release) | `.planning/SCENARIO_D_ESCALATION_DOGFOOD_SPEC.md` |
| Dashboard implementation + tests | `cli/dashboard/`, `cli/test/dashboard-*.test.js`, `cli/test/e2e-dashboard.test.js` |
| Conformance corpus | `.agentxchain-conformance/fixtures/` |

## Acceptance Tests

- AT-EVIDENCE-001: The report exists and contains all four sections.
- AT-EVIDENCE-002: Every "Allowed claim" cites at least one evidence source.
- AT-EVIDENCE-003: No launch-facing file (SHOW_HN_DRAFT.md, LAUNCH_BRIEF.md, README.md, `website-v2/src/pages/index.tsx`, `website-v2/src/pages/why.mdx`) contains language that matches a disallowed claim.
- AT-EVIDENCE-004: The report carries the current aggregate release evidence line from the top `cli/CHANGELOG.md` section for the shipped `cli/package.json` version; it does not fall back to stale launch-era floors.
- AT-EVIDENCE-005: The report does not present the current shipped local dashboard as fully read-only; it preserves the live-dashboard boundary that authenticated `approve-gate` exists while WebSocket transport and `replay export` remain read-only.
- AT-EVIDENCE-006: `LAUNCH_BRIEF.md` does not tell operators to describe the current shipped dashboard as a `v2.0 observation surface`; it uses the shipped shorthand of local observation plus narrow live gate approval.
- AT-EVIDENCE-007: `LAUNCH_EVIDENCE_SPEC.md` itself describes the artifact as current-release authority rather than a pre-release floor document, so the spec cannot drift behind the executable guards.
- AT-EVIDENCE-008: The spec carries the narrowed E-section scope rule (`DEC-LAUNCH-EVIDENCE-ESECTION-SCOPE-001`): named E-sections are reserved for cross-defect/non-obvious, public rerun contract, or materially new proof boundaries, and the spec explicitly states that ordinary "repo regression exists, tester rerun pending" state does NOT warrant a dedicated E-section. The spec also records that the broader `DEC-LAUNCH-EVIDENCE-COMBINED-SHAPE-VISIBILITY-001` framing is superseded, so future agents cannot revive the overbroad "every open rule-12 bug gets an E-section" interpretation.

## Open Questions

None. This is a consolidation artifact, not a new feature.
