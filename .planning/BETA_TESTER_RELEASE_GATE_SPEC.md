# Beta Tester Release Gate Spec

Status: **shipped**

## Purpose

Prevent another false closure by making the beta-tester scenario suite a permanent release gate in normal CI and tag-publish verification.

## Interface

- `cli/package.json`
  - `npm run test:beta`
  - `npm run test:node`
  - `npm test`
- `cli/scripts/release-preflight.sh --publish-gate`
- `cli/test/beta-tester-scenarios/*.test.js`

## Behavior

- `npm run test:beta` runs every tester-sequence regression in `cli/test/beta-tester-scenarios/`.
- `npm run test:node` includes both top-level `cli/test/*.test.js` files and `cli/test/beta-tester-scenarios/*.test.js`.
- `npm test` remains the CI entrypoint and therefore runs the beta-tester suite on every normal CLI CI job.
- `release-preflight.sh --publish-gate` includes the beta-tester scenario files in its targeted release-blocking subset.
- If no beta-tester scenario files are found during `--publish-gate`, preflight fails closed instead of silently skipping the suite.

## Error Cases

- A new beta-tester scenario file exists but is not matched by the package scripts.
- Publish-gate preflight passes while the beta-tester suite was never executed.
- The repo tree changes again and contract tests still encode the old `fixtures`-only assumption for `cli/test/`.

## Acceptance Tests

- `cli/test/vitest-contract.test.js` proves `test:beta`, `test:node`, and the allowed `cli/test/` directories stay aligned with the shipped tree.
- `cli/test/release-preflight.test.js` proves `--publish-gate` includes `cli/test/beta-tester-scenarios/*.test.js`.
- `npm run test:beta` passes on the shipped suite.

## Open Questions

- The roadmap requires one beta-tester scenario file per BUG-1 through BUG-23. Today the release gate enforces the suite that exists, but it does not yet assert full 1-through-23 coverage by filename.
