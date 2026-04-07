# Release Artifact Gate Spec

## Purpose

Enforce that governed runs cannot ship without operator-readable release documentation. The `qa_ship_verdict` gate currently requires acceptance-matrix.md and ship-verdict.md, but neither describes *what* is being shipped in user-facing terms. `.planning/RELEASE_NOTES.md` fills that gap.

## Decision Context

- **Gate placement**: `RELEASE_NOTES.md` belongs on the existing `qa_ship_verdict` gate, not a separate `release_ready` gate. The ship verdict is the ship boundary. If QA cannot describe what is being shipped, the run is not ready to ship. Adding a 4th phase would add complexity without value.
- **Artifact ownership**: QA fills release notes during the QA phase, after reviewing implementation changes and acceptance results. This is the correct owner because QA has the complete picture of what changed, what was tested, and what users need to know.

## Interface

### Artifact: `.planning/RELEASE_NOTES.md`

**Required sections** (must exist with non-placeholder content):
- `## User Impact` — what changes, additions, or fixes users will see
- `## Verification Summary` — how the release was verified (links to acceptance matrix, test results, etc.)

**Optional sections** (included in scaffold, not gated):
- `## Upgrade Notes` — migration steps, breaking changes, compatibility notes
- `## Known Issues` — known limitations or follow-ups

### Scaffold placeholder

```
(QA fills this during the QA phase)
```

### Semantic evaluator: `evaluateReleaseNotes(content)`

Returns `{ ok: boolean, reason?: string }`.

**Pass conditions:**
1. `## User Impact` section exists with at least one non-empty, non-placeholder line
2. `## Verification Summary` section exists with at least one non-empty, non-placeholder line

**Fail conditions:**
- Missing `## User Impact` → fail with section-missing message
- Missing `## Verification Summary` → fail with section-missing message
- Section exists but contains only placeholder text → fail with placeholder message
- Section exists but is empty (only whitespace) → fail with placeholder message

## Behavior

1. `agentxchain init --governed` and `agentxchain migrate --yes` scaffold `.planning/RELEASE_NOTES.md` with placeholder content.
2. The `qa_ship_verdict` gate adds `.planning/RELEASE_NOTES.md` to its `requires_files` array.
3. `evaluateWorkflowGateSemantics()` dispatches to `evaluateReleaseNotes()` for the release notes path.
4. QA prompt instructs the QA agent to fill release notes during the QA phase.

## Error Cases

- File does not exist → gate evaluator handles via `requires_files` (file-missing error)
- File exists but all sections are placeholder → semantic check fails with specific section names
- File exists but one required section is missing → semantic check fails listing the missing section(s)
- File exists but one required section has only placeholder text → semantic check fails

## Acceptance Tests

- **AT-RELEASE-GATE-001**: Scaffold placeholder content fails the gate (both required sections have placeholder text)
- **AT-RELEASE-GATE-002**: Real `## User Impact` + placeholder `## Verification Summary` fails the gate
- **AT-RELEASE-GATE-003**: Both real sections pass the gate
- **AT-RELEASE-GATE-004**: Missing `## User Impact` section fails with section-missing reason
- **AT-RELEASE-GATE-005**: Missing `## Verification Summary` section fails with section-missing reason
- **AT-RELEASE-GATE-006**: Optional sections (`## Upgrade Notes`, `## Known Issues`) do not affect gate outcome
- **AT-RELEASE-GATE-007**: Spec guard verifying this spec file exists

## Open Questions

None. The gate placement, required sections, and ownership are all resolved.
