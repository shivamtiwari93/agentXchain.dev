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

## Open Questions

- Should the later webhook server live in the CLI process (`agentxchain watch --listen`) or as a separate hosted/CI runner?
- Should event-to-role routing be configured under `watch.routes` or reuse existing intake triage templates?
- Should PR comments be emitted by AgentXchain directly or left to GitHub Actions wrappers consuming JSON output?
- Should GitHub be the only first-class provider for the second slice, or should generic CloudEvents be normalized first?
