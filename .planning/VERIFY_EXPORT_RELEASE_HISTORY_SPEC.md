# Verify Export Release History Truth Spec

## Purpose

Keep archived release notes truthful after `agentxchain verify export` grew stronger verification scope. Older pages may describe the shipped slice, but they must not teach that `verify export` is an authoring or metadata-preservation surface.

## Interface

- Archived release notes under `website-v2/docs/releases/`
- Docs guard test: `cli/test/verify-export-release-notes-content.test.js`

## Behavior

1. Historical release pages may describe the release-time implementation.
2. If a release page mentions `verify export`, it must preserve the current command boundary:
   - `agentxchain export` writes the artifact and its summary metadata.
   - `agentxchain verify export` re-derives proof from the embedded artifact content and fails closed on drift or tampering.
3. Historical notes must not say or imply that `verify export` itself preserves or writes authority metadata.
4. When a release shipped export-summary enrichment plus verifier enforcement together, the page should say both parts explicitly instead of collapsing them into one vague sentence.

## Error Cases

- An archived release page says `verify export` preserves metadata.
- A release note collapses export authoring and verifier enforcement into one ambiguous claim.
- A historical page omits the fail-closed verifier behavior after presenting new summary metadata.

## Acceptance Tests

- `AT-REL-VE-001`: `v2.103.0` states that export summaries preserve repo-decision authority metadata, `verify export` rejects drift/tampering in that metadata, and governance reports render the preserved values.

## Open Questions

- None.
