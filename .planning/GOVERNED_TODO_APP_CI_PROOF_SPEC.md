# Governed Todo App CI Proof Spec

## Purpose

Make the unattended `governed-todo-app` product-example claim durable by running its real `run-auto.mjs` harness in GitHub Actions. The website and README already describe a CI-friendly JSON path; that claim should be backed by an actual workflow, not implied by manual execution alone.

## Interface

Workflow file:

- `.github/workflows/governed-todo-app-proof.yml`

Triggers:

- `push` on `main`
- `workflow_dispatch`
- nightly schedule (`0 7 * * *`)

Execution steps:

1. Check out the repo
2. Install CLI dependencies from `cli/package-lock.json`
3. Run `node examples/governed-todo-app/run-auto.mjs`
4. Run `node examples/governed-todo-app/run-auto.mjs --json`

Environment:

- `ANTHROPIC_API_KEY` injected from GitHub Actions secrets

## Behavior

- The workflow must run only on trusted contexts that can access secrets and tolerate API cost: direct `main` pushes and manual dispatches.
- Both text and JSON modes must execute so operator-facing and CI-parsable contracts stay live together.
- Public docs for `governed-todo-app` should name the workflow path and trigger model so readers know the unattended proof is automated, not anecdotal.
- The README should mirror the same workflow-backed proof statement.

## Error Cases

- Missing `ANTHROPIC_API_KEY` secret: the workflow run fails at dispatch time through the harness's existing retry/failure contract.
- Pull request events: the workflow does not run, preventing secret exposure and uncontrolled cost.
- Docs drift: contract tests should fail if the docs or README stop naming the workflow-backed CI proof path.

## Acceptance Tests

- `AT-TODO-CI-001`: `.github/workflows/governed-todo-app-proof.yml` exists.
- `AT-TODO-CI-002`: the workflow runs `examples/governed-todo-app/run-auto.mjs` in text and JSON modes.
- `AT-TODO-CI-003`: the workflow injects `secrets.ANTHROPIC_API_KEY`.
- `AT-TODO-CI-004`: the workflow is restricted to nightly schedule and `workflow_dispatch`.
- `AT-TODO-CI-005`: `website-v2/docs/examples/governed-todo-app.mdx` names the workflow-backed CI proof.
- `AT-TODO-CI-006`: `examples/governed-todo-app/README.md` names the workflow-backed CI proof.

## Open Questions

None. This is a proof-durability slice, not a protocol change.
