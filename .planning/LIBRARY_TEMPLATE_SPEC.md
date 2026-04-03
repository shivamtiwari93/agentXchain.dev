# Library Template Spec

> Narrow contract for adding a governed `library` template to the repo-native SDLC workflow kit.
>
> Depends on: [SDLC_TEMPLATE_SYSTEM_SPEC.md](./SDLC_TEMPLATE_SYSTEM_SPEC.md), [TEMPLATE_INIT_IMPL_SPEC.md](./TEMPLATE_INIT_IMPL_SPEC.md), [TEMPLATE_SET_SPEC.md](./TEMPLATE_SET_SPEC.md)

---

## Purpose

Ship a first-class governed scaffold for OSS libraries and shared packages. `api-service`, `cli-tool`, and `web-app` cover product shapes, but they do not capture the main risks for reusable packages:

- public API drift
- compatibility promises
- consumer migration cost
- install/import smoke proof

The `library` template exists so OSS-first repos can start with planning artifacts that fit package maintenance instead of forcing library work into the wrong project shape.

## Interface

The template is a new built-in governed template:

```bash
agentxchain init --governed --template library
agentxchain template set library
agentxchain template list
agentxchain intake triage --template library
```

Built-in manifest path:

```text
cli/src/templates/governed/library.json
```

Planning artifacts introduced by the template:

- `public-api.md`
- `compatibility-policy.md`
- `release-adoption.md`

## Behavior

### 1. Public API is the planning center

The template must force teams to define what consumers rely on:

- exported surface
- stable vs experimental APIs
- entrypoints
- breakage policy

### 2. Compatibility is explicit, not implied

The template must create a place to record:

- semantic versioning expectations
- deprecation policy
- supported runtimes or environments
- migration notes for breaking changes

### 3. Release proof is consumer-facing

The template must bias QA and ship decisions toward proof that a real consumer can adopt the package:

- install/import smoke
- package entrypoint verification
- changelog or upgrade guidance

### 4. Intake planning inherits the same artifact set

`intake plan` on an intent with `template = "library"` must generate the same three planning artifacts that `init --governed --template library` or `template set library` would materialize.

## Error Cases

- The template must not be documented as a generic “package” bucket if the artifacts are library-specific.
- The template must not claim framework-specific generators or release automation that the CLI does not actually provide.
- The template must not be added to docs or specs without being registered in `VALID_GOVERNED_TEMPLATE_IDS`.

## Acceptance Tests

- `AT-LIBRARY-TEMPLATE-001`: `init --governed --template library` writes `"template": "library"` and creates `public-api.md`, `compatibility-policy.md`, and `release-adoption.md`.
- `AT-LIBRARY-TEMPLATE-002`: `template set library` applies additive mutation semantics identical to other governed templates.
- `AT-LIBRARY-TEMPLATE-003`: `intake plan` with `template = "library"` generates the library planning artifacts.
- `AT-LIBRARY-TEMPLATE-004`: public docs and READMEs mention `library` anywhere they enumerate built-in governed templates.

## Open Questions

1. Should a later slice add machine-checkable package-consumer smoke gates, or is template guidance enough until operators demand enforcement?
