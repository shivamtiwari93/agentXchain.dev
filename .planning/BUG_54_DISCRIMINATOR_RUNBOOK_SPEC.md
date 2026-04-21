# BUG-54 Discriminator Runbook Spec

## Purpose

Provide a compact reading key for the BUG-54 repro JSON after Turn 118 added
`command_probe`. The existing tester runbook explains how to run the harness;
this file specifies the one-screen artifact that tells testers which fields to
quote and how agents should interpret the main combinations.

## Interface

- Artifact: `.planning/BUG_54_DISCRIMINATOR_RUNBOOK.md`
- Source JSON: output from `cli/scripts/reproduce-bug-54.mjs`
- Required quoted fields:
  - `command_probe.kind`, `command_probe.status`, `command_probe.stdout`,
    `command_probe.stderr`, `command_probe.timed_out`
  - `summary.spawn_attached`, `summary.stdout_attached`,
    `summary.watchdog_fires`, `summary.avg_first_stdout_ms`,
    `summary.classification`, `summary.success_rate_first_stdout`
  - first failing attempt's `stdout_bytes`, `stderr_bytes`,
    `first_stdout_ms`, `first_stderr_ms`, `watchdog_fired`, `exit_signal`

## Behavior

- Keep the runbook under 60 lines so it is a quote-back checklist, not a second
  reproduction manual.
- Explain that `claude_version` plus stdout identifies the installed Claude
  build/path and is a discriminator after BUG-56 disproved static auth-shape
  assumptions.
- Map the key combinations:
  - `exit_clean_with_stdout` with zero watchdog fires means healthy local CLI
    spawn/attach.
  - `watchdog_no_output` on attempt 1 means deterministic silent block below
    AgentXchain dispatch.
  - regression only after early successes means resource accumulation remains
    plausible.
  - stderr-only shapes move triage toward auth/stdin errors and require the
    full stderr text.

## Error Cases

- Missing `command_probe` means the tester ran an older package or stale source.
- Missing byte/timing fields means agents cannot distinguish no-output hangs
  from stderr-only failures.
- Treat auth env booleans as context only, never standalone proof.

## Acceptance Tests

- `cli/test/bug-54-discriminator-runbook-content.test.js` asserts the file:
  - exists and is under 60 lines
  - names every required quote-back field
  - describes the healthy, silent-watchdog, resource-regression, and stderr-only
    discriminator shapes
  - explicitly rejects auth-booleans-only conclusions

## Open Questions

- None. This is a tester-facing reading key, not a new BUG-54 fix.
