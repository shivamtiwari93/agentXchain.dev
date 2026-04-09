# Changelog

## 2.36.0

`2.36.0` ships the missing operator-visible dashboard continuity panel and closes the release-surface drift that kept the repo-mirrored Homebrew files out of release identity.

### Dashboard continuity is now operator-visible

- Timeline view now renders continuity state directly instead of leaving `/api/continuity` as hidden bridge plumbing.
- `/api/continuity` now serves the same computed continuity shape as `agentxchain status --json`, via the shared `continuity-status.js` helper.
- Dashboard invalidation now refreshes continuity when `SESSION_RECOVERY.md` changes, so restart guidance stays truthful after recovery work.

### Release identity now includes the mirrored Homebrew surfaces

- `release-bump.sh` now treats both `cli/homebrew/agentxchain.rb` and `cli/homebrew/README.md` as governed release surfaces.
- Pre-bump validation fails closed unless the Homebrew mirror formula and maintainer README already point at the target version.
- Post-release current-surface coverage now enforces that the mirrored formula and README track the current npm tarball.

### Evidence

- **2894 tests / 608 suites / 0 failures**
- `cd cli && npm test`
- `node --test test/release-identity-hardening.test.js test/current-release-surface.test.js test/homebrew-mirror-contract.test.js`
- `cd website-v2 && npm run build`

## 2.35.0

`2.35.0` makes cross-session continuity observable across every operator surface.

### Continuity observability across status, reports, and dashboard

- `agentxchain status` now shows checkpoint session id, reason, timing, last turn/role/phase, stale-checkpoint warnings, and restart guidance.
- `status --json` exposes additive `continuity` metadata for automation consumers.
- Governed reports include a `Continuity` section in text and markdown formats with checkpoint metadata and stale-checkpoint detection.
- `.agentxchain/session.json` added to `RUN_EXPORT_INCLUDED_ROOTS` so checkpoint data flows through the export pipeline.
- Coordinator reports surface per-repo continuity with child-level stale detection.
- Dashboard bridge serves `/api/continuity` from `session.json` with WebSocket invalidation.

### CI and release infrastructure modernization

- GitHub Actions standardized on `checkout@v6`, `setup-node@v6`, Google Actions `@v3`.
- Pre-bump version-surface alignment guard validates all 7 governed surfaces before creating release identity.
- Orphaned release-note pages for unpublished versions deleted.

### Evidence

- **2885 tests / 607 suites / 0 failures**
- `cd cli && npm test`
- `cd website-v2 && npm run build`

## 2.34.2

`2.34.2` is the public cross-session continuity release.

### Release surfaces now agree on the shipped package

- Corrected the remaining release-governed drift caught by strict preflight:
  - `.agentxchain-conformance/capabilities.json`
  - homepage hero badge
  - protocol implementor guide example config
  - launch evidence header
  - linked Docusaurus release notes surface
- This is the first version in the restart/extension-security slice that is actually aligned enough to publish.

### Restart and extension hardening remain the actual product delta

- `restart` checkpoint serialization now preserves real phase and turn identity.
- Dedicated subprocess proof covers abandoned active-turn reconnect and checkpoint updates through the public CLI.
- VS Code extension dependency advisories are closed via patched `undici` and `brace-expansion`.

### Evidence

- **2862 tests / 601 suites / 0 failures**
- `node --test cli/test/session-checkpoint.test.js cli/test/restart-cli.test.js`
- `cd cli && npm test`
- `cd cli/vscode-extension && npm audit --json`

## 2.34.1

`2.34.1` is the releasable cross-session continuity release.

### `restart` checkpoints now preserve the real phase and turn identity

- Fixed `cli/src/lib/session-checkpoint.js` to serialize checkpoint state from the actual governed runtime shape:
  - `last_phase` now falls back to `state.phase`
  - `last_turn_id` recognizes both `id` and `turn_id`
  - `last_role` recognizes both `role` and `assigned_role`
- This closes a real continuity bug where `approve-transition` could leave `session.json.last_phase = null`, which is unacceptable on a recovery feature.

### `restart` now has the missing subprocess proof

- Added dedicated CLI subprocess coverage for:
  - reconnecting to an abandoned active turn in a fresh process
  - proving that `accept-turn` and `approve-transition` both update `session.json`
- The new proof immediately caught the checkpoint serializer defect above, which is exactly why this coverage needed to exist.

### The restart contract is now honest about stale checkpoints

- The spec now matches the shipped behavior for `session.json` / `state.json` run-id drift:
  - `state.json` remains source of truth
  - stale checkpoint mismatch warns
  - restart proceeds instead of rejecting a recoverable run

### VS Code extension advisories are closed

- Updated the vendored extension dependency set to patched transitive versions:
  - `undici@6.24.0`
  - `brace-expansion@1.1.13`
- `cd cli/vscode-extension && npm audit --json` now reports **0 vulnerabilities**.

### Evidence

- **2862 tests / 601 suites / 0 failures**
- `node --test cli/test/session-checkpoint.test.js cli/test/restart-cli.test.js`
- `cd cli && npm test`
- `cd cli/vscode-extension && npm audit --json`

## 2.33.1

`2.33.1` is the cross-machine continuity restore release.

### Governed runs can now move across checkouts without changing `run_id`

- Added `agentxchain restore --input <path>`.
- Operators can now:
  - export governed state from machine A
  - restore it into another checkout of the same repo on machine B
  - continue the same governed run with `agentxchain resume`
- This is intentionally narrow and truthful. It is not a general sync engine and it does not claim arbitrary source migration.

### Run exports now declare whether they are safely restorable

- Run export schema advanced to `0.3`.
- Export artifacts now include `workspace.git` metadata:
  - `is_repo`
  - `head_sha`
  - `dirty_paths`
  - `restore_supported`
  - `restore_blockers`
- Restore fails closed when the source export depended on dirty files outside the governed continuity roots, when the target checkout is dirty, or when the target `HEAD` does not match the exported commit.

### Continuity exports include the governed state required for honest restore

- Run exports now include the continuity surfaces that matter for multi-machine governed work:
  - `TALK.md`
  - `.planning/`
  - `.agentxchain/reviews/`
  - `.agentxchain/proposed/`
  - `.agentxchain/reports/`
- This keeps the restore slice honest: decisions, reviews, proposals, reports, and operator planning context survive the machine hop with the run state.

### Restore now handles empty exported files correctly

- Fixed a real contract bug during the release turn:
  - export verification already allowed empty `content_base64`
  - restore incorrectly rejected it
- Added round-trip coverage proving empty governed files survive export -> restore.

### Evidence

- **2848 tests / 599 suites / 0 failures**
- `node --test cli/test/restore-cli.test.js`
- `node --test cli/test/docs-restore-content.test.js cli/test/docs-cli-command-map-content.test.js cli/test/export-cli.test.js cli/test/verify-export-cli.test.js cli/test/coordinator-export-cli.test.js cli/test/export-schema-content.test.js`
- `cd cli && npm test`
- `cd website-v2 && npm run build`

## 2.32.0

`2.32.0` is the governed product examples release.

### Public docs now expose the five end-to-end governed product examples

- Added a dedicated Docusaurus docs page at `/docs/examples` covering all five shipped products:
  - Habit Board
  - Trail Meals Mobile
  - Async Standup Bot
  - Decision Log Linter
  - Schema Guard
- Each example now has public operator-facing documentation for:
  - category
  - team shape
  - workflow phases
  - key workflow-kit artifacts
  - exact local run commands
- This closes a real discoverability defect. The examples were already in-repo, but not surfaced as a coherent public proof portfolio.

### Front-door discovery now links the examples portfolio from multiple surfaces

- Added `Examples` to the docs sidebar.
- Added `Examples` to the website footer.
- Added a homepage `Examples` section linking directly to `/docs/examples`.
- Added code-backed discoverability coverage so this surface is not unguarded docs drift.

### Governed provenance for examples is now part of the public contract

- The examples page now states the actual provenance boundary explicitly:
  - git history is the build trail
  - example-local `TALK.md` files are the governed collaboration trail
  - workflow-kit artifacts are the governed artifact trail
  - `agentxchain template validate --json` is the config/workflow proof
- This preserves the truthful boundary from `.planning/PRODUCT_EXAMPLES_GOVERNED_PROOF.md` instead of pretending copied orchestrator state proves anything.

### Evidence

- **2837 tests / 596 suites / 0 failures**
- `node --test cli/test/docs-examples-content.test.js`
- `cd cli && npm test`
- `cd website-v2 && npm run build`

## 2.31.0

`2.31.0` is the workflow-kit operator observability release.

### `agentxchain report` now exposes workflow-kit artifact status directly

- Governed run reports now include `subject.run.workflow_kit_artifacts` in JSON output.
- Each artifact row carries:
  - `path`
  - `required`
  - `semantics`
  - `owned_by`
  - `owner_resolution`
  - `exists`
- This closes the operator-observability gap left by `2.30.0`: workflow-kit truth is no longer visible only to the active agent prompt/context surfaces.

### Text and markdown reports now render a first-class Workflow Artifacts section

- `agentxchain report --format text` now prints a `Workflow Artifacts (<phase> phase)` section when the current phase declares workflow-kit artifacts.
- `agentxchain report --format markdown` now renders a `## Workflow Artifacts` section with a stable table for tickets, PRs, and audit trails.
- The section is omitted when `workflow_kit` is absent or when the current phase declares zero artifacts.

### Export scope now includes `.planning/` because governed artifacts must be observable

- Governed export artifacts now include `.planning/` in the allowed roots.
- This is not optional polish. Workflow-kit gates explicitly reference governed artifact files under `.planning/`, so report-time existence checks must be able to observe them from the export artifact itself.
- Report existence is still checked against exported file keys, not the live filesystem, preserving the verified-export contract.

### Docs now state the JSON `null` vs `[]` distinction explicitly

- `subject.run.workflow_kit_artifacts = null` means `workflow_kit` is absent from config.
- `subject.run.workflow_kit_artifacts = []` means `workflow_kit` exists but the current phase declares zero artifacts.
- Text/markdown output omits the section in both cases, but the JSON distinction remains part of the operator contract.

### Evidence

- **2789 tests / 590 suites / 0 failures**
- `node --test cli/test/workflow-kit-report.test.js`
- `node --test cli/test/governance-report-content.test.js`
- `cd cli && npm test`
- `cd website-v2 && npm run build`

## 2.30.0

`2.30.0` is the workflow-kit runtime accountability release.

### Workflow-kit is now visible at dispatch time, not only at gate failure

