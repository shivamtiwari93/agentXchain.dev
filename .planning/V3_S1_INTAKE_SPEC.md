# V3-S1 Spec — Repo-Native Intake And Governed Triage

> Standalone implementation spec for the first v3 slice. Covers artifact layout, CLI contracts, state machine, validation, and acceptance tests.

---

## Purpose

Give AgentXchain a continuous governed delivery entrypoint: structured intake of delivery signals, conversion to governed work intents, and governed triage of those intents — all repo-native, no cloud dependencies, no auto-execution bypass.

This spec covers three CLI commands (`intake record`, `intake triage`, `intake status`) and the library that backs them.

---

## Artifact Layout

All intake state lives under `.agentxchain/intake/` inside the project root (the directory containing `agentxchain.json`).

```
.agentxchain/intake/
  events/
    <event_id>.json          # one file per trigger event
  intents/
    <intent_id>.json         # one file per delivery intent
  loop-state.json            # aggregate intake summary (computed, not authoritative)
```

### Event File Schema

```json
{
  "schema_version": "1.0",
  "event_id": "evt_<timestamp_ms>_<random4hex>",
  "source": "manual | ci_failure | git_ref_change | schedule",
  "category": "<free-text delivery category>",
  "created_at": "<ISO 8601>",
  "repo": "<repo name from agentxchain.json project field>",
  "ref": "<git ref or null>",
  "signal": { "<source-specific key-value pairs>" },
  "evidence": [
    { "type": "url | file | text", "value": "<string>" }
  ],
  "dedup_key": "<source>:<deterministic hash of signal>"
}
```

**Validation rules:**
- `event_id` must match `/^evt_\d+_[0-9a-f]{4}$/`
- `source` must be one of the four supported values
- `signal` must be a non-empty object
- `evidence` must be a non-empty array with at least one entry
- `dedup_key` is computed by the library, not user-supplied

### Intent File Schema

```json
{
  "schema_version": "1.0",
  "intent_id": "intent_<timestamp_ms>_<random4hex>",
  "event_id": "<source event_id>",
  "status": "detected",
  "priority": null,
  "template": null,
  "charter": null,
  "acceptance_contract": [],
  "requires_human_start": true,
  "target_run": null,
  "created_at": "<ISO 8601>",
  "updated_at": "<ISO 8601>",
  "history": [
    { "from": null, "to": "detected", "at": "<ISO 8601>", "reason": "event ingested" }
  ]
}
```

### Loop State Schema

```json
{
  "schema_version": "1.0",
  "last_updated_at": "<ISO 8601>",
  "pending_events": 0,
  "pending_intents": 0,
  "active_intents": 0
}
```

Loop state is recomputed from events/ and intents/ on every `intake status` call. It is a cache, not a source of truth.

---

## State Machine — Delivery Intent

### V3-S1 States (this slice)

```
detected -> triaged
detected -> suppressed  (terminal)
triaged  -> rejected    (terminal)
```

### Transition Rules

| From | To | Requires |
|------|----|----------|
| `detected` | `triaged` | `priority` set (p0-p3), `template` set (valid template id), `charter` non-empty, `acceptance_contract` non-empty array |
| `detected` | `suppressed` | `reason` string in transition |
| `triaged` | `rejected` | `reason` string in transition |

### States Deferred Beyond S1

`approved`, `planned`, `executing`, `awaiting_release_approval`, `released`, `observing`, `closed`, `blocked`, `reopened` — defined in `V3_SCOPE.md` but not implemented in this slice. Transitions into these states require a later intake approval/planning command surface.

---

## CLI Commands

### `agentxchain intake record`

Records a new trigger event from a file or stdin.

```
agentxchain intake record --file <path>
agentxchain intake record --stdin
agentxchain intake record --source manual --signal '{"description":"..."}' --evidence '{"type":"text","value":"..."}'
```

**Options:**
- `--file <path>` — path to a JSON event file (without `event_id`, `dedup_key`, `created_at` — those are generated)
- `--stdin` — read event JSON from stdin
- `--source <source>` — inline event source (requires `--signal` and `--evidence`)
- `--signal <json>` — inline signal object (only with `--source`)
- `--evidence <json>` — inline evidence entry (only with `--source`, may be repeated)
- `--json` — output as JSON

**Behavior:**
1. Parse and validate the event payload
2. Compute `dedup_key` from `source` + deterministic hash of `signal`
3. Check existing events for duplicate `dedup_key` — if found, return the existing event (idempotent, exit 0)
4. Generate `event_id` and `created_at`
5. Write event file to `.agentxchain/intake/events/<event_id>.json`
6. Create a `detected` intent linked to the event
7. Write intent file to `.agentxchain/intake/intents/<intent_id>.json`

