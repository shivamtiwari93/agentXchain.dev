# BUG-68 PM Idle-Expansion Prompt Spec

## Purpose

Make `.agentxchain/prompts/pm-idle-expansion.md` an active idle-expansion control surface instead of a scaffolded file that runtime dispatch ignores.

## Interface

- `agentxchain init --governed` continues to scaffold `.agentxchain/prompts/pm-idle-expansion.md`.
- `run_loop.continuous.idle_expansion.pm_prompt_path` may override the prompt path.
- If no override is present, the runner reads `.agentxchain/prompts/pm-idle-expansion.md` when dispatching a perpetual idle-expansion intent.
- The prompt content is appended to the synthesized idle-expansion charter before intake triage.

## Behavior

- If the prompt file exists and is readable, its trimmed content is included in the PM idle-expansion intent charter.
- If the prompt file is missing, idle expansion still works from the built-in charter.
- If the prompt file cannot be read, idle expansion still works and includes a warning in the charter.
- The normal PM role prompt remains intact; the idle-expansion prompt is a mode-specific supplement because idle expansion is routed through the intake charter.

## Error Cases

- Missing prompt file must not block perpetual mode.
- Invalid or unreadable prompt path must not crash the continuous loop.
- The prompt file must not grant permission to modify `.planning/VISION.md`; the built-in charter's VISION immutability clause remains authoritative.

## Acceptance Tests

- `continuous-run.test.js` proves a customized `.agentxchain/prompts/pm-idle-expansion.md` appears in the idle-expansion intent charter.
- Existing BUG-60 perpetual idle-expansion tests continue to pass.

## Open Questions

- None for BUG-68. A future role-variant dispatch feature may choose to render this as a distinct prompt section, but the current intake-charter path is enough to activate the scaffold.
