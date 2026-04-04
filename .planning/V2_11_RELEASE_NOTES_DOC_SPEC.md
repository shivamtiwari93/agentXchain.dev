# v2.11.0 Release Notes Docs Spec

> Contract for the public release-announcement page at `/docs/releases/v2-11-0`.

---

## Purpose

Publish a repo-native release announcement for `agentxchain@2.11.0` on the public docs surface so operators do not have to reconstruct the release delta from GitHub tags, npm metadata, or a private changelog file.

## Interface

### Route

```text
/docs/releases/v2-11-0
```

### Files

```text
website-v2/docs/releases/v2-11-0.mdx
website-v2/sidebars.ts
cli/CHANGELOG.md
```

## Behavior

The public release page must:

1. Identify `2.11.0` as the current release being announced.
2. Give operators an install/upgrade command that targets the exact npm artifact: `npm install -g agentxchain@2.11.0`.
3. Summarize the actual shipped delta since `2.10.0`, including:
   - `hook_audit` conformance completion
   - `dispatch_manifest` conformance completion
   - remote verification as a first-class public surface
   - workflow-kit proof formalization through `template validate`
4. Link readers to the deeper docs pages that explain the shipped behavior instead of duplicating all detail inline.
5. Stay aligned with `cli/CHANGELOG.md` for the same release version.
6. Appear in the Docusaurus sidebar under a dedicated release-notes section so the page is discoverable from the docs surface.

## Error Cases

| Condition | Required behavior |
|---|---|
| Release page exists but is not linked from the docs sidebar | Fail the docs contract; hidden release notes are not a real public surface. |
| Release page announces a version that does not match `cli/CHANGELOG.md` | Treat as release-surface drift. |
| Release page claims features not present in shipped docs/CLI surfaces | Remove or correct the claim before release. |
| Release page omits the exact upgrade command | Treat as operator-facing incompleteness. |

## Acceptance Tests

1. `website-v2/docs/releases/v2-11-0.mdx` exists.
2. `website-v2/sidebars.ts` includes a `Release Notes` category that links to `releases/v2-11-0`.
3. `cli/CHANGELOG.md` contains `## 2.11.0`.
4. The release page mentions `2.11.0`, `2.10.0`, `template validate`, `workflow_kit`, `hook_audit`, and `dispatch_manifest`.
5. The release page includes `npm install -g agentxchain@2.11.0`.
6. `.planning/DOCS_SURFACE_SPEC.md` includes `/docs/releases/v2-11-0`.

## Open Questions

1. Should release notes accumulate into a multi-version docs archive, or should the docs surface keep only the latest few announcement pages?
