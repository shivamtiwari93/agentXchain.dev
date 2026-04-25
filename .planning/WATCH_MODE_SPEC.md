# Watch Mode Spec

## Purpose

`agentxchain watch` should evolve from a legacy lock-file helper into an event-driven governed intake surface for CI and repository automation.

The first shipped slice is intentionally narrow: ingest a single external event file, normalize it into the existing intake event shape, and either print the resulting intake payload or record it as a detected intent. This proves the event-to-governance boundary without requiring webhook hosting, GitHub credentials, or comment-writing permissions.

## Interface

Existing behavior remains:

- `agentxchain watch`
- `agentxchain watch --daemon`

New event-ingestion behavior:

- `agentxchain watch --event-file <path>`
- `agentxchain watch --event-file <path> --dry-run`
- `agentxchain watch --event-file <path> --json`
- `agentxchain watch --event-file <path> --dry-run --json`

`--event-file` accepts a JSON object in one of these forms:

1. A GitHub webhook payload with an event type inferred from common fields.
2. An explicit envelope:

```json
{
  "provider": "github",
  "event": "pull_request",
  "payload": {}
}
```

The first slice recognizes:

- GitHub `pull_request` events with `action` such as `opened`, `reopened`, `synchronize`, or `ready_for_review`
- GitHub `issues` events with `action: "labeled"`
- GitHub `workflow_run` events whose conclusion is not `success`, `skipped`, or `cancelled`
- GitHub scheduled events represented as `{ "provider": "github", "event": "schedule", "schedule": "..." }`

## Behavior

- `--event-file` does not start the legacy infinite lock watcher.
- `--dry-run` prints the normalized intake payload and writes nothing.
- Non-dry-run calls `recordEvent()` and creates a detected intake intent.
- Duplicate external events reuse the existing intake deduplication behavior.
- GitHub PR events map to `source: "git_ref_change"` and category `github_pull_request_<action>`.
- GitHub issue-label events map to `source: "manual"` and category `github_issue_labeled`.
- GitHub failed workflow events map to `source: "ci_failure"` and category `github_workflow_run_failed`.
- GitHub scheduled events map to `source: "schedule"` and category `github_schedule`.
- The normalized signal must preserve enough fields for later routing:
  - provider
  - event
  - action
  - repository
  - PR/issue number when present
  - URL when present
  - branch and SHA metadata when present
  - workflow name/conclusion when present
- Evidence must include at least one URL, file, or text entry accepted by the current intake validator.

## Error Cases

- Missing `agentxchain.json`: fail with the same repo-local intake workspace error used by intake commands.
- Missing file: exit non-zero with a clear message.
- Invalid JSON: exit non-zero with a clear message.
- Unsupported event shape: exit non-zero and explain the supported event classes.
- Dry-run must not create `.agentxchain/intake/events` or `.agentxchain/intake/intents`.
- `--daemon` and `--event-file` together are invalid because one is long-running and the other is a single-shot event ingest.

## Acceptance Tests

- AT-WATCH-EVENT-001: `watch --event-file github-pr-opened.json --dry-run --json` prints an intake payload with `source: "git_ref_change"`, `category: "github_pull_request_opened"`, PR metadata, and URL evidence, without creating intake files.
- AT-WATCH-EVENT-002: `watch --event-file github-pr-opened.json --json` creates one detected intent and one event under `.agentxchain/intake/`.
- AT-WATCH-EVENT-003: re-running the same event deduplicates to the existing event and intent.
- AT-WATCH-EVENT-004: failed GitHub workflow events map to `ci_failure`.
- AT-WATCH-EVENT-005: unsupported event JSON exits non-zero and names the supported event classes.
- AT-WATCH-EVENT-006: `--daemon --event-file` exits non-zero and does not start a daemon.

## Slice 2: Event Routing Configuration (`watch.routes`)

### Config Shape

The `watch` namespace in `agentxchain.json` defines event-to-triage routing:

```json
{
  "watch": {
    "routes": [
      {
        "match": {
          "category": "github_pull_request_opened",
          "source": "git_ref_change"
        },
        "triage": {
          "priority": "p1",
          "template": "generic",
          "charter": "Review PR #{{number}} — {{title}}",
          "acceptance_contract": ["PR reviewed under governance"]
        },
        "auto_approve": true,
        "preferred_role": "qa"
      }
    ]
  }
}
```