- `CONTEXT.md` now renders a phase-wide `Workflow Artifacts` section showing the current phase artifact contract before the agent starts work.
- The section shows artifact path, required vs optional, semantics, owner, and on-disk existence status.
- `review_only` roles also get artifact previews in `CONTEXT.md`, reusing the existing gate-file preview contract instead of inventing a second preview surface.

### `PROMPT.md` now names the current role's workflow responsibilities explicitly

- `PROMPT.md` now renders a role-scoped `Workflow-Kit Responsibilities` section instead of making the agent infer ownership from the full phase table.
- Ownership resolution is now explicit and stable:
  - `owned_by` wins when present
  - otherwise responsibility falls back to the current phase `entry_role`
- The prompt only lists the current role's accountable artifacts; it does not duplicate the full phase contract.

### Review-only ownership is attestation, not fake authorship

- `review_only` roles no longer receive misleading "produce this file" guidance for workflow-kit artifacts they cannot write.
- Prompt guidance now differentiates:
  - `authoritative` / `proposed`: produce
  - `review_only`: review and attest
- Config validation now warns when a `review_only` role owns a required artifact and no writing role exists in the phase routing.
- Public adapter docs now state this boundary explicitly so runtime behavior, docs, and gate semantics agree.

### Evidence

- **2780 tests / 588 suites / 0 failures**
- Docusaurus production build passes

## 2.29.0

`2.29.0` is the remote-agent proof and automation-correctness release.

### `remote_agent`: shipped as a real governed connector surface

- Added the `remote_agent` adapter: synchronous HTTP POST dispatch for governed turns with config validation, secret-header redaction, and runtime integration through the public CLI.
- Added runnable bridge example under `examples/remote-agent-bridge/` with:
  - `server.js` for deterministic proof
  - `run-proof.mjs` for end-to-end CLI lifecycle proof
  - `model-backed-server.js` for real Anthropic-backed proof
  - `run-repeated-proof.mjs` for repeated reliability measurement

### Real-model proof: transport concession made explicit

- Proved that Claude Haiku can satisfy the governed turn-result contract through the `remote_agent` bridge for both `proposed` and `review_only` paths.
- Proved repeatability across 5 independent governed lifecycles: **5/5 PASS (100%)**, no retries, 10/10 logged outer-fence strips, no field-level repair.
- Tightened the proof boundary wording across spec/example/docs:
  - fence-free raw JSON remains the preferred transport shape
  - the actual invariant is **no field-level repair**
  - logged removal of one outer markdown-fence pair is allowed when the enclosed JSON is otherwise valid

### Automation truth: `step` validation failures now exit non-zero

- Fixed the `step` command to return exit code `1` when a staged turn result fails validation and is retained.
- This closes a real automation defect for scripts and CI that previously could misread a retained validation failure as success.

### Evidence

- **2752 node tests / 582 suites / 0 failures**
- Docusaurus production build passes

## 2.28.0

`2.28.0` is the security and integration release.

### Security: zero npm audit vulnerabilities

- **website-v2**: Upgraded Docusaurus 3.9.2 → 3.10.0, added `@docusaurus/faster`, and applied npm `overrides` for `serialize-javascript@^7.0.5` — closing all 18 high vulnerabilities.
- **cli**: Updated `hono` and `@hono/node-server` — closing both moderate vulnerabilities.
- Both packages now report `0 vulnerabilities` from `npm audit --omit=dev`.

### Retired GitHub Pages deploy path

- Deleted `.github/workflows/deploy-pages.yml` (permanently broken; GCS is canonical).
- Updated deployment docs, specs, and regression guards to enforce the single GCS deploy contract.

### Built-in GitHub Issues reference plugin

- New `@agentxchain/plugin-github-issues` — mirrors governed run status into a configured GitHub issue.
- Fires on `after_acceptance` (turn summaries) and `on_escalation` (blocked/needs-human).
- One comment per run, updated in place. Manages `agentxchain:phase/*` and `agentxchain:blocked` labels while preserving non-AgentXchain labels.
- Advisory-only: no issue closure/reopen, no fabricated state (per `DEC-GITHUB-ISSUES-002`).
- Structured `warn` on token/API failure — never blocks the governed run.

### Evidence

- 2680 node tests / 570 suites / 0 failures.
- 0 vulnerabilities across both packages.
- Docusaurus production build passes.

## 2.27.0

`2.27.0` is the operator onboarding and multi-session continuity release.

This release ships the complete tutorial walkthrough (zero-API-key, copy-pasteable, E2E-proven), the multi-session continuity operator guide with cross-session phase approval proof, and tutorial contract repairs ensuring all front-door docs use truthful operator commands.

### Tutorial walkthrough: install-to-completion narrative

- New `docs/tutorial` page: 10-step walkthrough from `npm install` through `approve-completion` and `report`.
- Uses `manual-dev` and `manual-qa` adapters for zero-API-key reproducibility.
- Exact gate file content for a concrete URL shortener project — operators can copy-paste through the entire lifecycle.
- 11 docs guard assertions covering lifecycle commands, gate content, turn-result examples, and discovery surface inclusion.

### Tutorial contract repair

- Tutorial, getting-started, and first-turn pages now use `init --dir .` (not bare `init`).
- Tutorial explicitly rebinds `dev` to `manual-dev` and `qa` to `manual-qa` before claiming a fully manual path.
- Removed fake implementation→QA approval step that didn't match real governance flow.
- New subprocess E2E (`e2e-tutorial-walkthrough.test.js`) proves the exact operator loop described in the tutorial.

### Multi-session continuity

- New `docs/multi-session` operator guide: how governed runs survive across terminal sessions, machine reboots, and agent handoffs.
- Cross-session phase approval E2E: proves `approve-transition` works in a fresh session against state persisted by a prior session.
- Multi-session completion E2E: proves `approve-completion` across session boundaries.

### Evidence

- 2676 node tests / 570 suites / 0 failures.
- Docusaurus production build passes.

## 2.26.0

`2.26.0` is the charter enforcement and enterprise template release.

This release ships artifact ownership enforcement (`owned_by`), the complete enterprise-app blueprint template with scaffold-to-runtime proof, dynamic ROADMAP generation from routing, open-ended role support, SEO discoverability, community links, mobile navigation fix, and the vs-Warp comparison page.

### Charter enforcement: artifact ownership binding at gate time

- New optional `owned_by: "<role_id>"` field on workflow-kit artifact entries binds artifact ownership to a specific role.
- Gate evaluator checks that at least one accepted turn from the owning role exists in the current phase before the gate passes.
- Phase-scoped participation proof — not file-level attribution.
- Works for both phase-exit gates and run-completion gates.
- Optional artifacts with `owned_by` are only checked when the file exists.

### Enterprise-app template: scaffold-to-runtime proof

- Blueprint-backed `enterprise-app` template ships with 6 roles (pm, architect, dev, security_reviewer, qa, tech_writer), 5 phases (planning → architecture → implementation → security_review → qa), and ownership-enforced artifacts.
- `ARCHITECTURE.md` owned by `architect`, `SECURITY_REVIEW.md` owned by `security_reviewer`.
- Scaffold-to-runtime E2E proves the real operator path: scaffolded files survive into runtime without manual repair.

### Dynamic ROADMAP generation from routing

- Scaffolded `.planning/ROADMAP.md` phase table is now derived from `routing` keys and role mandates instead of a hardcoded 3-row table.
- Blueprint-backed templates with custom routing get a truthful phase table at scaffold time.

### Open-ended roles

- Removed hardcoded `VALID_PROMPT_OVERRIDE_ROLES` — any valid role ID is now accepted in template prompt overrides.

### SEO discoverability

- Added `robots.txt`, `llms.txt`, and `sitemap.xml` for both agentxchain.dev and agentxchain.ai.

### Community links

- Added X/Twitter and Reddit links to navbar, footer, and homepage.

### Mobile navigation fix

- Fixed `.navbar-sidebar__items` collapsing to zero height on narrow desktop viewports due to `backdrop-filter: blur(20px)` creating a CSS containing block.

### vs-Warp comparison page

- New comparison page: AgentXchain vs Warp.dev — honest, research-backed comparison.

### Evidence

- 2649 node tests / 566 suites / 0 failures.
- Docusaurus production build passes.

## 2.25.2

`2.25.2` is the workflow-kit release.

This release ships the complete workflow-kit subsystem: per-phase artifact contracts with semantic validators, runtime gate integration, template validate and scaffold integration, and operator-facing docs. It also fixes a real `template validate` defect where explicit empty `workflow_kit: {}` was not treated as an opt-out.

### Workflow-kit config: per-phase artifacts with semantic validators (Slice 1)

- New optional `workflow_kit` section in `agentxchain.json` lets operators declare per-phase artifacts with semantic validators (`section_check`, `pm_signoff`, `acceptance_matrix`, `release_notes`).
- Parser and validator support with `_explicit` flag to distinguish operator-declared configs from normalization defaults.
- Default behavior unchanged when `workflow_kit` is absent.

### Workflow-kit gate integration (Slice 2)

- Phase-exit and run-completion gates now build an effective artifact set from both `requires_files` and `workflow_kit.phases[phase].artifacts`.
- Duplicate paths are merged by path — not evaluated twice.
- Workflow-kit semantics augment legacy gate semantics; they do not replace them.
- Missing optional workflow-kit artifacts do not block.

### Workflow-kit template validate and scaffold integration (Slice 3)

- `template validate` now reflects declared workflow-kit artifacts in `required_files` and generates `structural_checks` from `semantics` declarations when workflow_kit is explicit.
- `init --governed` scaffolds custom artifact files when an explicit `workflow_kit` config is present, with `section_check` artifacts getting required sections pre-filled as markdown headings.
- Reinit reads existing config for `workflow_kit` before overwriting.

### Fixed: explicit empty `workflow_kit: {}` template validation opt-out

- `workflow_kit: {}` now correctly behaves as an opt-out during `template validate`.
- Previously, explicit empty `workflow_kit` still produced default required files and structural checks.

### Operator docs for workflow-kit

- `getting-started.mdx`, `templates.mdx`, and `adapters.mdx` now explain the `workflow_kit` config section, how custom artifacts are scaffolded/validated, and the boundary between `routing`, `gates.requires_files`, and explicit `workflow_kit`.

### Evidence

- 2606 node tests / 558 suites / 0 failures.
- Docusaurus production build passes.

## 2.25.1

`2.25.1` is the coordinator custom-phase proof patch.

`2.25.0` shipped operator-defined phases and ordered single-repo enforcement, but the coordinator custom-phase surface was still under-documented. This patch closes that gap: multi-repo docs now show the coordinator contract explicitly, and the shipped evidence surface now includes a dedicated subprocess proof for ordered coordinator custom phases.

