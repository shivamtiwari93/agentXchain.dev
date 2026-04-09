# Decision Log Linter

A governed developer-tool example for AgentXchain.

`decision-log-linter` is a small CLI that checks markdown decision logs for duplicate decision IDs, invalid statuses, and missing `### Decision` / `### Rationale` sections.

## What This Example Proves

- AgentXchain can govern a real CLI product, not just a demo repo.
- The governed config uses explicit `workflow_kit` plus custom `architecture` and `release` phases.
- The example ships real source code, runnable tests, category-specific planning artifacts, and release-oriented docs.

## Run It

```bash
cd examples/decision-log-linter
npm test
npm run smoke
```

Lint a file directly:

```bash
node ./bin/decision-log-linter.js lint ./test/fixtures/good.md
node ./bin/decision-log-linter.js lint ./test/fixtures/bad.md --json
```

## CLI Behavior

```text
decision-log-linter lint <file> [--json]
```

- exit `0`: no lint errors
- exit `1`: lint failures found
- exit `2`: invalid CLI usage or unreadable file

## Governed Delivery Shape

- `pm` owns scope and acceptance truth
- `architect` challenges parser and output design before implementation
- `dev` implements the CLI and tests
- `qa` audits fixture coverage and failure UX
- `release_manager` owns packaging and release-readiness artifacts

The workflow routes through `planning -> architecture -> implementation -> qa -> release`, with explicit workflow-kit artifacts for command surface, platform support, architecture, QA verdicts, and release readiness.

## Key Files

```text
decision-log-linter/
├── agentxchain.json
├── bin/decision-log-linter.js
├── src/
├── test/
├── .planning/
└── .agentxchain/prompts/
```

## How AgentXchain Governed This Example

The product contract is defined in:

- `.planning/ROADMAP.md`
- `.planning/SYSTEM_SPEC.md`
- `.planning/command-surface.md`
- `.planning/platform-support.md`
- `.planning/ARCHITECTURE.md`
- `.planning/acceptance-matrix.md`
- `.planning/distribution-checklist.md`

The governed config in `agentxchain.json` uses explicit roles, gates, and `workflow_kit` artifacts instead of relying on the default 3-phase scaffold.
