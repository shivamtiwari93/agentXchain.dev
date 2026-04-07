# API Proxy Review Truth Spec

## Purpose

Close the live-product lie exposed by the governed todo rerun on 2026-04-07:

1. `api_proxy` review turns were accepted even when they claimed review artifacts that did not exist.
2. The shipped QA prompt and example docs told `api_proxy` QA to create `.planning/acceptance-matrix.md`, `.planning/ship-verdict.md`, and `.planning/RELEASE_NOTES.md` even though `api_proxy` explicitly cannot write repo files.

This slice makes the accepted review artifact real and makes the prompt/docs tell the truth about what `api_proxy` can and cannot do.

## Interface

### Code paths

- `cli/src/lib/governed-state.js`
- `cli/src/lib/repo-observer.js`
- `cli/src/lib/dispatch-bundle.js`
- `cli/src/lib/turn-paths.js`
- `cli/src/commands/init.js`

### Docs surfaces

- `website-v2/docs/adapters.mdx`
- `website-v2/docs/quickstart.mdx`
- `README.md`
- `examples/governed-todo-app/README.md`
- `examples/governed-todo-app/.agentxchain/prompts/qa.md`

## Behavior

### 1. Derived review artifact for non-writing review runtimes

When a turn is accepted with:

- `artifact.type === "review"`
- runtime type `api_proxy`

the orchestrator must materialize a derived markdown review artifact at:

- `.agentxchain/reviews/<turn_id>-<role>-review.md`

unless the turn already references an existing review artifact under `.agentxchain/reviews/`.

The derived file must summarize:

- turn id / role / status
- summary
- decisions
- objections
- verification summary
- proposed next role
- human-escalation reason when present

The accepted turn result should point `artifact.ref` at this review path. The review path does **not** need to appear in Git-based `files_changed` observation because `.agentxchain/reviews/` is typically ignored; the truth requirement is that the artifact actually exists and the accepted turn points at it.

### 2. Fail closed on phantom review-only file claims

`compareDeclaredVsObserved()` currently ignores `phantom` declared files for `review_only` turns. That is wrong.

For `review_only` turns:

- observed product-file changes remain an error
- declared review/planning files that are not actually observed must also be an error

Reason: a review turn that claims it created `.planning/*` or `.agentxchain/reviews/*` files without any corresponding workspace change is not trustworthy and must not be accepted silently.

### 3. Prompt truth for `api_proxy`

Dispatch prompts for `review_only` turns on `api_proxy` must explicitly say:

- this runtime cannot directly write `.planning/*` or `.agentxchain/reviews/*`
- do not claim repo file creation you did not perform
- the orchestrator will materialize a review artifact under `.agentxchain/reviews/<turn_id>-<role>-review.md`
- run-completion requests are only valid when the required gate files already contain real content from a writable/manual path

Static QA prompt scaffolding and the governed todo example must carry the same truth.

### 4. Docs truth

Public docs and the governed todo example must stop implying:

- `agentxchain step --role qa` with default `api_proxy` QA can author `.planning/acceptance-matrix.md`
- `agentxchain approve-completion` is the immediate next step after an `api_proxy` QA turn

They must instead state:

- `api_proxy` QA produces a review artifact and structured verdict
- repo-local QA gate files must already exist or be updated via a writable/manual step before `approve-completion`

## Error Cases

- If the derived review path cannot be written, acceptance fails.
- If a turn points `artifact.ref` outside `.agentxchain/reviews/`, do not materialize there; fall back to the default derived review path.
- If the turn already created a real review artifact in the workspace, do not overwrite it.
- If a review-only turn still claims phantom `.planning/*` writes, acceptance fails with an artifact-observation error.

## Acceptance Tests

- AT-APIRT-001: accepting an `api_proxy` review turn materializes `.agentxchain/reviews/<turn_id>-<role>-review.md`
- AT-APIRT-002: accepted history stores the materialized review path in `artifact.ref`
- AT-APIRT-003: `review_only` phantom declared files now fail closed
- AT-APIRT-004: `api_proxy` dispatch prompt forbids claiming `.planning/*` writes and names the derived review path
- AT-APIRT-005: docs/example flow says `api_proxy` QA cannot directly author gate files and must not jump straight to `approve-completion`
