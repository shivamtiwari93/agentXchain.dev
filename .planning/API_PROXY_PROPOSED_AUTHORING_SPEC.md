# API Proxy Proposed Authoring Spec

**Status:** Shipped
**Decision:** DEC-PROXY-AUTHOR-001
**Author:** Claude Opus 4.6 — Turn 117

## Purpose

Extend `api_proxy` to support `proposed` write authority, enabling cloud AI agents
(Anthropic, OpenAI) to propose file changes that the orchestrator materializes.

Today `api_proxy` is frozen to `review_only` (Session #19). This means cloud AI
agents can only review — they cannot propose code, specs, or planning artifacts.
The governed multi-agent factory model requires at least some cloud agents to
author proposed changes that are reviewed by peers before acceptance.

## Scope

**In scope (this slice):**
- Allow `api_proxy` runtimes to bind to `proposed` write authority roles
- Define a structured `proposed_changes` field in the turn result for api_proxy proposed turns
- Orchestrator materializes proposed changes to `.agentxchain/proposed/<turn_id>/`
- Turn result validator accepts `patch` artifact type for api_proxy + proposed
- Dispatch bundle includes proposed-authoring instructions for proposed api_proxy turns
- Proposed changes are NOT applied to the working tree — they are staged for review

**Out of scope:**
- `authoritative` write authority for api_proxy (requires tool use, future v3)
- Automated merge/apply of proposed changes (operator decision)
- Multi-turn tool use (agentic loop) for api_proxy
- Streaming responses

## Interface

### Turn result `proposed_changes` field

```json
{
  "status": "completed",
  "role": "dev",
  "summary": "Implement the connection pool module",
  "proposed_next_role": "qa",
  "artifact": { "type": "patch" },
  "proposed_changes": [
    {
      "path": "src/lib/pool.js",
      "action": "create",
      "content": "// full file content..."
    },
    {
      "path": "src/lib/config.js",
      "action": "modify",
      "content": "// full new file content...",
      "original_snippet": "// optional: snippet of the original code this replaces"
    },
    {
      "path": "src/old-pool.js",
      "action": "delete"
    }
  ],
  "files_changed": ["src/lib/pool.js", "src/lib/config.js", "src/old-pool.js"],
  "decisions": [...],
  "verification": {...}
}
```

### Materialized output

The orchestrator writes proposed changes to:
```
.agentxchain/proposed/<turn_id>/
  PROPOSAL.md          — summary, decisions, files list
  src/lib/pool.js      — proposed file (mirrored path)
  src/lib/config.js    — proposed file (mirrored path)
```

Operator can then review, apply with `cp`, or reject.

## Behavior

1. **Config validation:** `normalized-config.js` accepts `api_proxy` + `proposed` (not just `review_only`).
2. **Dispatch bundle:** For `api_proxy` + `proposed` turns, PROMPT.md includes proposed-authoring instructions telling the model to return `proposed_changes[]` in its JSON response.
3. **Adapter dispatch:** `api-proxy-adapter.js` accepts both `review_only` and `proposed` roles. No change to the HTTP request/response path — the structured JSON is the same transport.
4. **Turn result extraction:** `api_proxy` extracts governed turn JSON through a required three-stage envelope pipeline: raw parse, then fenced JSON extraction, then bounded JSON substring detection. This may unwrap an enclosing markdown/code-fence envelope, but it must not perform field-level repair. `proposed_changes` remains a normal top-level field inside that extracted JSON object.
5. **Turn result validation:** `turn-result-validator.js` validates `proposed_changes` structure when present (each entry has `path`, `action`, optional `content`). `patch` artifact type is now allowed for api_proxy + proposed.
6. **Materialization:** `governed-state.js` gets a new `materializeDerivedProposalArtifact()` function that writes proposed files to `.agentxchain/proposed/<turn_id>/`.
7. **Review path:** Subsequent review_only turns see the proposal in their dispatch context and can approve/reject.

## Error Cases

- `proposed_changes` missing for a `proposed` api_proxy turn → validation error
- `proposed_changes[].path` outside repo root or in reserved paths → validation error
- `proposed_changes[].action` not in `['create', 'modify', 'delete']` → validation error
- `proposed_changes[].content` missing for `create`/`modify` actions → validation error
- Model returns `proposed_changes` for a `review_only` role → validation warning (ignored)

## Acceptance Tests

1. Config with `api_proxy` + `proposed` passes `normalizeConfig()` without error
2. Config with `api_proxy` + `authoritative` still fails (unchanged)
3. Dispatch bundle for `api_proxy` + `proposed` includes proposed-authoring instructions
4. Turn result with valid `proposed_changes` passes validation
5. Turn result with invalid `proposed_changes` (missing path, bad action) fails validation
6. `materializeDerivedProposalArtifact()` writes correct files to `.agentxchain/proposed/<turn_id>/`
7. `review_only` turn result with `proposed_changes` gets a warning, not an error
8. E2E: Full proposed-authoring dispatch with mock provider returns materialized proposal

## Open Questions

None — this is a narrow, additive slice.
