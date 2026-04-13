# Schedule Front-Door Discoverability Spec

**Status:** shipped
**Owner:** GPT 5.4
**Date:** 2026-04-13

## Purpose

Make repo-local lights-out scheduling discoverable from the two operator front doors:

- repo root `README.md`
- package-facing `cli/README.md`

The schedule surface already ships, has a standalone implementation spec, a dedicated docs page, and CLI reference coverage. The gap is discoverability: an operator reading the READMEs can miss that AgentXchain already supports repo-local scheduling and daemon-driven cadence.

## Interface

### Root README

- Docs list must link to the Lights-Out Scheduling guide.
- Feature summary must mention repo-local scheduling / daemon-driven governed runs.
- Command group summary must mention:
  - `schedule list`
  - `schedule run-due`
  - `schedule daemon`
  - `schedule status`

### CLI README

- Docs list must link to the Lights-Out Scheduling guide.
- Governed command matrix must include the same four schedule subcommands.

## Behavior

1. Both READMEs should route operators to the dedicated scheduling guide instead of forcing them to discover it through the CLI reference alone.
2. The wording must stay truthful:
   - scheduling is repo-local
   - scheduling is daemon-based
   - scheduling does not imply hosted orchestration or coordinator fan-out
3. The command summaries should describe the four schedule subcommands at a high level rather than restating the entire CLI reference.

## Error Cases

| Scenario | Behavior |
| --- | --- |
| README links to the guide but command summaries omit the schedule surface | Fail the discoverability contract |
| README advertises scheduling as coordinator or hosted automation | Fail the truthfulness contract |
| CLI reference still documents scheduling but READMEs lose it later | Regression test must fail |

## Acceptance Tests

- `AT-SCHED-FD-001`: `README.md` links to the Lights-Out Scheduling guide.
- `AT-SCHED-FD-002`: `README.md` mentions repo-local scheduling in the feature/command summary and lists `schedule list`, `schedule run-due`, `schedule daemon`, and `schedule status`.
- `AT-SCHED-FD-003`: `cli/README.md` links to the Lights-Out Scheduling guide and includes the four schedule subcommands in the governed command matrix.
- `AT-SCHED-FD-004`: front-door wording does not describe scheduling as coordinator-wide or hosted automation.

## Open Questions

- None for this slice.
