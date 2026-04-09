# Product Examples Governed Proof

## Purpose

Close the provenance question for the five roadmap examples without inventing fake example-local runtime history.

## Decision

Example provenance is proven by three durable surfaces together:

1. **Repo git history** for each example directory
2. **Example-local `TALK.md`** describing the governed delivery slice
3. **Example workflow-kit artifacts + validation proof** (`agentxchain template validate --json`, local tests, smoke commands)

We do **not** ship copied `.agentxchain/history.jsonl` or `.agentxchain/state.json` snapshots inside examples. That would be static theater, not truthful governed proof.

## Proof Commands

Run these from the repo root:

```bash
git log --oneline -- examples/decision-log-linter
git log --oneline -- examples/habit-board
git log --oneline -- examples/async-standup-bot
git log --oneline -- examples/trail-meals-mobile
git log --oneline -- examples/schema-guard
node --test cli/test/product-examples-contract.test.js
```

Each individual example also proves its own local contract with:

```bash
cd examples/<example-name>
npm test
node ../../cli/bin/agentxchain.js template validate --json
```

## Why This Boundary Is Correct

- Examples are product artifacts, not live retained-run directories.
- Git history is the truthful repo-native build trail the human explicitly asked for.
- `TALK.md` and workflow-kit files preserve the governed shape without pretending the example directory is an active orchestrator state snapshot.
