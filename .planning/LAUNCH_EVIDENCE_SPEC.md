# Launch Evidence Spec

> Contract for the pre-release evidence artifact that governs what claims launch surfaces may safely make.

---

## Purpose

Consolidate all evidence from live runs, test suites, and dogfood sessions into a single artifact that anchors launch copy claims. This prevents launch surfaces from drifting beyond what has actually been demonstrated.

## Interface

The output is a single Markdown file at `.planning/LAUNCH_EVIDENCE_REPORT.md` with four sections:

1. **Evidence Inventory** — every evidence source, its date, what it proved, and what it did NOT prove.
2. **Allowed Claims** — claims that launch surfaces (Show HN, README, website, npm description) may safely make, each anchored to a specific evidence source.
3. **Disallowed Claims** — claims that current evidence does NOT support. Any launch surface using this language must be patched.
4. **Evidence Gaps** — what would need to happen to unlock additional claims.

## Behavior

- The artifact is internal. It does not ship to npm or the website.
- Every claim in sections 2 and 3 must cite a specific evidence source from section 1.
- The artifact is updated whenever new live evidence is collected.
- The artifact must distinguish historical dashboard baselines from the current shipped live-dashboard contract. It must not describe the current local dashboard as fully read-only once authenticated `approve-gate` exists.
- Launch surfaces (SHOW_HN_DRAFT.md, LAUNCH_BRIEF.md, README.md, `website-v2/src/pages/index.tsx`, `website-v2/src/pages/why.mdx`) must not make claims that appear in section 3.

## Evidence Sources

The following evidence sources exist as of 2026-04-02:

| Source | Path |
|--------|------|
| Live Scenario A report | `.planning/LIVE_SCENARIO_A_REPORT.md` |
| Live API proxy preflight report | `.planning/LIVE_API_PROXY_PREFLIGHT_REPORT.md` |
| Test suite | `cli/test/` (run via `node --test`) |
| Scenario D spec (post-release) | `.planning/SCENARIO_D_ESCALATION_DOGFOOD_SPEC.md` |
| Dashboard implementation + tests | `cli/dashboard/`, `cli/test/dashboard-*.test.js`, `cli/test/e2e-dashboard.test.js` |

## Acceptance Tests

- AT-EVIDENCE-001: The report exists and contains all four sections.
- AT-EVIDENCE-002: Every "Allowed claim" cites at least one evidence source.
- AT-EVIDENCE-003: No launch-facing file (SHOW_HN_DRAFT.md, LAUNCH_BRIEF.md, README.md, `website-v2/src/pages/index.tsx`, `website-v2/src/pages/why.mdx`) contains language that matches a disallowed claim.
- AT-EVIDENCE-004: The test count floor in the report matches the current test suite.
- AT-EVIDENCE-005: The report does not present the current shipped local dashboard as fully read-only; it preserves the live-dashboard boundary that authenticated `approve-gate` exists while WebSocket transport and `replay export` remain read-only.

## Open Questions

None. This is a consolidation artifact, not a new feature.
