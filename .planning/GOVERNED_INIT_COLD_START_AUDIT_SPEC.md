# Governed Init Cold-Start Audit Spec

## Purpose

Make `agentxchain init --governed` describe the scaffold it actually generated for a first-time operator.

The current `generic` scaffold is manual-only by design, but the init output still leaks the optional `local-dev` override path into the primary summary and next-step guidance. That is adoption drift: a cold-start operator sees a `claude --print ...` dev runtime, a `template-defined` phase label, and a `connector check` step even though the generated config uses default routing and only manual runtimes.

## Interface

- CLI command: `agentxchain init --governed`
- Implementation: `cli/src/commands/init.js`
- Regression tests:
  - `cli/test/governed-cli.test.js`

## Behavior

1. The scaffold summary must describe the generated config, not an unused fallback runtime.
   - For the default `generic` template, `Dev runtime:` reflects `manual-dev` and the manual runtime type.
   - When `--dev-command` opts a generic scaffold back into `local-dev`, the summary reflects that explicit local CLI runtime.
2. The phase summary only says `template-defined` when the selected template actually defines a custom routing topology.
   - Templates that inherit the default `planning -> implementation -> qa` routing must use the default-routing label.
3. The next-step checklist only includes `agentxchain connector check` when the generated scaffold contains at least one non-manual runtime worth probing.
4. Manual-only scaffolds should explicitly tell operators to use `agentxchain step` for the first governed turn rather than implying connector probing or unattended run-mode automation is part of the default path.

## Error Cases

- Do not print the `local-dev` command for a scaffold whose `roles.dev.runtime` is `manual-dev`.
- Do not mark the generic default routing as `template-defined` just because the template manifest contains a role/runtime blueprint.
- Do not suggest `connector check` for an all-manual scaffold with zero live connectors.

## Acceptance Tests

- `AT-GICA-001`: `init --governed -y` on the default `generic` template prints `Dev runtime: manual-dev (manual)`.
- `AT-GICA-002`: the same output labels the phase order as default-routing, not `template-defined`.
- `AT-GICA-003`: the same output omits `agentxchain connector check`.
- `AT-GICA-004`: `init --governed --dev-command ./scripts/dev-agent.sh --dev-prompt-transport dispatch_bundle_only -y` still prints the effective local CLI dev runtime command and transport.

## Open Questions

- None. This is output-truth hardening, not a workflow redesign.
