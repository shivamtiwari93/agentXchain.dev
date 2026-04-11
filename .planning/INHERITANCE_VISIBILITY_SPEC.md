# Spec: Inheritance Snapshot Visibility

## Purpose

Operators need to know, at a glance, which historical runs have usable `inheritance_snapshot` data (decisions + turn summaries available for child runs) vs. which would degrade to metadata-only inheritance. Currently this signal exists only by inspecting raw `--json` output and checking array lengths manually.

## Problem

- `agentxchain history` text table: no inheritance signal at all
- `agentxchain history --json`: full snapshot present but no convenience boolean
- Dashboard run-history table: no inheritance signal
- Lineage view: no snapshot-availability signal per ancestor

## Solution

Add a narrow read-only visibility signal — not a new feature, just surfacing what is already recorded.

### 1. `history --json` — add `inheritable` boolean

Each run-history entry in JSON output gets a computed `inheritable: boolean` field:
- `true` if `inheritance_snapshot` exists AND has at least one decision or one accepted turn
- `false` otherwise

This is computed at query time, not persisted. The underlying `inheritance_snapshot` remains the source of truth.

### 2. `history` text table — add `Ctx` column

New column after `Trigger`:
- `✓` if the run has a usable inheritance snapshot (inheritable)
- `—` otherwise

Column header: `Ctx` (3 chars wide).

### 3. Dashboard run-history table — add `Ctx` column

Same semantics as the CLI text table. Renders as a small indicator badge.

### 4. Lineage view — snapshot signal per entry

In `history --lineage <run_id>` text output, append `[ctx]` after the trigger label when the entry has a usable snapshot.

## Non-Scope

- Drill-down views for inherited content in the dashboard (operators use `status --json` or `export`)
- Modifying the recorded `inheritance_snapshot` schema
- Adding new flags or commands

## Acceptance Tests

- AT-IV-001: `history --json` entries include `inheritable: true` when snapshot has data
- AT-IV-002: `history --json` entries include `inheritable: false` when snapshot is empty/missing
- AT-IV-003: `history` text table includes `Ctx` column header
- AT-IV-004: `history --lineage` shows `[ctx]` marker for entries with snapshots

## Decision

`DEC-INHERIT-VISIBILITY-001`: Inheritance snapshot availability is surfaced as a read-only computed signal in history text, JSON, dashboard, and lineage views. No new persistence, no new flags, no new commands.
