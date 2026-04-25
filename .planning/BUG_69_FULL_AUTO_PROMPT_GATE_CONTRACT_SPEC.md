# BUG-69 — Full-Auto Prompt Gate Contract

## Purpose

Fix the dogfood failure where a full-auto continuous run reaches a human-gated phase boundary, but the agent prompt still frames that boundary as requiring human approval. In tusq.dev cycle 01 on `agentxchain@2.155.11`, the PM idle-expansion turn accepted the M28 intent, then set `status: "needs_human"` because `PROMPT.md` exposed the planning gate as human-required even though `approval_policy.phase_transitions.default` and `approval_policy.run_completion.action` were both `auto_approve`.

## Interface

- `cli/src/lib/dispatch-bundle.js` renders `PROMPT.md`.
- Inputs:
  - normalized `agentxchain.json`
  - current phase routing
  - current gate definition
  - `approval_policy`
- Outputs:
  - phase gate prompt text that distinguishes structural human-gate metadata from the effective full-auto approval policy.

## Behavior

- If a phase exit gate has `requires_human_approval: true` and the active approval policy auto-approves phase transitions, `PROMPT.md` must tell the role not to set `status: "needs_human"` solely to request approval.
- If a final-phase run-completion gate is auto-approved by policy, terminal guidance must say `run_completion_request: true` triggers orchestrator auto-approval for every write-authority class that can own the terminal phase (`authoritative`, `proposed`, and `review_only`).
- If no auto-approval policy applies, existing human-approval guidance remains.
- The orchestrator remains the authority. Agents still do not self-approve gates; they request transition/completion and let the orchestrator evaluate policy.

## Error Cases

- Credentialed gates are out of scope for this prompt-only patch; if future prompt rendering can evaluate credentialed-gate rule conditions precisely, it should prefer the approval-policy evaluator instead of a simplified default check.
- Missing or malformed `approval_policy` must keep the conservative human-approval wording.

## Acceptance Tests

- AT-BUG69-001: dispatch bundle for a PM planning turn with `requires_human_approval: true` and `approval_policy.phase_transitions.default: "auto_approve"` includes full-auto guidance and forbids `needs_human` solely for approval.
- AT-BUG69-002: the same prompt with `approval_policy.phase_transitions.default: "require_human"` keeps the human-approval requirement.
- AT-BUG69-003: final-phase review guidance with `approval_policy.run_completion.action: "auto_approve"` says run completion triggers orchestrator auto-approval.
- AT-BUG69-004: final-phase authoritative guidance with `approval_policy.run_completion.action: "auto_approve"` forbids `needs_human` solely for final run approval and instructs `status: "completed"` with `run_completion_request: true`.

## Open Questions

- Should the prompt renderer call the full approval-policy evaluator with a synthetic gate result so rule-level conditions and credentialed gates are represented exactly? Not needed for BUG-69 because the dogfood project uses the default full-auto policy, but this is the cleaner future hardening.
