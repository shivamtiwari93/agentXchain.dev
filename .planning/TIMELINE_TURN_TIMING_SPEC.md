# Timeline Turn Timing Spec

## Purpose

The dashboard Timeline view renders governed turn history but drops all timing fields (`started_at`, `accepted_at`, `duration_ms`) that have been available since v2.67.0. Active turns also carry `started_at` but the view does not compute or display elapsed time. A view called "Timeline" that shows no time information is a significant operator-facing gap.

## Interface

No new APIs, endpoints, or fetch keys. All timing fields already exist in the data the Timeline view receives:

- **History entries** (from `/api/history`): `started_at`, `accepted_at`, `duration_ms`
- **Active turns** (from `/api/state` → `active_turns`): `started_at`

## Behavior

### Active turns
- When `started_at` is present, render elapsed time as human-readable duration (e.g., "2m 15s")
- When `started_at` is missing (legacy), omit elapsed display

### History entries (completed turns)
- When `accepted_at` is present, render as human-readable timestamp
- When `duration_ms` is present, render as human-readable duration (e.g., "45s", "2m 15s", "1h 3m")
- When timing fields are missing (legacy), omit timing display — no crash, no placeholder

### Formatting
- Elapsed time uses the same human-readable format as `status.js`: hours/minutes/seconds
- Timestamp rendered as compact ISO-like or relative format
- Timing appears inline with turn headers, not as separate detail rows

## Error Cases

- Missing `started_at` on active turns: omit elapsed — no crash
- Missing `accepted_at` / `duration_ms` on history entries: omit timing — no crash
- Invalid ISO timestamps: treat as missing

## Acceptance Tests

1. Active turn with `started_at` renders elapsed time
2. History entry with `accepted_at` and `duration_ms` renders both
3. History entry without timing fields renders cleanly without timing
4. Duration formatting: 0ms → "0s", 45000ms → "45s", 135000ms → "2m 15s", 3723000ms → "1h 2m"
5. Active turn without `started_at` renders without elapsed

## Open Questions

None. This is a pure rendering addition using existing data.
