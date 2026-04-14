# Built-In JSON Report Proof Spec

## Purpose

Prove that the built-in `json-report` plugin works as an operator would actually use it:

- install by short name (`agentxchain plugin install json-report`)
- run a governed flow
- observe structured plugin-written JSON artifacts under `.agentxchain/reports/`

This closes the proof gap between generic plugin lifecycle coverage and a first-party built-in plugin story that repo readers can run directly.

## Interface

### Proof script

- File: `examples/governed-todo-app/run-json-report-proof.mjs`
- Invocation: `node examples/governed-todo-app/run-json-report-proof.mjs [--json]`
- Environment: `ANTHROPIC_API_KEY`

### Continuous proof

- File: `cli/test/e2e-builtin-json-report.test.js`
- Subprocess path:
  - `agentxchain plugin install json-report --json`
  - `agentxchain run --auto-approve --max-turns 5`

### Documentation

- Website page: `website-v2/docs/plugin-json-report.mdx`
- Package README copies:
  - `plugins/plugin-json-report/README.md`
  - `cli/builtin-plugins/plugin-json-report/README.md`

## Behavior

### Proof script behavior

The proof script must:

1. scaffold a temp governed project using the governed-todo-app transformed auto-run contract
2. install `json-report` by built-in short name before execution
3. run `agentxchain run --auto-approve`
4. verify the run completed with real API cost
5. force gate approvals via `requires_human_approval: true` so both `after_acceptance` and `before_gate` hooks execute during the live proof
6. verify plugin outputs exist in the default `.agentxchain/reports` directory:
   - `latest.json`
   - `latest-after_acceptance.json`
   - `latest-before_gate.json`
7. verify plugin payload truth:
   - `plugin_name` is `@agentxchain/plugin-json-report`
   - hook phases match the filenames
   - `run_id` matches the governed run
8. emit a machine-readable JSON payload in `--json` mode and a concise human summary otherwise

### Continuous subprocess proof behavior

The test must prove:

- built-in short-name install works in a real governed project
- a real `agentxchain run` executes with the plugin enabled
- plugin reports are written by hook execution, not by direct library calls
- both `after_acceptance` and `before_gate` surfaces produce artifacts

## Error Cases

- Missing `ANTHROPIC_API_KEY` must fail the live proof script with a clear error
- Plugin install failure must fail the proof before the run starts
- A completed run without plugin report artifacts is a proof failure
- A report with the wrong plugin name, missing run id, or wrong hook phase is a proof failure
- Continuous test must fail if short-name install regresses, if the run path skips hooks, or if report files stop being written

## Acceptance Tests

- `node --test cli/test/e2e-builtin-json-report.test.js`
- `node --test cli/test/builtin-plugin-docs-content.test.js`
- `node --test cli/test/plugin-builtin-discovery.test.js`
- `cd website-v2 && npm run build`
- `bash -lc 'set -a; source .env >/dev/null 2>&1; set +a; node examples/governed-todo-app/run-json-report-proof.mjs --json'`

## Open Questions

- Whether this proof should later get a dedicated GitHub Actions workflow with a model-backed secret, or remain a local live proof plus CI mock proof split.