### Multi-repo docs now explain coordinator custom phases directly

- `/docs/multi-repo` now shows a concrete `planning -> design -> implementation -> qa` coordinator example.
- The docs show the required matching child-repo `routing` shape.
- The docs state the coordinator rule plainly: `phase_transition_request` may only target the immediate next declared phase.
- The docs show the failure case too: `planning -> implementation` is rejected as `phase_skip_forbidden` when `design` exists between them.

This matters because coordinator workflow-shape drift is exactly where vague docs become operational errors.

### Coordinator custom-phase proof is now first-class evidence

- Added `cli/test/e2e-coordinator-custom-phases.test.js`.
- Happy path proves ordered transitions across two child repos and four phases.
- Negative path proves coordinator skip rejection without mutating coordinator state.
- `cli/test/multi-repo-docs-content.test.js` now guards the public docs against drifting away from that proof.

No coordinator runtime defect was found here. The implementation was already correct. What was missing was proof plus operator-facing contract language.

### Release surfaces remain synchronized

- Added the `v2.25.1` release-notes page and sidebar entry.
- Updated the homepage badge, conformance capabilities version, protocol implementor guide example, and launch evidence title.

### Evidence

- 86 node tests / 21 suites / 0 failures in focused coordinator proof and release/docs guards.
- Docusaurus production build passes.

## 2.25.0

`2.25.0` is the custom-phases release.

Previous releases assumed the governed lifecycle was permanently `planning -> implementation -> qa`. That contradicted the product vision. AgentXchain now supports operator-defined phase names in config, enforces declared phase order at runtime, and tells operators exactly where the default scaffold ends and custom-phase extension begins.

### Routing config can now declare custom phases

- Single-repo governed configs no longer hardcode `planning`, `implementation`, and `qa` as the only valid phases.
- Coordinator configs now derive valid phases from declared routing keys instead of rejecting any non-default name.
- Phase names must match `^[a-z][a-z0-9_-]*$` so they stay machine-safe and unambiguous.

This makes phases an operator-defined protocol surface instead of a hardcoded product assumption.

### Runtime phase transitions are now sequential and fail closed

- Single-repo runtime now enforces the same ordered phase contract as coordinator runtime.
- If routing declares `planning -> design -> implementation -> qa`, a turn may request only the immediate next phase.
- Final-phase turns may not request another phase transition and must use `run_completion_request`.
- Defense in depth exists in both turn-result validation and gate evaluation, so out-of-order transitions fail closed even if one layer is bypassed.

This closes a real protocol defect: single-repo runs previously accepted phase skips that coordinator runs already rejected.

### Scaffold and docs now explain the product boundary honestly

- `agentxchain init --governed` now prints `Phases: planning -> implementation -> qa (default; extend via routing in agentxchain.json)`.
- `getting-started.mdx` now has a dedicated custom-phases section with a concrete `design`-phase example.
- `adapters.mdx` documents the runtime contract: phase order comes from declaration order, custom phases require operator-supplied gate files, and only the immediate next phase is valid.

This matters because the default scaffold is still intentionally three-phase. Operators need to know that is a starting point, not the full product boundary.

### Evidence

- 3357 node tests / 0 failures.
- Docusaurus production build passes.

## 2.24.3

`2.24.3` is a coordinator-operator visibility release.

Previous releases built the coordinator execution surface (multi-repo orchestration, phase gates, blocked-state recovery, run-identity guards). But the dashboard and report surfaces were still presenting coordinator state as flat metadata strings. `2.24.3` closes that gap: coordinator blockers are now a structured, inspectable operator surface from CLI reports through the dashboard.

### Coordinator child run identity guard

Coordinator gates now verify that each child repo's `run_id` matches the expected value from the coordinator's `super_run_id` binding. When a child repo has been reset or restarted outside the coordinator's control, the gate rejects with `repo_run_id_mismatch` instead of silently proceeding against stale state. Recovery uses `agentxchain multi resume`.

### `repo_run_id_mismatch` in coordinator reports and CLI

`agentxchain multi step` and governed-run reports now surface `repo_run_id_mismatch` as a structured diagnostic with repo_id, expected run_id, and actual run_id — not a flat prose blocker string. The multi-repo docs include the new blocker code and recovery path.

### Dashboard coordinator blocker API and panel

New `/api/coordinator/blockers` endpoint computes a normalized blocker snapshot server-side using the existing gate evaluation library. Returns mode (`pending_gate`, `phase_transition`, `run_completion`), gate context, blocker codes, and structured detail for each blocker.

New **Blockers** dashboard view renders this snapshot as a pure display panel — no client-side gate logic. Renders mode badge, gate context, blocker codes with color coding, `repo_run_id_mismatch` expected/actual run_id diagnostic, and mode-aware recovery commands.

### Initiative view structured blocker integration

The initiative dashboard view now consumes the computed blocker snapshot instead of flattening coordinator state into a `blocked_reason` string. Coordinator attention state shows mode, gate context, and structured blocker details with a link to the full Blockers panel.

### Evidence

- 2537 node tests / 546 suites / 0 failures.
- Docusaurus production build passes.

## 2.24.2

`2.24.2` is an onboarding-truth patch release.

`2.24.1` closed the launch evidence gaps, but the shipped operator experience still had one inconsistency: `step` told no-key evaluators exactly how to recover a QA credential failure, while `run` only failed with the provider error. `2.24.2` closes that CLI drift and rolls the already-shipped mobile-nav fix into the next published package boundary.

### `run` now tells the truth on missing QA credentials

- `agentxchain run` now emits the same first-party no-key QA fallback as `agentxchain step` when a QA `api_proxy` dispatch fails with `missing_credentials`.
- The guidance is narrow and explicit:
  - edit `roles.qa.runtime` from `api-qa` to `manual-qa`
  - recover the retained QA turn with `agentxchain step --resume`
  - follow the getting-started guide for the mixed-mode scaffold
- This only appears when the failing role is `qa`, the runtime is the default `api-qa`, and the raw config actually defines the built-in `manual-qa` runtime. No generic "just rebind something" hand-waving.

### Automated onboarding proof now covers the real `run` path

- `run-api-proxy` integration coverage now proves the no-key QA path through the real `agentxchain run` surface.
- The test asserts the operator-facing contract, not just process failure:
  - non-zero exit
  - no outbound API request
  - missing env-var naming
  - explicit `manual-qa` fallback
  - exact `roles.qa.runtime` edit
  - truthful recovery command `agentxchain step --resume`
  - getting-started docs link

### The mobile-nav fix is now part of the released version boundary

- The narrow-width website nav collapse fix from `main` is included in the published version line after living on the website ahead of npm.
- The root cause remains the same: `backdrop-filter` on `.navbar` created a containing block for the fixed sidebar. The shipped fix disables that blur when the sidebar is shown, which is visually inert because the overlay covers the navbar anyway.

### Evidence

- 2503 node tests / 540 suites / 0 failures.
- 774 Vitest tests / 36 files / 0 failures.
- Docusaurus production build passes.

## 2.24.1

`2.24.1` is the corrected evidence-closure release.

`2.23.0` made proposal authority honest. `2.24.0` was an unpublished release-candidate tag that failed strict preflight because the public evidence sections lost their concrete node-test counts. `2.24.1` is the corrected public cut. It closes the remaining launch-critical proof gaps: MCP is now proven live against a real Anthropic model, Scenario D escalation and operator recovery are dogfooded end to end, and release postflight now verifies the public package through an isolated `npx -p` execution path instead of assuming npm visibility equals executable truth.

### MCP is now proven through a real model behind a real MCP server

- Added `examples/mcp-anthropic-agent/`, a thin stdio MCP server that exposes `agentxchain_turn` and forwards it to the Anthropic Messages API.
- Added `examples/live-governed-proof/run-mcp-real-model-proof.mjs`, which drives the governed CLI through the MCP adapter and proves the real provider path.
- The governed acceptance boundary now has concrete live evidence for: CLI -> MCP adapter -> MCP stdio transport -> MCP server -> Anthropic API -> JSON extraction -> validation -> acceptance.

### Scenario D escalation and recovery are now proven end to end

- Added `examples/live-governed-proof/run-escalation-recovery-proof.mjs`.
- The proof exercises retry exhaustion, run blocking, retained failed turn state, operator recovery, corrected dev acceptance, and `eng_director` intervention in one continuous governed path.
- This closes the gap between escalation logic existing in tests and escalation behavior being exercised through the real CLI workflow.

### Release postflight now proves the public `npx` path

- `cli/scripts/release-postflight.sh` now runs an isolated `npx --yes -p agentxchain@<version> -c "agentxchain --version"` smoke check with temp HOME/cache/npmrc state.
- This form matters. `npx agentxchain@<version> --version` is ambiguous under modern npm because `--version` can be consumed by `npm exec` instead of the package binary.
- Release postflight no longer stops at registry metadata and install smoke. It now verifies that the public package actually resolves and executes the way first-run users will invoke it.
- `RELEASE_POSTFLIGHT_SPEC.md` and `release-postflight.test.js` were updated to make that contract fail closed.

### Evidence

- 2486 node tests / 534 suites / 0 failures.
- 774 Vitest tests / 36 files / 0 failures.
- Docusaurus production build passes.

## 2.23.0

`2.23.0` is a proposal-authority release.

`2.22.0` closed budget and escalation recovery truth. `2.23.0` closes the cloud-agent authorship gap: API-backed agents can now propose governed file changes, operators can apply or reject them explicitly, gates fail closed until proposals are materialized, and the full completion path is proven live against a real provider.

### `api_proxy` proposal authoring is now shipped

- `write_authority: "proposed"` is now a first-class runtime contract for `api_proxy` roles.
- Proposed file changes are materialized under `.agentxchain/proposed/<turn_id>/` instead of being silently treated as workspace writes.
- Operators now have explicit proposal workflows: inspect, apply, or reject proposed files before continuing the governed run.
- Reserved internal orchestrator paths are rejected at the proposal boundary instead of being allowed to masquerade as product work.

### Proposal-aware gates and completion now fail closed

- Implementation-exit and run-completion gates now reject proposal-only state until the operator has applied the proposed files into the workspace.
- Completion-only proposed turns can now truthfully request `run_completion_request: true` with a no-op payload (`proposed_changes: []`, `files_changed: []`) instead of being forced into fake work delivery.
- Final-phase dispatch guidance now tells proposed roles exactly how to emit a completion turn instead of leaving the model to guess.

### Live proposed-authority proof is now real

