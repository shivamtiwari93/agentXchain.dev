# Agent-Native SDLC Template System Spec

> Spec for governed project templates that move AgentXchain from "one generic scaffold" toward the v3 agent-native SDLC vision.

---

## Purpose

Define a template system for `agentxchain init --governed` so new governed projects start with workflow artifacts that match the product shape being built. The current scaffold is intentionally generic. That is acceptable for v1.0, but it is not the v3 vision. An API service, CLI tool, and web app do not need the same planning prompts, acceptance artifacts, or QA evidence structure.

The template system exists to make governed delivery opinionated where it matters:

- required planning artifacts
- role prompts and acceptance checklists
- project-shape-specific QA expectations
- reproducible scaffold layouts that still obey the same protocol

## Interface

### CLI Surface

The governed initializer gains an optional template selector:

```bash
agentxchain init --governed --template <id>
```

Supported template ids for the first release of this system:

- `generic` — current baseline scaffold; default for backward compatibility
- `api-service`
- `cli-tool`
- `library`
- `web-app`

Non-goals for v1 of the template system:

- remote template registries
- arbitrary user code execution during scaffold
- framework-specific generators (`nextjs`, `fastify`, `vite`) inside the core CLI

### Template Manifest

Each built-in template is described by a manifest:

```json
{
  "id": "api-service",
  "display_name": "API Service",
  "description": "Governed scaffold for a backend service with explicit API contract and operational QA artifacts.",
  "version": "1",
  "protocol_compatibility": ["1.0", "1.1"],
  "planning_artifacts": [],
  "prompt_overrides": {},
  "acceptance_hints": []
}
```

The manifest is internal CLI data, not part of the governed run state. The resulting scaffold is what matters to the protocol.

Manifest field meanings for v1:

- `planning_artifacts`: array of `{ filename, content_template }` objects written under `.planning/`
- `prompt_overrides`: object keyed by governed role id (`pm`, `dev`, `qa`, `eng_director`) with appended guidance text
- `acceptance_hints`: human-readable checklist lines appended to `.planning/acceptance-matrix.md`

The v1 manifest is intentionally narrow. It scaffolds files and guidance. It does **not** introduce machine-enforced template gates.

## Behavior

### 1. Shared Invariants

Every template must preserve the governed protocol contract:

- `agentxchain.json` remains the single config entrypoint
- `.agentxchain/` state layout remains orchestrator-owned
- role routing, gates, dispatch, staging, and history contracts do not change
- generated planning docs are inputs for agents, not hidden runtime magic
- template choice must be recorded in scaffold metadata so later docs and migrations can inspect it

### 2. Template-Specific Planning Surface

Each template adds or customizes the human-readable planning files under `.planning/`.

`generic` keeps the current files:

- `PM_SIGNOFF.md`
- `ROADMAP.md`
- `acceptance-matrix.md`
- `ship-verdict.md`

`api-service` adds:

- `api-contract.md`
- `operational-readiness.md`
- `error-budget.md`

`cli-tool` adds:

- `command-surface.md`
- `platform-support.md`
- `distribution-checklist.md`

`library` adds:

- `public-api.md`
- `compatibility-policy.md`
- `release-adoption.md`

`web-app` adds:

- `user-flows.md`
- `ui-acceptance.md`
- `browser-support.md`

These are not filler documents. Each one must include starter headings that make QA and ship decisions more concrete.

### 3. Template-Specific Prompt Seeds

Templates may customize prompt seeds per role, but only within the existing governed prompt contract.

Examples:

- `api-service` QA prompt seed emphasizes API contract conformance, error handling, and migration risk
- `cli-tool` QA prompt seed emphasizes command UX, help text, install flow, and shell compatibility
- `library` QA prompt seed emphasizes public API stability, install/import smoke, and upgrade-path clarity
- `web-app` QA prompt seed emphasizes user flow integrity, responsive behavior, and accessibility smoke checks

The template system must not introduce role-specific protocol forks. A `qa` turn still returns the same governed turn-result schema regardless of template.

### 4. Acceptance Artifact Minimums

Each template defines the minimum evidence expected before a run can credibly request ship approval.

`api-service` minimums:

- API contract reviewed
- error cases listed
- verification command for automated tests or smoke checks

`cli-tool` minimums:

- command help audited
- install or invocation path checked
- failure-mode UX reviewed

`library` minimums:

- public API surface reviewed
- compatibility or migration expectations documented
- install/import or package-consumer smoke path checked

`web-app` minimums:

- primary user flow reviewed
- mobile/desktop behavior checked
- accessibility and copy regressions noted explicitly

These minimums are scaffold guidance first. In v1 they are represented as `acceptance_hints`, not a structured `acceptance_artifacts` enforcement surface. Future protocol versions may promote some of them into machine-enforced gates, but this spec does not pretend that exists yet.

### 5. Migration And Backward Compatibility

- Existing projects without a template remain valid and are treated as `generic`.
- `migrate` must never guess a template from repo contents in the first release.
- A future explicit command may annotate an existing project with a chosen template after human confirmation. The intended surface is `agentxchain template set <id>`.

## Error Cases

- Unknown template id: initializer fails with a list of supported built-in templates.
- Partial scaffold write: initializer must clean up or fail before claiming success.
- Template manifest drift: CLI tests must fail if a declared planning artifact or prompt seed is missing from the packaged files.
- Template overreach: if a template requires framework-specific files that the CLI cannot scaffold honestly, the template is rejected from the built-in set.

## Acceptance Tests

- AT-SDLC-TEMPLATE-001: `init --governed` with no template flag produces the current backward-compatible `generic` scaffold.
- AT-SDLC-TEMPLATE-002: each built-in template writes its declared planning artifacts and prompt seeds.
- AT-SDLC-TEMPLATE-003: all built-in templates preserve the same governed config/state invariants under `.agentxchain/`.
- AT-SDLC-TEMPLATE-004: unknown template ids fail with a deterministic error message listing valid ids.
- AT-SDLC-TEMPLATE-005: generated docs mention the selected template so operators and future migrations can inspect scaffold intent.
- AT-SDLC-TEMPLATE-006: the packaged npm tarball contains every built-in template asset required by its manifest.

## Open Questions

1. Which parts of template guidance should become machine-enforced gates versus staying as prompt-and-doc scaffolding?
2. Resolved: a first-party `library` template is part of the built-in wave because OSS packages are a common governed delivery shape and do not fit cleanly into `api-service` or `cli-tool`.