### Match Fields

- `category` — exact string or glob pattern (e.g., `github_pull_request_*`). Required.
- `source` — optional exact match against the normalized event source (`git_ref_change`, `ci_failure`, `schedule`, `manual`).
- First matching route wins. Order matters.

### Triage Fields

- `priority` — one of `p0`, `p1`, `p2`, `p3`. Defaults to `p2`.
- `template` — governed template ID. Defaults to `generic`.
- `charter` — string with optional `{{field}}` interpolation against the normalized signal. Fields like `number`, `title`, `workflow_name`, `conclusion`, `repository` are available depending on event type.
- `acceptance_contract` — array of acceptance criteria strings. Defaults to `['Watch event processed under governance']`.

### Auto-Approve and Role Hint

- `auto_approve` — boolean. If true, the intent is approved immediately after triage (approver: `watch_route`). Defaults to false.
- `preferred_role` — advisory role hint stored on the intent and consumed by dispatch-time role resolution after an explicit `--role` override and before phase `routing.<phase>.entry_role`.

### Behavior

- Routes are evaluated only for newly recorded events (not deduplicated).
- When a route matches: `recordEvent()` creates the detected intent, then `triageIntent()` is called with the route's triage fields, and optionally `approveIntent()` if `auto_approve` is true.
- When no route matches: intent stays in `detected` status, requiring manual triage.
- Dry-run mode (`--dry-run`) does not evaluate routes (no intent is created).
- When a routed intent is later planned and started, `intent.preferred_role` selects the dispatch role if no explicit `--role` override is supplied. The role must exist in `agentxchain.json`.

### Acceptance Tests (Slice 2)

- AT-WATCH-ROUTE-001: PR opened event auto-triages to QA review intent (approved, priority p1, charter interpolated, preferred_role qa).
- AT-WATCH-ROUTE-002: failed CI workflow auto-triages to dev fix intent (approved, priority p0, preferred_role dev).
- AT-WATCH-ROUTE-003: no matching route leaves intent as detected.
- AT-WATCH-ROUTE-004: glob category matching works for all PR actions.
- AT-WATCH-ROUTE-005: no watch config at all leaves intent as detected.
- AT-WATCH-ROUTE-006: source filter restricts route matching.
- AT-WATCH-ROUTE-007: first matching route wins when multiple routes exist.
- AT-WATCH-ROUTE-008: deduplicated events do not re-triage.
- AT-WATCH-ROUTE-009: PR opened route with `preferred_role: "qa"` plans and starts as a QA turn even when the planning phase entry role is PM.

## Slice 3: Repository CI Failure Intake

### Interface

The repo owns a GitHub Actions workflow:

- `.github/workflows/watch-intake.yml`
- Trigger: `workflow_run` completion for the repo's `CI` workflow.
- Execution condition: only failed/non-success conclusions are ingested. `success`, `skipped`, and `cancelled` are ignored.

The workflow runs:

```bash
node cli/bin/agentxchain.js watch --event-file "$GITHUB_EVENT_PATH" --json
```

and uploads the resulting intake JSON plus generated intake event/intent files as a workflow artifact.

### Behavior

- The CI watcher must be non-mutating with respect to git history. It may write ignored `.agentxchain/intake/` files inside the runner workspace for evidence upload, but it must not commit, push, or comment on PRs.
- The root `agentxchain.json` includes a `watch.routes` entry for `github_workflow_run_failed` events that auto-triages and auto-approves a p0 generic intent with `preferred_role: "dev"`.
- The workflow asserts that the event produced an approved routed intent before uploading artifacts.
- This workflow is intentionally scoped to repo-local proof. Webhook hosting, outbound PR comments, and GitHub issue writes remain later slices.

### Acceptance Tests (Slice 3)

