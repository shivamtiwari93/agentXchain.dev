# Workflow Gate Placeholder Leak Fix — Spec

**Status:** Shipped — placeholder leak paths fixed, guard tests in `cli/test/workflow-gate-placeholder-leak.test.js`.

## Purpose

Prevent scaffold placeholder text from passing through workflow-kit phase gates.
Two gate validators accept artifacts containing only scaffold boilerplate — allowing
operators to transition phases without filling in required content.

## Leak Paths

### 1. `evaluateSectionCheck` (workflow-kit custom artifacts)

`generateWorkflowKitPlaceholder()` emits sections with `(Content here.)` or
`(Operator fills this in.)`. The `evaluateSectionCheck` validator only checks
that required section *headers* exist. It does not check whether the section
body is still scaffold placeholder text. An architecture-review or security-review
artifact passes the gate with every section containing only `(Content here.)`.

### 2. `evaluateSystemSpec` (SYSTEM_SPEC.md)

`buildSystemSpecContent()` emits placeholder guidance strings:
- `(Describe the problem this slice solves and why it exists.)`
- `(List the user-facing commands, files, APIs, or contracts this slice changes.)`
- `(Describe the expected behavior, including important edge cases.)`
- `(List the failure modes and how the system should respond.)`
- `- [ ] Name the executable checks that prove this slice works.`

The `evaluateSystemSpec` validator only checks for presence of `## Purpose`,
`## Interface`, and `## Acceptance Tests` headers. All placeholders pass.

## Fix

### `evaluateSectionCheck`

Add content-presence checking that mirrors the pattern used by
`evaluateImplementationNotes` and `evaluateReleaseNotes`: for each required
section, scan lines after the header until the next `## ` boundary, skip
blank lines and known scaffold placeholders, and fail if no real content
remains.

Known scaffold placeholders to filter:
- `(Content here.)`
- `(Operator fills this in.)`

### `evaluateSystemSpec`

Add per-section content checking after the header-presence check. For each
required section, scan body lines, skip blank lines and known scaffold
placeholders, and fail if no real content remains.

Known scaffold placeholders to filter:
- Lines matching `^\(.*\)$` (parenthetical guidance — the init scaffold
  always uses this form)
- Lines matching `^- \[ \] Name the executable checks` (acceptance test
  scaffold)

## Acceptance Tests

- AT-WGPL-001: `evaluateSectionCheck` rejects artifact where all required sections contain only `(Content here.)`
- AT-WGPL-002: `evaluateSectionCheck` accepts artifact where at least one required section has real content
- AT-WGPL-003: `evaluateSystemSpec` rejects SYSTEM_SPEC.md containing only scaffold guidance placeholders
- AT-WGPL-004: `evaluateSystemSpec` accepts SYSTEM_SPEC.md where sections have real content
- AT-WGPL-005: Existing passing artifacts (filled-in sections) continue to pass both validators
