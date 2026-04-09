# Operations Runbook

## Daily Operations

1. Create teams and members before collecting updates.
2. Review the daily summary after standups begin.
3. Send reminder previews to members who still owe updates.

## Incident Checks

- Unknown team/member errors indicate setup drift.
- High blocker count in the daily summary indicates delivery risk.
- Missing summaries usually mean no standups were submitted for that date yet.

## Retention Tasks

Run the retention prune endpoint with a cutoff date to remove historical standups older than the configured window or an operator-selected archive point.
