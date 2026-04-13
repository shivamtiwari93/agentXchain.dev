# CI Runner Proof Case Study Spec

## Purpose

Publish a dated, evidence-backed case study for the shipped `ci-runner-proof` example so the website shows a real governed `agentxchain run` execution instead of only describing the proof surface abstractly.

This slice also fixes wording drift on the docs page: `run-via-cli-auto-approve.mjs` intentionally shells out to the real CLI, so the page must not claim that every proof in the pack stays inside the runner-interface boundary.

## Interface

- Public docs page: `website-v2/docs/examples/ci-runner-proof.mdx`
- Example README: `examples/ci-runner-proof/README.md`
- Content proof: `cli/test/ci-runner-proof-case-study-content.test.js`

## Behavior

1. Record one fresh execution of `node examples/ci-runner-proof/run-via-cli-auto-approve.mjs --json`.
2. Publish the captured outcome on the docs page as a dated case study with:
   - execution date
   - CLI version used
   - run id
   - role order
   - accepted turn count
   - cost summary
   - retry count
   - evidence that export/report artifacts were generated
3. Clarify the proof boundary:
   - primitive and `runLoop` proofs stay inside `runner-interface`
   - the CLI auto-approve proof intentionally shells out to `agentxchain run`
   - the CLI proof is not a second runner
4. Keep the example README aligned with the same boundary language so repo readers do not get two different stories.

## Error Cases

| Scenario | Expected behavior |
| --- | --- |
| Fresh proof run fails | Do not publish invented metrics; fix the proof or choose a different slice |
| Docs page implies every proof avoids the CLI | Fail content proof; the page must distinguish runner proofs from CLI proof |
| Case study looks timeless instead of dated | Fail content proof; readers must know the evidence was captured on a specific run and version |

## Acceptance Tests

- `AT-CIRCS-001`: the spec exists in `.planning/`
- `AT-CIRCS-002`: the docs page includes a `Fresh Governed CLI Run` evidence section
- `AT-CIRCS-003`: the docs page records the execution date, CLI version, run id, role order, accepted turn count, cost, and retry count
- `AT-CIRCS-004`: the docs page states that `run-via-cli-auto-approve.mjs` intentionally shells out to the real CLI
- `AT-CIRCS-005`: the example README distinguishes runner-interface proofs from the separate CLI proof

## Open Questions

- Whether a future product-example case study should prove an end-to-end `run` flow without relying on the proof-pack config shape
