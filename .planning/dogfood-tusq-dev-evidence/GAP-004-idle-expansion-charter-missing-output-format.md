# GAP-004 — PM Idle-Expansion Charter Does Not Specify Output Format

Date: 2026-04-24

## Trigger

After `agentxchain@2.155.6` closed BUG-64 and the first dogfood run completed,
the continuous loop restarted and dispatched a second PM idle-expansion turn.
The PM (Claude Opus 4.7) ran to completion but did NOT produce a structured
`idle_expansion_result` — neither as a top-level JSON key in turn-result.json
nor as a sibling `idle-expansion-result.json` sidecar file.

```bash
cd "/Users/shivamtiwari.highlevel/VS Code/1008apps/tusq.cloud/tusq.dev-agentxchain-dogfood"
npx --yes -p agentxchain@latest -c 'agentxchain run --continuous --vision .planning/VISION.md \
  --max-runs 5 --max-idle-cycles 3 --poll-seconds 5 --triage-approval auto \
  --auto-checkpoint --on-idle perpetual'
```

Error:
```text
acceptTurn(pm): Validation failed at stage schema: idle_expansion_result is required for vision_idle_expansion turns.
```

## Root Cause

The idle-expansion charter text (continuous-run.js:754-770) tells the PM
"Output MUST be a structured idle_expansion_result" but does NOT specify:
1. WHERE to put it (top-level `idle_expansion_result` key or sidecar file)
2. The exact JSON schema with field names
3. A concrete example

The PM understood the concept (mentioned `idle_expansion_result` 6 times in
decisions/summary) but never produced the actual structured JSON object.

The first PM idle-expansion turn (BUG-64 session) happened to produce a sidecar
because Claude Opus 4.7 inferred the format. The second turn did not — it merely
referenced the prior iteration's result in text.

Additionally, `pm-idle-expansion.md` is scaffolded by `agentxchain init --governed`
but is NEVER LOADED during dispatch. The prompt override mechanism points to
`pm.md`, not `pm-idle-expansion.md`. The detailed instructions in the scaffold
file are dead code.

## Fix

Added explicit OUTPUT FORMAT section to the idle-expansion charter text in
`continuous-run.js`. The charter now includes:
- Both accepted output locations (top-level JSON key or sidecar file)
- Complete JSON schema with field names for both `new_intake_intent` and
  `vision_exhausted` branches
- Explicit instruction: "Do NOT just describe the result in text"

## Related

- BUG-64: first instance of this class — PM produced sidecar but acceptor
  didn't read it (fixed in v2.155.4/5/6)
- GAP-004 is the second instance: PM didn't produce any structured result at all

## Secondary Issues Observed

During recovery from this gap, additional cascading issues were encountered:

1. **Framework-generated reports block acceptance of reissued turns:** When a
   turn acceptance fails, the framework generates a governance report. This
   report becomes an "undeclared file change" for the next turn, blocking its
   acceptance. Workaround: manually commit framework artifacts before
   reissuing.

2. **100% overlap conflict on reissued turns:** When a QA turn is reissued,
   the new turn produces similar content to the original. The acceptance
   validator detects 100% overlap and raises an acceptance conflict.
   Workaround: `agentxchain accept-turn --resolution human_merge`.

3. **Governance report generation fails with "Invalid string length":** After
   many turn attempts, the events/history files grow large enough that report
   generation fails with a string-length error. Non-blocking but reduces
   observability.
