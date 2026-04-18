# Live Proof Evidence Disposition Spec

## Purpose

Make the live-proof evidence cutline durable.

The repo now has multiple live proof harnesses under `examples/live-governed-proof/`, but only a subset back active public product claims strongly enough to require checked-in evidence artifacts. That policy was argued out in `AGENT-TALK.md`, but a collaboration log is not a durable product contract. This spec freezes the disposition so future agents do not relitigate or silently expand the evidence set.

## Interface

### Evidence-backed harnesses

These harnesses require a checked-in `*.latest.json` artifact because public docs use them as active proof surfaces:

| Harness | Public claim surface | Checked-in artifact |
|---|---|---|
| `run-multi-repo-proof.mjs` | `website-v2/docs/multi-repo.mdx` | `examples/live-governed-proof/evidence/multi-repo-proof.latest.json` |
| `run-continuous-3run-proof.mjs` | `website-v2/docs/examples/live-continuous-3run-proof.mdx` | `examples/live-governed-proof/evidence/continuous-3run-proof.latest.json` |
| `run-checkpoint-handoff-proof.mjs` | `website-v2/docs/examples/checkpoint-handoff-proof.mdx` | `examples/live-governed-proof/evidence/checkpoint-handoff-proof.latest.json` |
| `run-continuous-mixed-proof.mjs` | `website-v2/docs/lights-out-operation.mdx` and `website-v2/docs/examples/live-governed-proof.mdx` | `examples/live-governed-proof/evidence/continuous-mixed-proof.latest.json` |

### Script-only harnesses

These harnesses remain valid repo-owned proof scripts, but they do not require checked-in `*.latest.json` artifacts in the current product shape:

| Harness | Current disposition |
|---|---|
| `run-live-turn.mjs` | Script-only reference entry |
| `run-multi-provider-proof.mjs` | Script-only reference entry |
| `run-proposed-authority-proof.mjs` | Script-only reference entry |
| `run-escalation-recovery-proof.mjs` | Script-only reference entry |
| `run-mcp-real-model-proof.mjs` | Script-only reference entry |
| `run-coordinator-event-aggregation-proof.mjs` | Script-only internal/supporting harness |
| `run-coordinator-event-surfaces-proof.mjs` | Script-only internal/supporting harness |
| `run-coordinator-event-websocket-proof.mjs` | Script-only internal/supporting harness |
| `run-coordinator-replay-roundtrip-proof.mjs` | Script-only release-note/supporting harness |

## Behavior

1. The checked-in evidence directory for `examples/live-governed-proof/` contains exactly four `*.latest.json` artifacts, matching the four evidence-backed harnesses above.
2. Each evidence-backed harness must have a durable public docs surface that references its checked-in artifact path.
3. Script-only harnesses may be referenced by docs as runnable scripts, release notes, or supporting examples, but they do not get checked-in `*.latest.json` artifacts by default.
4. Promoting a script-only harness to evidence-backed status requires all of:
   - a clear public product claim surface
   - a checked-in artifact path under `examples/live-governed-proof/evidence/`
   - a dedicated spec or spec update naming that artifact
   - a contract test update that extends the allowed evidence set
5. Removing an existing evidence artifact requires updating the related public docs and this spec in the same change. Silent artifact deletion is contract drift.

## Error Cases

- A fifth `*.latest.json` artifact appears in `examples/live-governed-proof/evidence/` without a matching public claim surface and contract update.
- A public docs page claims checked-in proof evidence for a harness that is still script-only.
- A public claim-backed harness loses its checked-in artifact or docs link.
- The disposition exists only in `AGENT-TALK.md` and not in a standalone spec/test surface.

## Acceptance Tests

- `AT-LPED-001`: this spec lists all 13 live proof harnesses and identifies exactly 4 evidence-backed entries.
- `AT-LPED-002`: `examples/live-governed-proof/evidence/` contains exactly the 4 approved `*.latest.json` artifacts and no extras.
- `AT-LPED-003`: each evidence-backed harness has at least one public docs surface that names its checked-in artifact path.
- `AT-LPED-004`: script-only harnesses do not have checked-in `*.latest.json` artifact peers in the evidence directory.

## Open Questions

None. The disposition is intentionally conservative until a new harness is promoted to an explicit public proof claim.
