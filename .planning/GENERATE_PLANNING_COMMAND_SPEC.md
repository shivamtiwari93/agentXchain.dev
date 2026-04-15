# Generate Planning Command Spec

**Status:** shipped

## Purpose

Add a first-party CLI recovery path for re-materializing governed planning artifacts from the repo's current scaffold contract.

Today the repo can generate or regenerate:

- VS Code agent files via `agentxchain generate`
- template-specific planning artifacts indirectly during `template set`
- intake-planned artifacts indirectly during `intake plan`

What it does **not** expose cleanly is a direct operator command for restoring scaffold-owned `.planning/` files after deletion, partial cleanup, or repo drift. That is a workflow-kit gap because AgentXchain positions repo-native planning artifacts as a product surface, not incidental init output.

## Interface

### CLI

```bash
agentxchain generate planning [--dry-run] [--force] [--json]
```

### Backward compatibility

- `agentxchain generate` without a subcommand must remain the existing VS Code file generation path.
- The new governed surface is additive via the `planning` subcommand.

## Behavior

1. The command must require a governed repo (`schema_version: "1.0"` / v4).
2. It must load the repo's current template binding, treating a missing `template` field as implicit `generic`.
3. It must derive scaffold-owned planning artifacts from the current config and template:
   - baseline governed planning files:
     - `.planning/PM_SIGNOFF.md`
     - `.planning/ROADMAP.md`
     - `.planning/SYSTEM_SPEC.md`
     - `.planning/IMPLEMENTATION_NOTES.md`
     - `.planning/acceptance-matrix.md`
     - `.planning/ship-verdict.md`
     - `.planning/RELEASE_NOTES.md`
   - template manifest `planning_artifacts`
   - explicit custom `workflow_kit` artifact files that are not one of the baseline files
4. Default mode must create only missing files. Existing files are preserved byte-for-byte.
5. `--force` must overwrite scaffold-owned planning files with freshly generated scaffold content.
6. `--dry-run` must report what would be created or overwritten without mutating the repo.
7. `--json` must emit machine-readable classification of `created`, `overwritten`, and `skipped_existing`.
8. Custom workflow-kit artifact placeholder content must preserve the same section scaffolding rules used by governed init.

## Error Cases

- No `agentxchain.json` in the current repo root chain: fail closed.
- Non-governed / v3 repo: fail closed with a governed-only message.
- Unknown configured template: fail closed instead of guessing.
- Invalid governed config: fail closed through normalized-config loading.

## Acceptance Tests

- `AT-GEN-PLAN-001`: creates missing baseline governed planning artifacts in a governed repo.
- `AT-GEN-PLAN-002`: creates template-specific planning artifacts from the configured template.
- `AT-GEN-PLAN-003`: creates explicit custom workflow-kit artifact files with scaffold placeholder content.
- `AT-GEN-PLAN-004`: preserves existing files by default.
- `AT-GEN-PLAN-005`: `--force` overwrites existing scaffold-owned planning artifacts.
- `AT-GEN-PLAN-006`: `--dry-run` reports planned mutations without writing files.
- `AT-GEN-PLAN-007`: `--json` exposes classification fields for automation.
- `AT-GEN-PLAN-008`: non-governed repos are rejected.

## Open Questions

- The command intentionally restores scaffold-owned files only. It does not append prompt overrides or template guidance blocks to existing files. That remains `template set` scope.
