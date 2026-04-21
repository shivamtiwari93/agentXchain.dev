# Full Local CLI Human-Gated Pattern Spec

## Purpose

Ship a first-class governed scaffold for the beta tester's natural target setup:

- all role turns are automated through `local_cli`
- all automated roles are `authoritative`
- humans approve phase/completion gates instead of acting as manual runtime operators

This pattern must be scaffoldable directly instead of forcing operators to reverse-engineer it from mixed-mode docs, config surgery, and test fixtures.

## Interface

### New governed template

```bash
agentxchain init --governed --template full-local-cli --dir <path> -y
```

- Template id: `full-local-cli`
- Blueprint-backed and init-only
- Keeps the default 4-role team (`pm`, `dev`, `qa`, `eng_director`)
- Binds every role to a `local_cli` runtime with `authoritative` write authority
- Keeps human approvals on the planning and completion gates

### Docs surface

- New page: `website-v2/docs/automation-patterns.mdx`
- Pattern name: `all automated turns, human gate approvals only`
- Must include:
  - the `full-local-cli` template init command
  - exact Claude Code and Codex command shapes
  - the operator lifecycle: scaffold -> validate -> first turn -> approve gate -> continue -> completion
  - an inject-then-resume walkthrough for PM steering

## Behavior

1. `full-local-cli` scaffold writes `template: "full-local-cli"` into `agentxchain.json`.
2. The scaffolded role/runtime topology is:
   - `pm -> local-pm`
   - `dev -> local-dev`
   - `qa -> local-qa`
   - `eng_director -> local-director`
3. All four roles use `write_authority: "authoritative"`.
4. All four runtimes are `local_cli`.
5. The scaffold defaults to the shipped unattended Claude Code command:
   - `["claude", "--print", "--dangerously-skip-permissions", "--bare"]`
   - `prompt_transport: "stdin"`
   - `--bare` is mandatory per `DEC-BUG54-NEW-SCAFFOLDS-CLAUDE-BARE-001`; without it a non-interactive subprocess hangs on a macOS keychain read (BUG-54).
6. If init receives `--dev-command` / `--dev-prompt-transport`, that override applies to every scaffold-local runtime that still uses the shipped default local CLI contract. Do not silently customize only one role in an all-local template.
7. Planning and completion gates still require human approval:
   - planning exit gate: `requires_human_approval: true`
   - QA/completion gate: `requires_human_approval: true`
8. The template is init-only. `template set full-local-cli` must fail closed with init guidance, same as other blueprint-backed templates.

## Error Cases

- Unknown template id -> fail closed and list `full-local-cli` alongside the other built-ins.
- `template set full-local-cli` on an existing repo -> fail closed with init-only guidance.
- Docs must not claim this is zero-touch lights-out operation. Humans still approve gates.
- Docs must not claim `--dev-command` only affects `dev` when the template is explicitly all-local.

## Acceptance Tests

- `AT-FULL-LOCAL-001`: `init --governed --template full-local-cli -y` writes the template id and scaffolds all four roles as `authoritative + local_cli`.
- `AT-FULL-LOCAL-002`: `--dev-command ... --dev-prompt-transport ...` on the `full-local-cli` template updates every default local runtime, not just `local-dev`.
- `AT-FULL-LOCAL-003`: public docs and READMEs mention `full-local-cli` anywhere built-in templates are enumerated.
- `AT-FULL-LOCAL-004`: `/docs/automation-patterns/` documents the pattern name, exact Claude/Codex commands, and the inject/resume walkthrough.
- `AT-FULL-LOCAL-005`: subprocess E2E proves three automated turns on the `full-local-cli` template with human gate pauses at planning and completion.

## Open Questions

- Whether future automation-pattern templates should remain under the main template registry or move behind a dedicated `--automation-pattern` surface. For this slice, use the existing template registry because the product already has the blueprint/init-only boundary needed to ship safely.
