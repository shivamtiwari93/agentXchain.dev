# API Contract — Habit Board

## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/habits` | List all habits with streak data |
| POST | `/api/habits` | Create a habit `{ name, color? }` |
| DELETE | `/api/habits/:id` | Delete a habit |
| POST | `/api/habits/:id/check` | Mark today as complete |
| DELETE | `/api/habits/:id/check` | Unmark today |
| GET | `/api/habits/:id/history` | 30-day completion history |

## Data Model

### Habit (stored)

```json
{
  "id": "uuid",
  "name": "string (1-100 chars)",
  "color": "#hex (default #6366f1)",
  "createdAt": "ISO 8601",
  "completions": ["2026-04-01", "2026-04-02"]
}
```

### Habit (returned by GET /api/habits)

Same as stored, plus computed `streak`:

```json
{
  "streak": {
    "current": 5,
    "longest": 12
  }
}
```

### History entry (returned by GET /api/habits/:id/history)

```json
{ "date": "2026-04-09", "completed": true }
```

## Error Responses

All errors return JSON with an `error` field:

| Status | Condition |
|--------|-----------|
| 400 | Empty name, name > 100 chars, invalid JSON body |
| 404 | Unknown habit ID, unknown route |

```json
{ "error": "Name is required" }
```
