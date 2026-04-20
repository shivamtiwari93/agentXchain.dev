# Gitignore Runtime State Spec

Status: Shipped

## Purpose

Define what `agentxchain init --governed` should ignore by default so fresh governed repos do not drown operators in framework-owned `git status` noise while preserving the framework's durable on-disk state.

## Interface

- `agentxchain init --governed`
- `scaffoldGoverned()` in [cli/src/commands/init.js](/Users/shivamtiwari.highlevel/VS Code/1008apps/agentXchain.ai/agentXchain.dev/cli/src/commands/init.js)
- Governed scaffold `.gitignore`
- Public operator docs in [website-v2/docs/project-structure.mdx](/Users/shivamtiwari.highlevel/VS Code/1008apps/agentXchain.ai/agentXchain.dev/website-v2/docs/project-structure.mdx)

## Behavior

- Fresh governed scaffolds must preconfigure `.gitignore` with:
  - secrets (`.env`)
  - transient execution artifacts (`.agentxchain/staging/`, `.agentxchain/dispatch/`, `.agentxchain/transactions/`)
  - framework-owned run-state paths that create raw `git status` noise when left untracked, including `state.json`, `SESSION_RECOVERY.md`, `TALK.md`, and related orchestrator-owned files
- The ignore block must be additive. If a repo already has a `.gitignore`, scaffolding must preserve existing entries and append only missing required lines.
- Docs must say the ignored runtime files are still durable on disk and used by status, recovery, dashboard, export, and continuity flows. "Gitignored by default" is not the same thing as "ephemeral" or "deleted".
- Docs must also state the tracked-file limitation honestly: existing tracked copies still appear dirty until the repo explicitly untracks them.

## Error Cases

- Existing `.gitignore` missing some required lines: append the missing lines without deleting operator-owned lines.
- Operators assume ignored runtime files are transient: docs must distinguish durable framework state from short-lived dispatch/staging artifacts.
- Operators expect `.gitignore` to hide already tracked files: docs must state that tracked files remain visible until explicitly untracked.

## Acceptance Tests

- A fresh governed scaffold writes a `.gitignore` that includes transient execution paths plus framework-owned runtime-state paths such as `.agentxchain/state.json`, `.agentxchain/SESSION_RECOVERY.md`, `TALK.md`, and `HUMAN_TASKS.md`.
- Scaffolding into a directory with an existing `.gitignore` preserves existing entries and appends the missing governed ignore lines.
- `project-structure.mdx` describes runtime state as "gitignored by default" rather than "commit this", while still documenting the files as durable framework state.

## Open Questions

- Whether future protocol iterations should move framework-owned runtime state outside repo-tracked paths entirely instead of relying on `.gitignore` for fresh scaffolds.