- AT-WATCH-CI-001: `watch-intake.yml` triggers from completed `CI` workflow runs and filters to failed/non-success conclusions.
- AT-WATCH-CI-002: the workflow invokes the checked-out local CLI with `--event-file "$GITHUB_EVENT_PATH" --json`.
- AT-WATCH-CI-003: root `agentxchain.json` routes `github_workflow_run_failed` to an auto-approved p0 dev-preferred intent.
- AT-WATCH-CI-004: the workflow uploads the JSON intake result and generated intake evidence as artifacts without committing or pushing.

## Slice 4: Auto-Start Governed Runs from Watch Events

### Purpose

Slices 1-3 stop at "approved intent on disk." The operator must still manually run `intake plan` then `intake start` to begin a governed run. For event-driven automation — CI failure auto-repair, PR auto-review — the intent should progress from approved → planned → executing in a single `watch --event-file` invocation when the route opts in.

### Config Shape

`auto_start` is a boolean on a route definition, alongside the existing `auto_approve`:

```json
{
  "watch": {
    "routes": [
      {
        "match": { "category": "github_workflow_run_failed" },
        "triage": {
          "priority": "p0",
          "template": "generic",
          "charter": "Fix failed CI: {{workflow_name}} ({{conclusion}})",
          "acceptance_contract": ["CI workflow passes after fix"]
        },
        "auto_approve": true,
        "auto_start": true,
        "overwrite_planning_artifacts": false,
        "preferred_role": "dev"
      }
    ]
  }
}
```

### Preconditions

- `auto_start` requires `auto_approve: true`. If `auto_approve` is false or absent, `auto_start` is ignored and the result notes `auto_start_skipped: "requires auto_approve"`.
- `auto_start` requires an initialized governed workspace (`.agentxchain/state.json` must exist or be bootstrappable). If the workspace is not initialized, auto-start fails closed with `auto_start_error`.
- `overwrite_planning_artifacts` defaults to false. Existing planning artifacts are operator-owned by default and must not be overwritten unless the route explicitly sets this field to true.

### Behavior

When a route matches with `auto_start: true` and `auto_approve: true`:

1. **Record** → `recordEvent()` creates the detected intent (existing).
2. **Triage** → `triageIntent()` applies route triage fields (existing).
3. **Approve** → `approveIntent()` auto-approves (existing).
4. **Plan** → `planIntent()` scaffolds planning artifacts from the template. By default, existing planning artifacts block auto-start and leave the intent approved with `auto_start_error`. If the route sets `overwrite_planning_artifacts: true`, `planIntent()` may overwrite existing template planning artifacts.
5. **Start** → `startIntent()` initializes the governed run and assigns the first turn.

The result object gains three new fields under `routed`:
- `planned: true|false` — whether `planIntent()` succeeded
- `started: true|false` — whether `startIntent()` succeeded
- `auto_start_error: string|null` — error message if plan or start failed

### Failure Controls

Each failure is non-fatal to the watch command itself (exit 0 with error metadata in the result). The intent is left at whichever status it reached:

| Condition | Behavior | Intent left at |
|-----------|----------|----------------|
| `auto_approve: false` | `auto_start` silently skipped | `triaged` |
| Existing planning artifacts and no overwrite opt-in | `planIntent()` returns conflict, logged | `approved` |
| Existing planning artifacts with `overwrite_planning_artifacts: true` | template planning artifacts are overwritten | `planned` then `executing` if start succeeds |
| `planIntent()` fails (template error) | logged, `planned: false` | `approved` |
| Active turns exist | `startIntent()` returns error, logged | `planned` |
| Run is blocked | `startIntent()` returns error, logged | `planned` |
| Run is paused | `startIntent()` returns error, logged | `planned` |
| Pending phase transition | `startIntent()` returns error, logged | `planned` |
| Missing state.json (no workspace) | `startIntent()` returns error, logged | `planned` |
| `startIntent()` succeeds | full auto-start complete | `executing` |

### Acceptance Tests (Slice 4)