- Full hardened live proof now passes against Anthropic Claude Sonnet 4.6: `run_7b067f892916b799`.
- Proposal turn `turn_78181787ad6ab3a7` emitted gate-valid `## Changes` and `## Verification` content from the real provider.
- Completion turn `turn_0ebc2190d01230ea` requested `run_completion_request: true`, paused on `pending_run_completion`, and completed only after human approval.
- The live proof harness now persists rejected provider payloads under `.planning/LIVE_PROOF_DIAGNOSTICS/` on failure so future reruns produce inspectable evidence instead of cleanup-amnesia.

### Cost truth is now operator-owned

- `config.budget.cost_rates` now overrides bundled defaults, so AgentXchain does not pretend to maintain a complete provider/model pricing catalog.
- Anthropic bundled defaults were corrected to the real published rates used in-product (`claude-opus-4-1-20250805`: `$15/$75` -> `$5/$25`; `claude-haiku-4-5-20251001`: `$0.80/$4.00` -> `$1.00/$5.00`).
- Bundled rates were renamed to `BUNDLED_COST_RATES` to make the boundary explicit: they are defaults, not the source of truth.

### Evidence

- 2476 node tests / 532 suites / 0 failures.
- 761 Vitest tests / 36 files / 0 failures.
- Docusaurus production build passes.

## 2.22.0

`2.22.0` is a governance depth release.

`2.21.0` closed front-door truth gaps. `2.22.0` closes the governance runtime gaps: cost control, escalation recovery, and operator guidance truthfulness.

### Budget enforcement

- `per_run_max_usd` and `on_exceed: 'pause_and_escalate'` are now enforced at runtime. Previously scaffolded as dead config.
- Post-acceptance exhaustion transitions the run to `blocked` with `budget_exhausted` category.
- Pre-assignment guard rejects new turns when the budget is already exhausted.
- Per-turn overrun warning emitted when actual cost exceeds reservation (advisory only).

### Budget recovery

- Operator raises `per_run_max_usd` in `agentxchain.json`, then `agentxchain resume` assigns the next turn.
- Budget is reconciled from config at load time, so `agentxchain status` shows current headroom.
- Proven through real CLI subprocess execution.

### Escalation recovery E2E proof

- Both escalation paths (retained-turn and run-level) are now proven through real CLI subprocess execution.
- Decision ledger contains `operator_escalated` and `escalation_resolved` entries after the full cycle.

### Runtime-aware escalation guidance

- Recovery action strings now vary by runtime type: `agentxchain resume` for manual runtimes, `agentxchain step --resume` for non-manual.
- Targeted multi-turn escalation appends `--turn <id>`.
- Stale pre-2.22.0 recovery actions are reconciled at load time.

### OpenAI cost rates

- Added built-in cost rates for 8 OpenAI models: `gpt-4o`, `gpt-4o-mini`, `gpt-4.1`, `gpt-4.1-mini`, `gpt-4.1-nano`, `o3`, `o3-mini`, `o4-mini`.
- Unlisted models still work but report `$0` cost — adapter docs state this explicitly.

### Multi-provider governed proof harness

- Added `examples/live-governed-proof/run-multi-provider-proof.mjs` with mock-backed contract test.
- Proves multi-provider governed orchestration under deterministic mocks. Live execution blocked only by `OPENAI_API_KEY`.

### Evidence

- 2394 node tests / 514 suites / 0 failures.
- Docusaurus production build passes.

## 2.21.0

`2.21.0` is a truth-surface release.

`2.20.0` hardened release identity, but the product still had an honesty gap in the front door: onboarding docs had drifted from the real scaffold, several operator docs overstated or omitted shipped behavior, and comparison pages were unguarded marketing copy against moving competitors.

### Release completeness now fails closed in CI

- The publish workflow now treats downstream truth as a completion gate instead of advisory follow-through.
- Canonical Homebrew tap state must be provably current before the release workflow can finish green.
- The release playbook and release-doc guards were updated to match the shipped CI contract instead of a softer operator story.

### The onboarding path is now audited against the real scaffold

- Added `/docs/first-turn` as the bridge from `agentxchain demo` to a real governed repo.
- Audited `quickstart`, `templates`, `adapters`, `cli`, and `protocol` docs against actual CLI behavior and scaffold output.
- Added code-backed guards so these pages fail when examples drift from the shipped product surface.

### Comparison pages are now guarded public truth surfaces

- Refreshed all four shipped comparison pages against current official sources:
  - OpenAI Agents SDK: sessions, tracing, provider-agnostic model support, resumable HITL interrupts
  - CrewAI: task guardrails, checkpoint/resume, `@human_feedback`
  - LangGraph: `Command`, parallel supersteps, subgraphs, checkpoint-backed interrupts
  - AG2 / AutoGen: guardrails, Swarm-style handoffs, A2A / AG-UI support
- Added `comparison-pages-content.test.js` so homepage/nav routes, required page sections, and competitor-strength claims stay anchored to the positioning matrix.

### Evidence

- 2372 node tests / 511 suites, 0 failures.
- 761 Vitest tests / 36 files, 0 failures.
- Docusaurus production build passes.

## 2.20.0

The release path is now harder to lie about. This release replaces raw `npm version` with a fail-closed release-identity command, marks downstream Homebrew truth as required for release completion, and proves the new contract with execution-level tests instead of string-matching shell scripts.

### Release Identity Hardening

- Added `npm run bump:release -- --target-version <semver>` as the supported release-identity path.
- `release-bump.sh` now:
  - runs `npm version --no-git-tag-version`
  - creates commit `<semver>`
  - creates annotated tag `v<semver>`
  - verifies the tag is an annotated tag object
  - verifies the tag dereferences to the release commit before exiting 0
- Raw `npm version <semver>` is no longer the documented release-identity mechanism.

### Downstream Truth Is Required

- `.planning/RELEASE_PLAYBOOK.md` now marks both downstream update and downstream truth verification as required steps.
- The playbook now states explicitly that a stale canonical Homebrew tap means the release is incomplete.
- When CI cannot push the canonical tap because `HOMEBREW_TAP_TOKEN` is absent, the operator contract now requires local `sync:homebrew --push-tap` follow-through instead of treating the warning as sufficient.

### Execution-Level Proof

- Added subprocess release-identity tests that create a temp git repo rooted above `cli/`, run `release-bump.sh`, and assert:
  - `package.json` and `package-lock.json` are updated
  - the release commit message is `<semver>`
  - the tag object is annotated
  - the tag dereferences to `HEAD`
- Added fail-closed tests for dirty-tree rejection and pre-existing target tags.

### Evidence

- 2338 node tests / 508 suites, 0 failures.
- 758 Vitest tests / 36 files, 0 failures.
- `release-bump.sh` temp-repo proof passes, including dirty-tree and pre-existing-tag failure cases.

## 2.19.0

AgentXchain now has an honest one-command first-run path. This release ships the `demo` command, moves the adoption funnel to demo-first across the front door, upgrades the demo narrative to a security-sensitive scenario that actually demonstrates governance value, and prevents baseline evidence paths from poisoning later governed turns.

### Demo-First Adoption

- Added `agentxchain demo`, a one-command governed lifecycle walkthrough that runs in a temp git workspace, stages real turn results through the runner interface, and cleans up automatically.
- Front-door adoption surfaces now lead with `npx agentxchain demo`:
  - root `README.md`
  - `cli/README.md`
  - homepage hero CTAs
  - quickstart Path 0
- Discoverability guards now fail if the demo falls out of the README, package README, quickstart, or homepage.

### Higher-Signal Demo Narrative

- The demo story now centers on auth token rotation instead of a toy counter app.
- PM, Dev, and QA objections now surface consequence-bearing failures:
  - missing rollback path could invalidate live API keys
  - clock skew could skip or double-rotate keys
  - missing failure-audit entries create a compliance gap
- Demo lessons now explain the cost of ungoverned delivery instead of restating abstract governance rules.

### Baseline Evidence Hardening

- `.planning/AGENT-TALK.md`, `.agentxchain/reviews/`, and `.agentxchain/reports/` no longer poison the next governed actor's baseline-dirty check.
- Evidence paths remain observable for the turn that creates them, but unchanged pre-existing evidence dirt is filtered out of later same-HEAD and head-changed observation.
- Authoritative follow-up turns can now succeed without committing derived review/report artifacts first.

### Evidence

- 2315 node tests / 499 suites, 0 failures.
- 758 Vitest tests / 36 files, 0 failures.
- Docusaurus production build passes.
- Demo proof: `agentxchain demo` completes in ~1.1s with 5 decisions and 3 objections.

## 2.18.0

The governed lifecycle now works correctly in git-backed workspaces with proper artifact observation, all four adapter types have live execution evidence (MCP at transport level), and the full governed completion path is proven end to end.

### Live Connector & Completion Proof

- All four adapter types (`manual`, `local_cli`, `api_proxy`, `mcp`) now have live CLI execution evidence through real `agentxchain step` dispatch.
- MCP proof covers both `stdio` and `streamable_http` transports (transport-level with echo agents, not model-level).
- Terminal governed completion is proven live: `pending_run_completion` → `approve-completion` on a retained workspace.
- Governed PM signoff DX hardened: scaffolds ship with `Approved: NO` by default, with explicit guidance on the human-approval flip.

### Artifact Observation Fixes

- `compareDeclaredVsObserved` now degrades gracefully when git observation is unavailable instead of manufacturing phantom-artifact failures from an empty diff.
- Context-section parser now correctly handles `### Verification` subsections and code blocks containing markdown headers within `Gate Required Files`.
- CI proof scripts and test fixtures now initialize proper git repos so the repo-observer can detect file changes across turns.

### QA & Evidence Depth

- QA evidence visibility: verification details, changed-file previews, dispatch-log excerpts, and gate-file content previews now surface in review context.
- Turn-result normalization handles `artifacts_created` object coercion, exit-gate-to-phase correction, missing-status recovery, and terminal completion signaling.
- Phase-aware prompt guidance ensures authoritative roles request explicit phase transitions.
- Review-turn context now includes bounded changed-file previews and semantic gate-file annotations.

### Evidence

- 2290 node tests / 495 suites, 0 failures.
- Conformance: 81 / 81 fixtures passing across all tiers.
- Live completion: `run_91f4ba5d54707a7e` completed at `2026-04-07T11:14:16.734Z`.
- Live MCP dogfood: `turn_e41e35ba8eea9768` (stdio), `turn_5292f4de9e01ea71` (streamable_http).

## 2.17.0

Protocol conformance now proves the workflow-kit semantics it previously left implicit, and the public implementor guide now states the exact fixture-backed contract for every shipped surface instead of collapsing proof into slogans.

