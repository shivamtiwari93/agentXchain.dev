# Review Context Sufficiency Spec

> Give review-only QA turns visibility into gate-file contents so they can judge ship readiness without pretending to read files they were never given.

Depends on: [API_PROXY_REVIEW_TRUTH_SPEC.md](./API_PROXY_REVIEW_TRUTH_SPEC.md), [WORKFLOW_GATE_FILE_SEMANTICS_SPEC.md](./WORKFLOW_GATE_FILE_SEMANTICS_SPEC.md)

---

## Purpose

Close the gap between what QA is told ("only request run completion if gate files already contain real content") and what QA can actually see (only boolean existence flags).

Today the `CONTEXT.md` "Gate Required Files" section shows:

```
- `.planning/PM_SIGNOFF.md` — exists
- `.planning/ship-verdict.md` — MISSING
```

A `review_only` role (especially `api_proxy`) cannot judge ship readiness from existence alone. It needs to see:

1. Whether `PM_SIGNOFF.md` says `Approved: YES` or `Approved: NO`
2. Whether `ship-verdict.md` says `## Verdict: YES` or `## Verdict: PENDING`
3. Whether `acceptance-matrix.md` has checked items or is still a blank template

Without this, the prompt instruction "only request run completion if gate files already contain real content" is an untestable claim.

## Interface

No new command. The affected surface is `CONTEXT.md` in the dispatch bundle, rendered by `renderContext()` in `dispatch-bundle.js`.

The change is gated on `role.write_authority === 'review_only'`. Non-review roles continue to see only the existence flag.

## Behavior

### 1. Gate file content previews for review_only roles

When rendering the "Gate Required Files" section for a `review_only` role, each existing file gets a bounded content preview (max 60 lines, consistent with the "small enough to show modest files in full" cap from `DEC-RFPC-002`).

Format:

```markdown
## Gate Required Files

### `.planning/PM_SIGNOFF.md` — exists

```
(file contents, up to 60 lines)
```

_Preview truncated after 60 lines._ (only if truncated)

### `.planning/ship-verdict.md` — MISSING

(no preview — file does not exist)
```

### 2. Semantic status annotation

For files with known gate-semantic markers (per WORKFLOW_GATE_FILE_SEMANTICS_SPEC.md), add a machine-readable status line:

- `PM_SIGNOFF.md`: scan for `Approved: YES` → annotate `**Gate semantic: Approved: YES**` or `**Gate semantic: approval not found**`
- `ship-verdict.md`: scan for `## Verdict: YES|SHIP|SHIP IT` → annotate `**Gate semantic: Verdict: YES**` or `**Gate semantic: verdict not affirmative**`

This gives the QA model unambiguous signal without requiring it to parse the file itself.

### 3. Non-review roles unchanged

For `write_authority !== 'review_only'`, the section renders exactly as before: existence flags only. Authoritative roles do not need gate-file previews — they can read the files themselves.

### 4. Scope boundary

- Max 60 lines per gate file preview (configurable via constant)
- No new file parsing beyond the two semantic markers already defined in the gate evaluator
- No rendering of non-gate planning files (acceptance-matrix gets existence + preview but no semantic annotation in this slice)
- Does not change gate evaluation logic — only what is surfaced in the context bundle

## Error Cases

| Condition | Required behavior |
|---|---|
| Gate file exists but is empty | Preview shows empty block, no semantic annotation |
| Gate file exists but is unreadable (permissions) | Falls back to existence-only flag with warning |
| Gate file exceeds 60 lines | Truncated with indicator |
| No gate config for current phase | Section omitted entirely (existing behavior) |
| Non-review role | Existence flags only (existing behavior) |

## Acceptance Tests

- **AT-RCS-001**: `CONTEXT.md` for a `review_only` role includes gate-file content previews when files exist.
- **AT-RCS-002**: `CONTEXT.md` for a `review_only` role shows `MISSING` without preview when a gate file does not exist.
- **AT-RCS-003**: `CONTEXT.md` for a `review_only` role includes semantic annotation `Approved: YES` when `PM_SIGNOFF.md` contains that marker.
- **AT-RCS-004**: `CONTEXT.md` for a `review_only` role includes semantic annotation `approval not found` when `PM_SIGNOFF.md` exists without the marker.
- **AT-RCS-005**: `CONTEXT.md` for a `review_only` role includes semantic annotation for `ship-verdict.md` verdict status.
- **AT-RCS-006**: `CONTEXT.md` for a non-`review_only` role shows only existence flags (no previews, no semantic annotations).
- **AT-RCS-007**: Gate file content preview truncates at 60 lines with indicator.

## Open Questions

None. The scope is narrow and the behavior is deterministic.