- AT-WATCH-START-001: route with `auto_start: true` + `auto_approve: true` plans and starts a governed run in a single `watch --event-file` invocation. Result includes `routed.planned: true, routed.started: true`. Intent status is `executing`.
- AT-WATCH-START-002: route with `auto_start: true` but `auto_approve: false` skips auto-start. Result includes `routed.auto_start_skipped`. Intent status is `triaged`.
- AT-WATCH-START-003: route with `auto_start: true` but invalid template fails triage validation — auto_start is never reached, intent stays `detected`. (Template validation is enforced at triage, not at plan.)
- AT-WATCH-START-004: route with `auto_start: true` but active turns exist reports `routed.started: false, routed.auto_start_error`. Intent status is `planned`.
- AT-WATCH-START-005: route with `auto_start: true` and `preferred_role: "qa"` dispatches QA turn, not the phase entry role.
- AT-WATCH-START-006: deduplicated events skip auto-start entirely (no plan, no start).
- AT-WATCH-START-007: `--dry-run` with `auto_start` route does not plan or start.
- AT-WATCH-START-008: route with `auto_start: true` but no `overwrite_planning_artifacts` preserves existing planning artifacts, reports `routed.planned: false`, leaves the intent approved, and does not start.
- AT-WATCH-START-009: route with `overwrite_planning_artifacts: true` may overwrite template planning artifacts, then start the governed run.

## Slice 5: Durable Watch Result Output

### Purpose

Slices 1-4 emit the watch pipeline result to stdout (JSON or text) and then exit. There is no durable on-disk audit trail of what happened. Operators and CI workflows that want to review past watch invocations must parse logs or re-derive state from `.agentxchain/intake/` files.

Watch result output closes this gap: every non-dry-run `watch --event-file` invocation writes exactly one structured result file to `.agentxchain/watch-results/`. The result contains the full pipeline trace — event, intent, route match, triage/approve/plan/start statuses, errors, and timestamps — in a single file that both operators and future automation (daemon, CI) can consume.

### Interface

No new CLI flags. `watch --event-file` automatically writes the result file after pipeline completion. The result ID is included in the JSON stdout output as `watch_result_id`.

Result files are written to: `.agentxchain/watch-results/<result_id>.json`

### Result Schema

```json
{
  "result_id": "wr_<timestamp>_<random>",
  "timestamp": "2026-04-25T20:00:00.000Z",
  "event_id": "evt_...",
  "intent_id": "intent_...",
  "intent_status": "approved",
  "deduplicated": false,
  "payload": {
    "source": "git_ref_change",
    "category": "github_pull_request_opened",
    "repo": "acme/widgets",
    "ref": "feature/review"
  },
  "route": {
    "matched": true,
    "triaged": true,
    "approved": true,
    "planned": false,
    "started": false,
    "auto_start": false,
    "preferred_role": "qa",
    "run_id": null,
    "role": null
  },
  "errors": []
}
```

When no route matches, `route` is `{ "matched": false }`.

### Behavior

- Every non-dry-run `watch --event-file` writes one result file. Each invocation produces its own file, including deduplicated events.
- `--dry-run` does NOT write a result file (consistent with dry-run writing no state).
- The `result_id` uses the format `wr_<unix_ms>_<8_hex_chars>` for uniqueness without coordination.
- The `watch_result_id` field is added to the CLI JSON output so callers can locate the result file by ID.
- The `errors` array captures `auto_start_error` and `auto_start_skipped` strings from the routing pipeline.
- The `payload` section is a summary (source, category, repo, ref) — not the full normalized signal. The full signal is in the intake event file.
- The directory `.agentxchain/watch-results/` is created on first write.

### Acceptance Tests (Slice 5)

- AT-WATCH-RESULT-001: routed auto-approved event writes one result file with `route.matched: true`, correct event/intent IDs, payload summary, and empty errors.
- AT-WATCH-RESULT-002: unrouted event (no routes) writes one result file with `route.matched: false`.
- AT-WATCH-RESULT-003: deduplicated event writes its own result file with `deduplicated: true`.
- AT-WATCH-RESULT-004: auto_start error (active turns) writes a result file with non-empty errors array.
- AT-WATCH-RESULT-005: `--dry-run` does not create the `watch-results` directory or any result file.
- AT-WATCH-RESULT-006: auto_start success writes a result file with `route.started: true`, `route.run_id` set, and `route.role` set.
- AT-WATCH-RESULT-007: multiple events produce unique result IDs.

## Slice 6: Event Directory Daemon

### Purpose