### Workflow Gate Conformance Expansion

- Tier 1 `gate_semantics` now proves semantic failures for:
  - `.planning/SYSTEM_SPEC.md` missing required sections
  - `.planning/IMPLEMENTATION_NOTES.md` scaffold-placeholder content
  - `.planning/acceptance-matrix.md` placeholder requirement tables
  - `.planning/RELEASE_NOTES.md` placeholder ship-surface content
- The Tier 1 corpus increased from `46` to `50` fixtures.
- The total conformance corpus increased from `74` to `81` fixtures across all three tiers.

### Implementor Guide Truth Contracts

- `/docs/protocol-implementor-guide` now enumerates the concrete fixture-backed invariants for all shipped surfaces:
  - Tier 1: `state_machine`, `turn_result_validation`, `gate_semantics`, `decision_ledger`, `history`, `config_schema`
  - Tier 2: `dispatch_manifest`, `hook_audit`
  - Tier 3: `coordinator`
- Section-aware docs guards now fail if any surface regresses back to vague summary text while the fixture corpus still proves specific invariants.
- Release-surface version truth stays aligned across the homepage badge, `capabilities.json`, release notes, and the implementor-guide example.

### Evidence

- 2224 node tests / 489 suites, 0 failures.
- 705 Vitest tests / 36 files, 0 failures.
- Conformance: 81 / 81 fixtures passing across all tiers (Tier 1: 50, Tier 2: 23, Tier 3: 8).
- Docusaurus production build passes.
- npm publish verified: `agentxchain@2.17.0` live on registry.

## 2.16.0

Coordinator governance reporting is now operational instead of partial, workflow-kit gates now enforce the repo-native planning contract they already claimed to depend on, and external consumers can dispatch a real adapter-backed turn from the published package boundary.

### Coordinator Governance Report Completion

- Coordinator exports now write real decision-ledger entries during init, dispatch, gate, and recovery flows instead of exposing an empty report surface.
- `agentxchain report` for coordinator workspaces now includes:
  - coordinator timeline
  - coordinator timing
  - barrier summary
  - barrier transition history from `barrier-ledger.jsonl`
  - deterministic next actions from verified coordinator state
  - coordinator decision digest from `decision-ledger.jsonl`
- Coordinator report docs were updated in the same slice so the operator contract matches the shipped JSON, text, and markdown surfaces.

### Workflow-Kit Gate Truth

- Governed planning now fails closed when the scaffolded workflow-kit contract drifts:
  - baseline planning system spec enforcement
  - template-specific `SYSTEM_SPEC.md` overlays
  - implementation-exit gate requires `IMPLEMENTATION_NOTES.md`
  - QA gate enforces acceptance-matrix semantics
  - ship gate enforces release-notes presence
- These checks turn repo-native planning/docs artifacts into real gate inputs instead of dead files that the product claimed to care about but did not enforce.

### Adapter-Backed External Consumer Starter

- `examples/external-runner-starter/run-adapter-turn.mjs` now proves the published `agentxchain/adapter-interface` boundary from a clean consumer install.
- The starter uses `dispatchLocalCli`, generates its own deterministic mock agent at runtime, and drives a real dispatch → stage → accept flow.
- Pack-and-install proof now guards both external adoption paths:
  - manual runner-interface starter
  - adapter-backed starter

### Evidence

- 2186 node tests / 483 suites, 0 failures.
- Tier 1: 46 / 46 conformance fixtures passing.
- Docusaurus production build passes.
- npm publish verified: `agentxchain@2.16.0` live on registry.

## 2.15.0

The intake-to-coordinator workflow is now proven end to end: handoff, blocked-state recovery, hook-stop asymmetry, and repo-local intake-to-run automation continuity all ship with real subprocess E2E proofs.

### Intake-to-Coordinator Handoff

- `intake handoff` bridges source-repo intent to a coordinator workstream, bound by `super_run_id`.
- Coordinator context (`COORDINATOR_CONTEXT.json` and `.md`) is rendered into coordinator artifacts as informational references.
- Coordinator-root intake errors now enumerate child repos instead of returning opaque failures.
- Handoff is front-door discoverable in README, cli README, quickstart, and multi-repo docs.
- E2E proof: `e2e-intake-coordinator-handoff.test.js` drives real CLI dispatch through `multi step`, `accept-turn`, and `multi approve-gate`.

### Blocked-State Recovery

- New `multi resume` command recovers coordinators from `blocked` state.
- `multi resume` resyncs child repos first, fails closed on blocked children, restores `active` or `paused`, and records `blocked_resolved` history entries.
- `intake resolve` now accepts `blocked` as a valid source state, enabling the same run/workstream to recover to `completed`.
- E2E proof: `e2e-intake-coordinator-blocked.test.js` uses a real `after_acceptance` tamper-detection hook violation to drive `blockCoordinator()`.

### Coordinator Hook-Stop Asymmetry

- Pre-action hooks are idempotent barriers that reject operations without persisting `blocked` state.
- Post-action hooks can persist `blocked` and fire `on_escalation`.
- The distinction is now documented, spec'd (`COORDINATOR_HOOK_ASYMMETRY_SPEC.md`), and guarded by `coordinator-hook-asymmetry.test.js`.

### Intake-to-Run Integration

- `intake start` hands off to `agentxchain run` through the same `run_id` — the runner adopts the intake-started run rather than silently creating a new one.
- E2E proof: `e2e-intake-run-integration.test.js` drives the full `record → triage → approve → plan → start → run → resolve` sequence through CLI subprocesses.

### Interface Alignment Barriers

- Real `interface_alignment` barriers shipped with end-to-end multi-repo docs example.
- Runner adoption docs tightened with Tier 3 conformance requirements.

### Evidence

- 2048 node tests / 457 suites, 0 failures.
- 694 Vitest tests / 36 files, 0 failures.
- Tier 1: 46 fixtures. Total conformance corpus: 74 fixtures.
- Docusaurus production build passes.

## 2.14.0

External runner adoption is now a real package contract instead of a docs promise. This release adds a canonical installed-package starter, proves the packed tarball works in a clean consumer project, and extends release postflight so a publish is not complete unless the public runner exports import successfully.

### External Runner Package Contract

- New `examples/external-runner-starter/run-one-turn.mjs` provides the canonical installed-package one-turn starter for external runner authors.
- New `examples/external-runner-starter/README.md` distinguishes repo-native CI proof scripts from the installed-package starter instead of pretending they are the same surface.
- New `external-runner-package-contract.test.js` packs the real tarball, installs it into a temp project, and runs the starter through `agentxchain/runner-interface`.

### Runner Docs And Example Accuracy

- `/docs/build-your-own-runner` and `/docs/runner-interface` now name `agentxchain/runner-interface` and `agentxchain/run-loop` as the external contract, not repo source paths.
- Runner docs now explicitly separate repo-native proofs (`examples/ci-runner-proof/`) from external-consumer starter code.
- The repo-native proof README now states its real purpose instead of implying that external consumers should copy repo-relative imports.

### Release Truth Hardening

- `release-postflight.sh` now fails closed unless the published package passes both smoke surfaces:
  - CLI binary execution
  - runner package export import (`agentxchain/runner-interface` and `agentxchain/run-loop`)
- `release-postflight.test.js` now guards runner-export smoke, including the failure path where the published interface version drifts.

### Evidence

- 1970 node --test tests / 441 suites, 0 failures.
- 684 Vitest tests / 36 files, 0 failures.
- Tier 1: 46 fixtures. Total conformance corpus: 74 fixtures.
- Website production build passes.

## 2.13.0

Multi-repo onboarding is now front-door discoverable, and the protocol conformance kit proves the semantic workflow gates it already claimed to enforce.

### Multi-Repo Onboarding

- The multi-repo cold-start path is now linked from all front-door surfaces: root `README.md`, `cli/README.md`, and the landing page.
- New guard coverage prevents multi-repo mentions from regressing back into feature-name-only dead ends with no onboarding pointer.
- The shipped `/docs/quickstart#multi-repo-cold-start` walkthrough is now the explicit operator path for coordinator setup.

### Protocol Conformance Expansion

- Tier 1 `gate_semantics` now proves `evaluateRunCompletion()` directly instead of stopping at phase-exit behavior.
- New fixtures prove negative semantic truth for `.planning/PM_SIGNOFF.md` and `.planning/ship-verdict.md`, including rejected signoff, missing approval marker, non-affirmative ship verdict, human-approval pause, immediate completion, and non-final-phase rejection.
- The reference conformance adapter now supports `evaluate_run_completion`, so third-party implementations can prove the same ship-verdict contract the reference CLI enforces.

### Release Surface Hardening

- `capabilities.json` and the protocol implementor guide example are now version-synced and guarded.
- New `current-release-surface.test.js` enforces that package version, changelog, release-notes route, sidebar, homepage badge, capabilities example, and implementor guide example stay aligned.

### Evidence

- 1949 node --test tests / 437 suites, 0 failures.
- 684 Vitest tests / 36 files, 0 failures.
- Tier 1: 46 fixtures. Total conformance corpus: 74 fixtures.
- Website production build passes.

## 2.12.0

Governed gates now enforce semantic truth, not just file presence. Scaffold ergonomics and docs accuracy improved across the board.

### Semantic Workflow Gate Enforcement

- Phase-transition gates now require `.planning/PM_SIGNOFF.md` to contain `Approved: YES`. File existence alone no longer satisfies the planning gate.
- Run-completion gates now require `.planning/ship-verdict.md` to carry an affirmative `## Verdict:` value (`YES`, `SHIP`, or `SHIP IT`). Placeholder verdicts fail the gate.
- `template validate` remains scaffold-integrity proof only — it does not pretend to certify gate readiness. Docs and CLI output now explicitly distinguish the two.
- New `cli/src/lib/workflow-gate-semantics.js` module: pure-function semantic evaluators consumed by the gate evaluator.

### Scaffold Ergonomics

- `agentxchain init --governed` now accepts `--dir <path>` for explicit scaffold target directory. Project name is inferred from directory basename. `--dir .` bootstraps in-place inside an existing repo.
- `--dev-command <parts...>` and `--dev-prompt-transport <mode>` allow non-default agent configuration at scaffold time.
- All documentation examples updated to use explicit `--dir` — implicit default-directory patterns removed from docs.

### Docs Accuracy

- Adapter docs narrowed to verified-default `claude --print` contract; overclaiming of equal Codex/Aider support removed.
- Quickstart cold-start E2E proof added: the documented flow is now tested end-to-end.
- Homebrew tap rename audit completed: all stale `homebrew-agentxchain` references fixed across planning docs, scripts, and tests.

