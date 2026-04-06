# E2E Quickstart Cold-Start Spec

## Purpose

Prove that the documented governed quickstart survives literal copy-paste execution from a cold temp directory.

The quickstart had already drifted badly enough to create broken nested-directory flows. A doc page is not truthful until a subprocess test proves the commands actually work together.

## Interface

### Test Surface

```text
cli/test/e2e-quickstart-cold-start.test.js
website-v2/docs/quickstart.mdx
```

## Behavior

### Scenario 1: Existing repo bootstrap in place

The test must prove:

1. create an empty temp directory
2. initialize git there
3. run `agentxchain init --governed --template web-app --dir . -y`
4. run `agentxchain template validate`
5. `git add -A`
6. commit
7. run `agentxchain status`

Assertions:

- no nested `my-agentxchain-project/` directory is created
- `agentxchain.json` exists at repo root
- `template validate` proves the project, not registry-only mode
- `status` reports governed phase state

### Scenario 2: New project quickstart with explicit target directory

The test must prove:

1. run `agentxchain init --governed --template web-app --dir my-agentxchain-project -y`
2. enter that directory
3. initialize git
4. run `agentxchain template validate`
5. `git add -A`
6. commit
7. run `agentxchain status`

Assertions:

- the scaffold exists in the named directory
- the validation output names the project
- the status output is governed and usable

## Acceptance Tests

1. Existing-repo bootstrap succeeds end-to-end with `--dir . -y`.
2. New-project bootstrap succeeds end-to-end with explicit `--dir my-agentxchain-project -y`.
3. Both scenarios run the real CLI binary as subprocesses.
4. If quickstart copy drifts back to hidden nested-directory assumptions, the test fails.
