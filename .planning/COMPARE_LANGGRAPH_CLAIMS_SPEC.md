# Spec: LangGraph Comparison Claim Boundary

## Purpose

Freeze the public comparison contract for how AgentXchain describes LangGraph. The repo can make a sharp governance-vs-orchestration case, but it must not lean on stale absolutes or old platform naming when the official LangGraph docs now expose stronger interrupt, persistence, and deployment surfaces.

## Interface

- Files:
  - `website-v2/docs/compare/vs-langgraph.mdx`
- Guard:
  - `cli/test/compare-langgraph-claims.test.js`

## Behavior

- LangGraph comparison surfaces may contrast AgentXchain's protocol-native governance against LangGraph's application-defined orchestration, but they must acknowledge current upstream capabilities where the docs explicitly provide them.
- Public copy must not describe LangGraph human oversight as merely `interrupt nodes, breakpoints` when the current docs describe checkpoint-backed interrupts, resume via `Command`, and state inspection/modification.
- Public copy must not say multi-repo is categorically `Not supported`. The product-level contrast is narrower and defensible: LangGraph has no built-in cross-repo coordinator surface.
- Public copy must not say checkpointers let you resume `from any node`. Current docs support durable execution, persisted checkpoints, resume, and time travel; they do not require that broad phrasing.
- Public copy should use current deployment wording where it names the managed surface directly: `LangSmith Deployment`, not a stale standalone `LangGraph Platform` bullet.
- Negative governance claims should stay scoped to missing delivery-governance behavior: no built-in delivery-governance layer, no decision ledger, no protocol-native ship gates. Do not imply LangGraph lacks interrupts, observability, or resumability.

## Error Cases

- A comparison surface says LangGraph governance is simply `None built-in`.
- A comparison surface says LangGraph human oversight is only `Interrupt nodes, breakpoints`.
- A comparison surface says LangGraph multi-repo is `Not supported`.
- A comparison surface says checkpointers let you resume `from any node`.
- A comparison surface uses a standalone `LangGraph Platform.` bullet after the official docs moved the managed deployment surface under LangSmith Deployment.

## Acceptance Tests

1. `AT-LANGGRAPH-CLAIMS-001`: `website-v2/docs/compare/vs-langgraph.mdx` must use scoped governance, HITL, recovery, and multi-repo wording while rejecting the stale absolutes.
2. `AT-LANGGRAPH-CLAIMS-002`: `website-v2/docs/compare/vs-langgraph.mdx` must describe LangGraph human authority with checkpoint-backed resume plus state inspection/modification.
3. `AT-LANGGRAPH-CLAIMS-003`: `node --test cli/test/compare-langgraph-claims.test.js` passes.
4. `AT-LANGGRAPH-CLAIMS-004`: `cd website-v2 && npm run build` succeeds after the comparison copy changes.

## Open Questions

- If LangGraph later ships first-class delivery-governance or cross-repo coordination, this comparison should narrow again from `no built-in ... surface` wording to the exact remaining boundary instead of holding onto old negatives.