**Exit codes:**
- 0: event recorded (or already existed via dedup)
- 1: validation error
- 2: project not found

**Text output:**
```
  Recorded event evt_1712173200000_a1b2
  Created intent intent_1712173200000_c3d4 (detected)
```

**JSON output:**
```json
{ "ok": true, "event": { ... }, "intent": { ... }, "deduplicated": false }
```

### `agentxchain intake triage`

Transitions a `detected` intent to `triaged` by supplying triage metadata.

```
agentxchain intake triage --intent <id> --priority <p0-p3> --template <id> --charter <text> --acceptance <text>
```

**Options:**
- `--intent <id>` — required, the intent to triage
- `--priority <level>` — required, one of `p0`, `p1`, `p2`, `p3`
- `--template <id>` — required, must be a valid built-in template id
- `--charter <text>` — required, the delivery charter
- `--acceptance <text>` — required, comma-separated acceptance criteria (stored as array)
- `--suppress` — instead of triaging, suppress the intent (requires `--reason`)
- `--reject` — reject a triaged intent (requires `--reason`)
- `--reason <text>` — reason for suppress/reject
- `--json` — output as JSON

**Behavior:**
1. Load the intent file
2. Validate current status allows transition
3. Apply triage metadata or suppress/reject
4. Append transition to `history` array
5. Update `updated_at`
6. Write intent file

**Exit codes:**
- 0: transition succeeded
- 1: validation error or invalid transition
- 2: intent not found

### `agentxchain intake status`

Shows current intake state.

```
agentxchain intake status [--json] [--intent <id>]
```

**Options:**
- `--intent <id>` — show detail for a specific intent
- `--json` — output as JSON

**Behavior (list mode):**
1. Read all event and intent files
2. Compute aggregate counts by status
3. Display summary table

**Behavior (detail mode):**
1. Load the specific intent and its linked event
2. Display full detail including history

**Text output (list):**
```
  AgentXchain Intake Status
  ──────────────────────────────────────────────
  Events:  3
  Intents: 3  (detected: 1, triaged: 1, suppressed: 1)

  Recent Intents:
  intent_...  p1  cli-tool  detected   2026-04-03T20:15:00Z
  intent_...  p0  generic   triaged    2026-04-03T20:10:00Z
```

**Exit codes:**
- 0: success
- 2: project not found

---

## Deduplication

Dedup key = `${source}:${sha256(JSON.stringify(sortedSignal)).slice(0, 16)}`.

Signal keys are sorted deterministically before hashing so that `{ a: 1, b: 2 }` and `{ b: 2, a: 1 }` produce the same dedup key.

If a new event's dedup key matches an existing event, `intake record` returns the existing event and its intent without creating duplicates. This is the idempotent contract.

---

## Error Cases

1. **No project root**: exit 2 with "agentxchain.json not found"
2. **Invalid event payload**: exit 1 with field-level validation errors
3. **Unknown source type**: exit 1 listing valid sources
4. **Duplicate event**: exit 0, return existing (idempotent, not an error)
5. **Intent not found**: exit 2 with "intent <id> not found"
6. **Invalid state transition**: exit 1 with "cannot transition from <current> to <target>"
7. **Missing triage fields**: exit 1 listing which fields are missing
8. **Unknown template id**: exit 1 listing valid template ids
9. **Intake directory not initialized**: auto-create `.agentxchain/intake/{events,intents}/` on first `record`

---

## Acceptance Tests

- `AT-V3S1-001`: `intake record --source manual` creates event file and detected intent under `.agentxchain/intake/`
- `AT-V3S1-002`: duplicate event with same signal returns existing event, does not create second intent
- `AT-V3S1-003`: `intake triage` with valid fields transitions intent from `detected` to `triaged`
- `AT-V3S1-004`: `intake triage` on non-detected intent fails with invalid transition error
- `AT-V3S1-005`: `intake triage --suppress` transitions detected intent to `suppressed`
- `AT-V3S1-006`: `intake status` shows aggregate counts matching actual files
- `AT-V3S1-007`: `intake status --intent <id>` shows intent detail with history
- `AT-V3S1-008`: invalid source type rejected with deterministic error
- `AT-V3S1-009`: missing required triage fields rejected with field-level error
- `AT-V3S1-010`: `intake record` with `--json` returns structured JSON output
- `AT-V3S1-011`: intake directories auto-created on first record

---

## Open Questions

1. Should `intake record` accept `--category` as an optional override, or should category always be derived from source type?
2. Resolved by S2: approval and planning ship as dedicated `intake approve` and `intake plan` commands, not as `intake triage` flags.
