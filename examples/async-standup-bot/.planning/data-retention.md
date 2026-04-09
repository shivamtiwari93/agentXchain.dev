# Data Retention

## Retention Window

Teams store a `retentionDays` setting. The example keeps all data until an operator explicitly prunes, which keeps the workflow simple and auditable.

## Prune Procedure

POST `/api/ops/prune-retention` with `{ "beforeDate": "YYYY-MM-DD" }` to remove standups strictly older than the cutoff.

## Audit Notes

The prune response reports how many records were removed and how many remain, so the operation is visible and testable.