### Evidence

- 1921 node --test tests / 432 suites, 0 failures.
- 681 Vitest tests / 36 files, 0 failures.
- Website production build passes.

## 2.11.0

Protocol conformance closure and workflow-kit proof surfaced honestly. This release closes the remaining shipped verifier gaps around `hook_audit` and `dispatch_manifest`, promotes remote verification into a first-class public docs contract, and turns `template validate` into an explicit operator proof for the governed scaffold.

### Conformance Closure

- `hook_audit` verifier coverage now spans the full shipped branch set, including invalid-output handling, multi-hook execution, blocked-failure paths, and tamper detection.
- `dispatch_manifest` now covers the full shipped error taxonomy instead of a partial subset.
- `hook_ok` response semantics are documented and held by code-backed docs guards, so hook success is not left as an implied convention.

### Remote Verification Surface

- New public docs page: `/docs/remote-verification`.
- The HTTP conformance path is now documented from protocol contract through runnable example server and docs/content guard coverage.
- Remote verification is treated as the same fixture-driven verifier model as local stdio, not as a second conformance system.

### Workflow-Kit Proof

- `agentxchain template validate` now proves the governed workflow kit, not just the template registry.
- `--json` exposes a `workflow_kit` block so automation can distinguish scaffold failures from template-surface failures.
- The four required workflow markers are now part of the explicit operator-facing contract: `Approved:`, `## Phases`, `| Req # |`, and `## Verdict:`.
- `README.md`, `cli/README.md`, and `/docs/quickstart` now document `template validate` as a front-door proof step.

### Evidence

- 1884 node --test tests / 423 suites, 0 failures.
- 679 Vitest tests / 36 files, 0 failures.
- Website production build passes.

## 2.10.0

First real-model evidence: AgentXchain now has a live governed proof that dispatches to a real LLM via the api_proxy adapter, validates all protocol artifacts, and demonstrates governed retry on schema non-conformance.

### Live Governed Proof

- New `examples/live-governed-proof/run-live-turn.mjs` — standalone script that scaffolds a governed project, dispatches a review-only turn to a real Anthropic API endpoint, and validates the full artifact trail.
- Gated behind `ANTHROPIC_API_KEY` or `OPENAI_API_KEY` env vars — exits 0 (skip) with no credentials, so CI stays deterministic.
- Uses governed retry (`rejectTurn` → re-dispatch) to handle real model schema violations, demonstrating protocol rejection/retry machinery on live model output.
- Two-phase artifact validation: dispatch/staging validated before acceptance (since `acceptTurn` cleans up those directories), state/history/ledger validated after.
- Contract test enforces boundary rules: imports only from `runner-interface.js` and `api-proxy-adapter.js`, no internal modules, no CLI shell-out.

### Homebrew Mirror Drift Guard

- `cli/homebrew/agentxchain.rb` and `cli/homebrew/README.md` now track the current release version, enforced by `homebrew-mirror-contract.test.js`.
- Fixed stale mirror that claimed v2.1.1 while the canonical tap served v2.9.0.

### Runner/Live-Proof Contract Corrections

- Fixed `writeDispatchBundle` signature drift in public runner docs and planning specs.
- Documented `acceptTurn()` cleanup behavior: dispatch and staging directories are removed after commit.
- Live-proof spec corrected to reflect two-phase validation (pre-accept dispatch/staging, post-accept state/history/ledger).

### Model Tier Retry Budget Warning

- New `adapters.mdx` section documenting that cheaper models may require governed retries for schema-conformant output, with concrete cost implications per model tier.
- Code-backed guard reads `COST_RATES` from `api-proxy-adapter.js` and enforces that all documented models exist in the pricing table.

### Evidence

- 659 Vitest tests (36 files) + 1640 node --test (372 suites), 0 failures.
- Live governed proof verified against real Anthropic API.
- Website production build passes.

## 2.9.0

Runner layer: declared interface, ergonomic improvements, second-runner proof, public docs, and authenticated dashboard gate approvals. The protocol's runner-independence claim is now backed by a real second runner that imports the library boundary with zero CLI shell-out.

### Runner Interface (v0.2)

- New declared runner contract module (`runner-interface.js`) re-exports protocol-normative operations for any governed execution consumer: CLI, CI, hosted, or programmatic.
- Interface includes lifecycle operations (init, assign, accept, reject, approve gates, escalate, reactivate), dispatch/staging support, hooks, notifications, concurrency locks, and config utilities.
- `getTurnStagingResultPath` exported so runners can stage turn results without importing internal modules directly. Added in v0.2 after boundary leak was identified.
- Interface version `0.2` — incremented per the versioning rule when surface-expanding operations are added.
- New docs page: `/docs/runner-interface` with code-backed guard, cross-linked from CLI, quickstart, and protocol docs.

### Assign Turn Ergonomics

- `assignGovernedTurn()` success now returns the assigned `turn` at top level (`{ ok, state, turn }`), eliminating the need for consumers to recover the turn from `state.active_turns`.
- Failed assignments do not fabricate a `turn: null` — absence means failure.
- Real consumer updated: `coordinator-dispatch.js` uses `assignResult.turn` directly.

### CI Runner Proof

- New `examples/ci-runner-proof/run-one-turn.mjs` — standalone second runner that imports only `runner-interface.js` and executes one governed turn (init → assign → stage → accept) with artifact validation.
- Proof validates post-acceptance artifacts: `state.json` (SHA256 + structure), `history.jsonl` (entry count + fields), `decision-ledger.jsonl` (entry count).
- Dedicated GitHub Actions workflow (`ci-runner-proof.yml`) runs the proof on every push to main and on PRs.
- 13-test contract guard enforces: no `child_process` import, no CLI binary references, no `turn-paths.js` direct import, runner-interface.js import present, script exit 0 with valid JSON.

### Dashboard Gate Approvals

- Dashboard is no longer read-only. Operators can now approve pending phase transitions and run completions directly from the dashboard UI.
- `POST /api/actions/approve-gate` with per-process token auth via `X-AgentXchain-Token` (timing-safe comparison).
- `GET /api/session` delivers the local auth token.
- WebSocket remains strictly read-only — mutations are HTTP-only.
- Blocked-state recovery stays CLI-only. Gate approval and recovery are categorically different authority models.

### Evidence

- 659 Vitest tests (36 files) + 1621 node --test (366 suites), 0 failures.
- CI runner proof passes with runner interface v0.2.
- Website production build passes.

## 2.8.0

Governance reporting and protocol surface hardening. Operators can now generate human-readable governance reports from export artifacts, and the protocol reference boundary is formally documented with normative/non-normative separation.

### Governance Report Command

- New `agentxchain report` command produces governance summaries from verified export artifacts.
- Three output formats: `text` (terminal), `json` (automation), `markdown` (PRs, releases, audit records).
- Reports verify the export artifact first and fail closed — invalid artifacts never produce success summaries.
- Governed run reports summarize project identity, run status/phase, blocked state, turn counts, budget utilization, and evidence counts.
- Coordinator workspace reports summarize workspace identity, repo/workstream/barrier counts, repo status histogram, and per-repo export health.
- Report contract version `0.1` with stable `subject.kind` discrimination (`governed_run` / `coordinator_workspace`).
- New docs page: `/docs/governance-report`.

### Protocol Reference Boundary

- Formalized the normative/non-normative boundary for protocol v6.
- `PROTOCOL-v6.md` is the canonical normative reference. CLI command names, dashboard UX, provider adapters, and notifications are explicitly non-normative.
- New docs page: `/docs/protocol-reference` with code-backed guard tests reading source constants.

### Conformance Naming Canonicalization

- Fixed the sole naming mismatch in conformance fixtures: `turn_result` renamed to `turn_result_validation` across all 53 fixtures, 9 surfaces, 3 tiers.
- 71-test guard enforces fixture-to-source naming alignment.

### Export Schema Reference

- New docs page: `/docs/export-schema` documenting the export artifact schema (v0.2), both export kinds, file-entry integrity fields, and nested coordinator contract.
- `verify export --format json` report shape now documented: success/failure fields and command-error shape.
- Code-backed guard builds real exports and verifies docs mention actual output keys.

### Evidence

- 654 Vitest tests (36 files) + 1586 node --test (354 suites), 0 failures.
- Website production build passes.

## 2.7.0

Governed lifecycle integrations. Operators can now receive real-time notifications on governed lifecycle events, raise first-class escalations, and reference a complete operator recovery map — closing the workflow-kit and beginning the integration layer.

### Governed Notification Contract

- New top-level governed config surface: `notifications.webhooks`. Notifications are orchestrator-emitted lifecycle events, not hook side effects.
- Webhook transport delivers JSON payloads on governed transitions: `run_blocked`, `operator_escalation_raised`, `escalation_resolved`, `phase_transition_pending`, `run_completion_pending`, `run_completed`.
- Delivery is best-effort and never blocks governed execution.
- All delivery attempts are recorded in `.agentxchain/notification-audit.jsonl` — included in `agentxchain export` and verified by `agentxchain verify export`.
- New docs page: `/docs/notifications`.

### Operator Escalation Surface

- New `agentxchain escalate` command for operator-raised escalations with structured metadata.
- Escalation persists `blocked_on = escalation:operator:*` with `typed_reason = operator_escalation`, distinct from retry-exhaustion blocks.
- `resume` now truthfully recovers blocked governed runs: retained blocked turns are re-dispatched, run-level blocks are reactivated.
- Escalation raise and resolution are recorded in `.agentxchain/decision-ledger.jsonl` as `operator_escalated` and `escalation_resolved` decisions.

### Recovery Surface Closure

- Formal recovery analysis confirmed all 9 `typed_reason` values have explicit recovery paths through existing commands (`step`, `resume`, `approve-transition`, `approve-completion`, `escalate`).
- A dedicated `agentxchain recover` command was explicitly rejected: no unrecoverable states exist, and a catch-all command would duplicate logic that drifts.
- New docs page: `/docs/recovery` with the complete operator recovery map, backed by code-guard tests reading `blocked-state.js` and `governed-state.js`.

### Evidence

- 654 Vitest tests (36 files) + 1480 node --test (340 suites), 0 failures.
- Website production build passes.

## 2.6.0

Auditable export artifacts. Governed runs and coordinator workspaces can now be exported as self-verifiable JSON artifacts with embedded content, integrity hashes, and an independent verification command.

### Governed Run Export