`watch --event-file` is useful for single CI invocations, but it does not support a local automation process that waits for event files dropped by another system. Before adding webhook hosting, AgentXchain needs a small daemon path that can consume JSON event files from a directory and feed each file through the same governed intake pipeline as `watch --event-file`.

### Interface

New CLI options:

- `agentxchain watch --event-dir <path>`
- `agentxchain watch --event-dir <path> --poll-seconds <seconds>`
- `agentxchain watch --daemon --event-dir <path>`

`--event-dir` runs a foreground polling loop. `--daemon --event-dir` starts that same loop in the background using the existing watch PID file.

### Behavior

- The daemon uses polling, not platform-specific filesystem notifications.
- The event directory is created if it does not already exist.
- On startup, the daemon processes all pending top-level `*.json` files in lexicographic order. This provides catch-up for files dropped while the daemon was stopped.
- On every poll, new top-level `*.json` files are processed sequentially.
- Each file is processed by the existing `watch --event-file <file> --json` pipeline so normalization, routing, auto-approval, auto-start, and durable watch result files remain identical to single-file ingestion.
- Successfully processed files move to `<event-dir>/processed/`.
- Failed files move to `<event-dir>/failed/`.
- Subdirectories, including `processed/` and `failed/`, are not scanned.
- The daemon does not delete event files.
- Graceful `SIGINT` / `SIGTERM` removes the watch PID file when the signal handler wins the race.

### Error Cases

- Invalid JSON or unsupported event shape moves the source file to `failed/`.
- A non-zero child `watch --event-file` exit moves the source file to `failed/`.
- A single failed file does not stop the daemon from processing later files.
- If a destination filename already exists under `processed/` or `failed/`, the daemon appends a unique suffix instead of overwriting the prior archived event.
- `--event-file` and `--daemon` remain invalid together. `--event-dir` is the daemon-compatible multi-file event ingestion interface.

### Acceptance Tests (Slice 6)

- AT-WATCH-DIR-001: `watch --event-dir <path>` processes startup backlog `*.json` files, writes durable watch results, and moves files to `processed/`.
- AT-WATCH-DIR-002: `watch --event-dir <path>` processes a file created after startup on the next poll.
- AT-WATCH-DIR-003: invalid or unsupported JSON files move to `failed/` without stopping the daemon.
- AT-WATCH-DIR-004: `watch --daemon --event-dir <path>` starts a background event-directory watcher and writes the existing watch PID file.
- AT-WATCH-DIR-005: files already under `processed/` and `failed/` are not reprocessed.

## Open Questions

- Should the later webhook server live in the CLI process (`agentxchain watch --listen`) or as a separate hosted/CI runner?
- ~~Should event-to-role routing be configured under `watch.routes` or reuse existing intake triage templates?~~ **Resolved: `watch.routes` in `agentxchain.json` (DEC-WATCH-ROUTES-CONFIG-001).**
- Should PR comments be emitted by AgentXchain directly or left to GitHub Actions wrappers consuming JSON output?
- Should GitHub be the only first-class provider for the second slice, or should generic CloudEvents be normalized first?
- ~~Should `preferred_role` be consumed by `resolveIntakeRole()` at dispatch time, or should role resolution remain phase-routing-driven?~~ **Resolved: `preferred_role` is consumed after explicit `--role` and before phase entry role (DEC-WATCH-PREFERRED-ROLE-DISPATCH-001).**
- ~~Should routed approved intents auto-start governed runs, or require explicit `intake plan` + `intake start`?~~ **Resolved: `auto_start: true` on a route plans and starts in a single invocation (DEC-WATCH-AUTO-START-001).**
- Should `preferred_role` persist across the full governed run, or only apply to the first dispatched turn? Currently it applies only to the first turn via `resolveIntakeRole()` at `startIntent()` time; subsequent turns fall back to phase routing. This is acceptable for the watch use case (routed role handles the initial event response) but should be documented.
- ~~Should directory-based watch automation use polling or filesystem notifications, and should it mutate event files?~~ **Resolved: `watch --event-dir` uses portable polling, processes startup backlog plus new top-level `*.json` files, and moves completed inputs into `processed/` or `failed/` without deleting them (DEC-WATCH-EVENT-DIR-001).**