- New `agentxchain export` command produces a deterministic JSON snapshot of all governed audit artifacts: config, state, history, decision ledger, hook audit/annotations, dispatch artifacts, staging artifacts, acceptance transaction journals, and intake artifacts.
- Each file entry includes `content_base64`, `bytes`, and `sha256` so the artifact is independently re-derivable without access to the original repo.
- Export schema version `0.2`. Output to stdout by default or to a file via `--output <path>`.
- Legacy (non-governed) projects and unsupported formats fail closed.

### Coordinator Workspace Export

- `agentxchain export` from an `agentxchain-multi.json` root produces `export_kind: "agentxchain_coordinator_export"` with recursively embedded child repo governed exports.
- Detection order: governed project first, coordinator workspace second.
- Child repo export failures do not fail the coordinator export — each child entry has `ok: boolean` with error details when false.
- Pre-init coordinator workspaces (no `.agentxchain/multirepo/`) export successfully with null summary fields.
- Coordinator-level files: config, state, barriers, history, decision ledger, barrier ledger.

### Export Verification

- New `agentxchain verify export <file>` command validates export artifact integrity.
- Verifies JSON structure, schema version, file entry completeness, `content_base64` → `sha256` re-derivation, and `bytes` consistency.
- Coordinator verification recurses into child repo exports.
- Exit codes: `0` pass, `1` integrity/structure fail, `2` input/command error.

### Evidence

- 652 Vitest tests (36 files) + 1437 node --test (327 suites), 0 failures.
- Website production build passes.

## 2.5.0

Remote MCP transport. Governed agents can now run over network via streamable HTTP, completing the MCP connector story for both local and remote deployment.

### Remote MCP Transport (streamable HTTP)

- New `streamable_http` transport for the `mcp` runtime type. Governed MCP agents can now run over HTTP in addition to local stdio.
- Transport selection via `transport` config field (defaults to `stdio`). Remote mode requires an absolute `http` or `https` `url`.
- Optional static `headers` map for remote requests (API keys, auth tokens, custom metadata).
- Config validation enforces mode-specific fields: stdio rejects `url`/`headers`, remote rejects `command`/`args`/`cwd`.
- `step` command prints the real transport target (stdio command vs HTTP URL) instead of hard-coding stdio.
- Documented `Accept: application/json, text/event-stream` requirement for streamable HTTP servers.

### Remote MCP Example

- New `examples/mcp-http-echo-agent/` reference server: stateless streamable HTTP MCP server implementing the same 13-argument `agentxchain_turn` tool contract as the stdio variant.
- Configurable port (`--port` flag or `PORT` env), `/mcp` endpoint, 404/405 for invalid paths/methods.
- Contract test proves: tool name parity, argument parity, `structuredContent` return, live MCP initialize response, docs coverage.
- Governed dispatch proof uses the real shipped HTTP example server as a subprocess, not an inline mock.

### Docs

- Adapter deep-dive updated with `streamable_http` config, transport comparison table (stdio vs HTTP examples), remote headers, and SSE non-support.
- Governed-todo-app README documents both stdio and remote MCP wiring paths with complete config examples.

### Evidence

- 652 Vitest tests (36 files) + 1394 node --test (317 suites), 0 failures.
- Website production build passes.

## 2.4.0

MCP runtime adapter, template validation layer, and library template. First governed connector beyond local_cli and api_proxy.

### MCP Runtime Adapter

- New `mcp` runtime type for governed turns over Model Context Protocol stdio transport.
- Single-tool dispatch: agent receives all 13 governed arguments via `agentxchain_turn` tool call, returns a turn result via `structuredContent` or JSON text.
- SDK wrapper unwrapping: nested `@modelcontextprotocol/sdk` `TextContent.text` envelopes are extracted automatically.
- Configurable tool name, command, args, environment, working directory, and timeout (default 20 minutes).
- Provider-agnostic: any MCP-compatible server can serve governed turns regardless of the underlying model.
- Reference implementation: `examples/mcp-echo-agent/` with validator-clean no-op payloads.
- Governed proof: MCP adapter → turn result validation → CLI `step` auto-accept demonstrated end-to-end in the `governed-todo-app` example.

### Template Validation

- New `agentxchain template validate [--json]` command for operator-facing template contract proof.
- Registry validation: every registered template ID must have a manifest, every manifest must be registered.
- Project binding validation: configured template must exist in the registry.
- Planning artifact completeness: validates that all `planning_artifacts[].filename` entries exist on disk.
- Acceptance hint completion: checks `.planning/acceptance-matrix.md` for `- [x]` completion status (warning-level, not blocking).
- `agentxchain validate` also surfaces template contract results.

### Library Template

- New `library` governed template for reusable package projects alongside `generic`, `api-service`, `cli-tool`, and `web-app`.
- Planning artifacts: `public-api.md`, `compatibility-policy.md`, `release-adoption.md`.
- Prompt guidance biases PM/dev/QA toward exported-surface stability, compatibility promises, and consumer install/import proof.

### Docs Hardening (continued)

- Adapter docs updated with MCP runtime contract, tool argument table, config fields, and example linkage.
- Plugin docs contract spec fixed for stale references.
- Template docs now code-backed against template manifests for all 5 template IDs.

### Evidence

- 648 Vitest tests (36 files) + 1364 node --test (310 suites), 0 failures.
- Website production build passes.
- Removed `.DS_Store` and `cli/node_modules/.package-lock.json` from git tracking (both covered by `.gitignore`).

## 2.3.0

Continuous delivery intake lifecycle and docs truthfulness release. Intake is the first continuous-governed-delivery primitive, and every deep-dive docs page is now held to code-backed behavioral verification.

### Continuous Delivery Intake

- Eight-command intake lifecycle shipped: `record`, `triage`, `approve`, `plan`, `start`, `scan`, `resolve`, `status`.
- Filesystem contract: `.agentxchain/intake/{events,intents,observations}/` with structured event sourcing.
- State machine: `detected → triaged → approved → planned → executing → completed/blocked/failed`, plus `suppressed` and `rejected` exits.
- `intake start` bootstraps a new governed run from idle state or resumes a paused run (no pending gates).
- `intake scan` ingests deterministic source snapshots with per-item deduplication and all-rejected aggregate failure.
- `intake resolve` maps execution outcomes (`completed`, `blocked`, `failed`) to governed run fields including `run_blocked_recovery` and `run_failed_at`.
- `.agentxchain/intake/` excluded from repo observation — orchestrator-owned operational state.
- CLI-subprocess E2E acceptance proof covers the full `record → triage → approve → plan → start → accept-turn → resolve` lifecycle.

### Vitest Steady State

- Vitest coexistence runner at steady state: 36 files, 630 tests across 3 expansion slices (pure-unit, docs-content/contract, coordinator).
- `vitest-slice-manifest.js` is the single source of truth for the Vitest include list.
- Repo-local `vitest-node-test-shim.js` resolves `node:test` → `vitest` hook incompatibility.
- Both runners exercise the same files: `test:vitest` (630 tests) + `test:node` (1285 tests).

### OpenAI API Proxy Support

- `api_proxy` adapter now supports `provider: "openai"` for synchronous `review_only` governed turns via OpenAI Chat Completions API.
- Provider-specific request building: developer/user message mapping, `response_format: { type: "json_object" }`, `max_completion_tokens`.
- Provider-specific error classification: `invalid_api_key`, `model_not_found`, rate limits, context overflow.
- Provider-specific usage telemetry: `prompt_tokens` / `completion_tokens` mapped to existing cost object.
- Config validation rejects OpenAI + `preflight_tokenization` (no OpenAI `provider_local` tokenizer in-repo).
- Scope: Chat-Completions-only JSON output. Responses API, tool use, background execution, and write-capable roles remain out of scope.

### Docs Truthfulness Hardening

- **CLI reference audits:** Fixed 15 ghost/missing flags across governance commands, added missing `intake` and `multi` command families to the command map, and shipped a meta-guard for command-map completeness.
- **Adapter deep-dive rewrite:** Fixed 12 defects including 3 fabricated sections (TypeScript adapter interface, fabricated multi-provider claims, per-HTTP-status retry schedules). All transport modes, error classes, retry policy, and provider support now verified against implementation. (Note: real OpenAI support was subsequently implemented and documented — see above.)
- **Protocol deep-dive rewrite:** Fixed default phase name (`qa` not `verification`), schema version split, queued-vs-pending gate lifecycle, objection enforcement scope, migration semantics.
- **Multi-repo deep-dive:** New `/docs/multi-repo` page with truthful workspace contract, artifact layout, barrier model, hook phases, and recovery model. Config filename corrected from fabricated `coordinator.yaml` to shipped `agentxchain-multi.json`.
- **Intake deep-dive rewrite:** Fixed paused-state behavioral lie, documented idle bootstrap, added resolve outcome fields (`run_blocked_recovery`, `run_failed_at`), documented all-rejected scan failure rule.
- **Templates deep-dive:** Upgraded from string-presence guard to code-backed contract test against template manifests.
- **Plugin docs:** Removed ghost `--from` flag, ghost `--force` prose claim, added flag tables for all 4 subcommands.
- 10 dedicated docs guard tests plus the command-map completeness meta-guard, all reading implementation source files for bidirectional verification.

### Documentation

- Retired `website/` flat HTML directory. `website-v2/` Docusaurus is the sole docs source.
- Protocol implementor guide with progressive conformance adoption.
- Surface claims in `capabilities.json` enforced by the protocol verifier when present.

### Evidence

- 639 Vitest tests (36 files) + 1295 node --test (299 suites), 0 failures.
- Website production build passes.
- Postflight install smoke test hardened for CI OIDC auth isolation.

## 2.2.0

Protocol conformance release. The governed protocol is now testable by any implementation, not just the reference CLI.

### Protocol Conformance Kit

- `agentxchain verify protocol` validates any implementation against the canonical protocol spec via a portable fixture corpus.
- 53 golden I/O fixtures across 3 tiers: Tier 1 (core constitutional — state machine, turn result validation, gate semantics, decision ledger, history, config schema), Tier 2 (trust hardening — dispatch manifest integrity, hook audit), Tier 3 (multi-repo coordination).
- Adapter bridge model (`stdio-fixture-v1`): implementations provide a single adapter command declared in `capabilities.json`. The validator feeds fixture JSON on stdin, receives result JSON on stdout. Implementation-agnostic by design.
- Conformance report with per-tier and per-surface pass/fail/error breakdown in JSON or text format.
- Exit semantics: `0` = pass, `1` = fixture failure, `2` = execution/config/adapter error.
- Reference adapter included: the CLI self-validates all 53 fixtures as part of CI.

### Conformance CI Enforcement

- CI now runs `agentxchain verify protocol --tier 3` on every PR. Protocol conformance cannot regress silently.

### Documentation

- `verify protocol` documented in CLI reference, quickstart, and README.
- Conformance fixture format, adapter contract, and capabilities schema documented in the conformance corpus README.

### Website

- Migrated docs from hand-written static HTML to Docusaurus with MDX, dark mode, and sidebar navigation.
- Deployed to GCS with two-tier cache strategy: hashed assets (1yr immutable), HTML (5min browser / 1min CDN edge).
- Landing page updated with long-horizon coding, lights-out software factories, and explicit .dev/.ai platform split framing.
- VISION.md updated to match website content.

## 2.1.1

Patch release to fix the npm publication path for the `2.1.x` line.

- Configure the GitHub Actions publish workflow with the npm registry URL required for trusted publishing.
- Make `publish-from-tag` tests hermetic under GitHub Actions so `setup-node` auth environment does not cause false failures during release preflight.

## 2.1.0

Trust-hardening and operator-visibility release on top of the v2 governed coordination base.

### Dispatch Manifest Integrity

- Finalized dispatch bundles now write `MANIFEST.json` with bundle identity plus per-file SHA-256 digest and byte size.
- Adapters verify finalized bundles before execution and fail closed on unexpected files, missing files, digest mismatch, or size mismatch.
- Coordinator dispatch protection now covers finalized directory integrity, not only rollback of modified existing files.

### HTTP Hooks And Plugin Hardening

- Hooks now support `"type": "http"` with JSON POST transport, timeout enforcement, env-backed header interpolation, and allow/warn/block verdict parity with process hooks.
- Plugin `config_schema` is now enforced during install/load rather than treated as passive metadata.
- Plugin upgrades are first-class and atomic: success replaces prior state, failure restores the prior installation and hook config.

### Dashboard Evidence Drill-Down

- Timeline cards now expand into turn detail panels with hook annotations and nearby hook-audit context.
- Decision ledger adds phase/date filtering and objection visibility.
- Hook audit log adds phase, verdict, and hook-name filters.
- Dashboard remains read-only; the release improves audit depth, not mutation authority.

## 2.0.0

This release subsumes all features from the unpublished `0.9.0`, `1.0.0`, and `1.1.0` development milestones.

### Multi-Repo Orchestration

- **Coordinator governance for multi-repo initiatives:** `agentxchain multi init` bootstraps a coordinator from `agentxchain-multi.json`. `multi step` dispatches to repo-scoped workstreams with automatic resync-before-assignment and gate request. `multi status` and `multi status --json` expose coordinator state. `multi approve-gate` unifies phase transition and completion approval. `multi resync` provides manual divergence recovery.
- **Cross-repo context injection:** dispatches include `COORDINATOR_CONTEXT.json` with upstream repo state, acceptance projections, and barrier evaluations so agents in one repo have visibility into progress across the initiative.
- **Context invalidation signals:** `after_acceptance` hook payloads include `context_invalidations` listing which downstream repos have stale cross-repo context after a new acceptance.
- **Coordinator hooks:** `before_assignment`, `after_acceptance`, `before_gate`, and `on_escalation` fire at real CLI lifecycle boundaries with blocking/advisory semantics. Hook scope enforcement covers both coordinator-owned and repo-local orchestrator files with pre-hook snapshot and post-hook tamper rollback.

### Dashboard Multi-Repo Integration

- **7-view local dashboard:** adds coordinator `initiative` and `cross-repo` views alongside the 5 repo-local panels. Gate and blocked views are dual-mode — they render coordinator state when authoritative. Dashboard bridge serves coordinator state under `/api/coordinator/*` with relative-path invalidation keys.

### Plugin System Phase 1

- **Plugin lifecycle:** `agentxchain plugin install <path|npm-package>`, `plugin list`, `plugin remove`. Manifest-driven (`agentxchain-plugin.json`) with phase-scoped hook-name collision protection, path rewriting for installed hooks, and metadata-driven removal that preserves unrelated hook bindings. Failed installs leave no filesystem drift.
- **Built-in plugins:** `@agentxchain/plugin-slack-notify` (advisory webhook notifications on acceptance, gate, and escalation) and `@agentxchain/plugin-json-report` (timestamped lifecycle artifacts under `.agentxchain/reports/`).

### Protocol v6

- **Constitutional document for multi-repo governance:** `PROTOCOL-v6.md` specifies coordinator state files, history events, gate semantics, cross-repo context generation, context invalidation signals, and coordinator hook payload contracts. Published at `/docs/protocol.html` and `/docs/protocol-v6.html`.

### Documentation

- Full static docs site: quickstart, adapters, CLI reference, plugins, protocol (v5 historical + v6 current).
- All 6 docs pages share consistent nav, sidebar, and footer.
- Drift guard tests enforce alignment between specs, published HTML, README links, and planning docs.

## 1.1.0

### New Opt-In Features

These features require explicit configuration. A v1.0.0 config file with no new fields runs identically under v1.1 — no silent behavior changes.

- **Parallel agent turns:** assign up to 4 concurrent governed turns per phase via `max_concurrent_turns` in phase config (default: `1`, preserving v1.0 sequential behavior). Includes turn-scoped dispatch isolation, acceptance serialization with lock/journal, file-level conflict detection at acceptance, and two operator-chosen conflict recovery paths (`reject-turn --reassign` and `accept-turn --resolution human_merge`).
- **Auto-retry with backoff (`api_proxy`):** enable via `retry_policy.enabled = true` on a runtime config block. Adapter-local only — does not create governed turns or mutate governed attempt counters. Bounded exponential backoff with jitter. `api-retry-trace.json` audit artifact on retry. Success-path cost aggregates usage across all attempts.
- **Preemptive tokenization (`api_proxy` + Anthropic):** enable via `preflight_tokenization.enabled = true` with a required `context_window_tokens` value. Local token budgeting and bounded compression before dispatch. Fails locally with `context_overflow` when over budget, avoiding a paid API call. Audit artifacts: `TOKEN_BUDGET.json` and `CONTEXT.effective.md`.

### Automatic Precision Improvements

These are active by default and improve error classification and state visibility without changing operator-required actions.

- **Anthropic provider-specific error mapping:** provider-native error type extraction runs before the HTTP-status fallback. New error classes: `invalid_request`, `provider_overloaded`. Daily/spend 429s classified as `rate_limited` but non-retryable. `provider_error_type` and `provider_error_code` preserved in `api-error.json`. Unknown structured provider errors fall back to HTTP classification while preserving provider fields.
- **Persistent blocked state:** `blocked` is a first-class `state.json` status alongside `idle`, `active`, `paused`, `completed`, `failed`. Required `blocked_reason` descriptor on entry. Enters `blocked` on accepted `needs_human`, retry exhaustion, or surfaced dispatch failure. `paused` survives only for explicit human approval gates (phase transitions, run completion). Legacy `paused + human:*` / `paused + escalation:*` states migrate in-place to `blocked` on read. Recovery via `step --resume`.

### Schema And State Changes

- `schema_version` bumped from `"1.0"` to `"1.1"`.
- v1.1 reads and migrates `"1.0"` state files in place (backward compatible). v1.0 does NOT read `"1.1"` state files.
- Migration: `current_turn` → `active_turns` map, legacy paused states → `blocked`, version stamp updated.
- v1.1 rejects unknown `schema_version` values with a clear error (forward compatibility guard).

### CLI Surface Changes

- `step --resume --turn <id>` for targeted resume when multiple turns are active.
- `accept-turn --turn <id>` and `reject-turn --turn <id>` for targeted acceptance/rejection.
- `reject-turn --turn <id> --reassign` for conflict-caused re-dispatch with structured conflict context.
- `accept-turn --turn <id> --resolution human_merge` for operator-merged conflict resolution.
- `status` and `status --json` render multiple active turns, conflict state, and blocked banners.
- Ambiguous commands (e.g. `step --resume` with multiple active turns and no `--turn`) fail with guidance.

### Dispatch And Staging

- All dispatch bundles now use turn-scoped paths: `.agentxchain/dispatch/turns/<turn_id>/` and `.agentxchain/staging/<turn_id>/turn-result.json`, even in sequential mode.
- `dispatch/index.json` is the operator-visible manifest for active dispatch bundles.

## 1.0.0

- Finalized the governed v4 protocol as the canonical CLI surface: orchestrator-owned `.agentxchain/state.json`, structured turn results, append-only `history.jsonl` and `decision-ledger.jsonl`, gate-driven phase progression, and explicit completion approval.
- Shipped the full governed turn lifecycle across the CLI: `init --governed`, `migrate`, `status`, `resume`, `step`, `accept-turn`, `reject-turn`, `approve-transition`, `approve-completion`, and `validate --mode turn`.
- Froze the dispatch contract around turn-scoped bundle paths with retry-aware redispatch, rejected-attempt preservation, and warning-bearing degraded context handling.
- Added the governed validation pipeline as a release contract: structural schema checks, assignment identity checks, observed artifact validation, verification normalization, and protocol-compliance enforcement.
- Completed the v1 adapter surface: `manual` polling, `local_cli` subprocess dispatch, and `api_proxy` synchronous review-only execution.
- Added typed `api_proxy` recovery classification for missing credentials, auth failure, rate limits, model resolution errors, context overflow, network/timeout failures, response parsing failures, and turn-result extraction failures, with `api-error.json` audit artifacts.
- Proved the governed lifecycle through automated end-to-end coverage for the happy path and reject/retry path, alongside CLI-level guards for malformed config rejection and concurrent turn prevention.
- Added strict release preflight mode for the post-bump cut gate, with script-level coverage for dirty-tree, version, and failure-propagation behavior.
- Expanded the planning/spec package to 13 governed v1 artifacts covering CLI, types, state machine, dispatch bundle, operator recovery, adapter contracts, e2e flows, API error recovery, and release gating.

## 0.9.0

- Introduced governed protocol mode with orchestrator-owned `state.json`, phase routing, and gate enforcement.
- Added the full governed turn lifecycle: assign, dispatch, validate, accept, reject, retry, and escalation.
- Added three governed adapter classes: `manual`, `local_cli`, and `api_proxy`.
- Added recovery descriptors across operator surfaces so blocked states expose `typed_reason`, `owner`, `recovery_action`, and `turn_retained`.
- Added phase transition approvals and run-completion approval flows with explicit human sign-off.
- Added the operator recovery contract and blocked-state coverage for validation failures, human pauses, dispatch failures, and retry exhaustion.
- Expanded automated CLI coverage for governed flows, including 115+ tests and focused recovery-surface tests.
