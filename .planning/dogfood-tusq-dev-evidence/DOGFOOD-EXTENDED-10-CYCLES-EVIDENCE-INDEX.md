# DOGFOOD-EXTENDED-10-CYCLES — Durable Evidence Index

> Closed 2026-04-25. 10 governed runs on shipped `agentxchain@2.155.22`.

## Target Repo

- **Worktree:** `/Users/shivamtiwari.highlevel/VS Code/1008apps/tusq.cloud/tusq.dev-agentxchain-dogfood`
- **Branch:** `agentxchain-dogfood-2026-04`
- **Base:** `origin/main`

## Product Code Proof

```bash
cd /Users/shivamtiwari.highlevel/VS\ Code/1008apps/tusq.cloud/tusq.dev-agentxchain-dogfood
git diff --stat origin/main..agentxchain-dogfood-2026-04 -- src/ tests/ bin/ tusq.manifest.json
```

```
 src/cli.js                              | 198 ++++++++++++-
 tests/eval-regression.mjs               | 203 ++++++++++++-
 tests/evals/governed-cli-scenarios.json | 114 +++++++-
 tests/smoke.mjs                         | 500 +++++++++++++++++++++++++++++++-
 4 files changed, 987 insertions(+), 28 deletions(-)
```

## Checkpoint Commits

- **Total:** 42 commits on `agentxchain-dogfood-2026-04` ahead of `origin/main`
- **First:** `4967859` — `chore: enable full-auto approval policy for dogfood`
- **Last:** `ca221a0` — `checkpoint: turn_5c928016067e555a (role=product_marketing, phase=launch)`

Full commit log:

```bash
git log --oneline origin/main..agentxchain-dogfood-2026-04
```

## Per-Cycle Run IDs And Evidence

| Cycle | Run ID | AgentXchain Version | Turns | Phases Traversed | Key Evidence |
|-------|--------|---------------------|-------|------------------|--------------|
| 01 | `run_e7c2e566` | v2.155.20 | 4 | planning → implementation → QA → launch | M28 sensitivity classification: +488 lines product code |
| 02 | `run_4e38dc02` | v2.155.20 | 4 | planning → implementation → QA → launch | M28 extended coverage: +499 cumulative lines |
| 03 | `run_44a179cc` | v2.155.22 | 7 | planning → implementation → QA → launch | BUG-75 stale-run recovery proof (`charter_materialization_required` with `source: stale_run_recovery`), M29 re-verification |
| 04 | `run_8fe3b8b4` | v2.155.22 | 4 | planning → implementation → QA → launch | PM re-affirmation, full dev/QA/launch cycle |
| 05 | `run_94746c35` | v2.155.22 | 4 | planning → implementation → QA → launch | Full 4-phase cycle, QA schema fix |
| 06 | `run_6d12fe85` | v2.155.22 | 4 | planning → implementation → QA → launch | Full 4-phase cycle |
| 07 | `run_6464f8d1` | v2.155.22 | 4 | planning → implementation → QA → launch | Full 4-phase cycle |
| 08 | `run_e816012b` | v2.155.22 | 4 | planning → implementation → QA → launch | Full 4-phase cycle |
| 09 | `run_efe89c41` | v2.155.22 | 4 | planning → implementation → QA → launch | Full 4-phase cycle |
| 10 | `run_b784b6ba` | v2.155.22 | 8 | planning → implementation → QA → launch | Full 4-phase cycle |

## Per-Cycle Summary Files

- `cycle-01-v2.155.11-12-summary.md` — Early cycle 01 attempts (BUG-69, BUG-70 discovery)
- `cycle-01-v2.155.20-summary.md` — Cycle 01 final: M28 delivered, 488 lines across 4 phases

Note: Cycles 02–10 ran under continuous autonomous mode (`--on-idle perpetual --max-runs 9`). Per-cycle summary files were not created for 02–10 because the continuous loop chained automatically. Evidence is in the checkpoint commit trail on the dogfood branch and the session/state/events JSON files under `raw/`.

## Raw Evidence Files

All under `.planning/dogfood-tusq-dev-evidence/raw/`:

- `cli-2026-04-25-cycle-01-v2.155.11.log` — CLI output for first cycle 01 attempt
- `state-2026-04-25-cycle-01-v2.155.11.json` — State snapshot after BUG-69
- `events-2026-04-25-cycle-01-v2.155.11.jsonl` — Full event stream
- `step-2026-04-25-cycle-01-v2.155.12.log` — Cycle 01 retry on v2.155.12
- Additional state, session, intent, and status snapshots per retry

## Gap Discovery Log

7 gaps discovered and fixed during dogfood:

| Gap | Bug | Version Fixed | Summary |
|-----|-----|---------------|---------|
| GAP-001 | BUG-63 | v2.155.2 | Idle-expansion before blocked-run eligibility check |
| GAP-002 | BUG-62 ext | v2.155.3 | Reconcile-safe-paths allowlist for non-state `.agentxchain` files |
| GAP-003 | BUG-64 | v2.155.6 | Idle-expansion result acceptance format (sidecar + normalization) |
| GAP-004 | — | v2.155.7 | Charter unnamed result location and JSON shape |
| GAP-005 | — | v2.155.8 | Charter validator schema mismatch (object vs array traceability) |
| GAP-006 | — | v2.155.9 | (not individually filed) |
| GAP-007 | — | v2.155.10 | Embedded idle-expansion normalization bypass |

## Session Summary

- `session-2026-04-24.md` — Comprehensive session log covering initial dogfood setup through 3 completed governed runs on v2.155.10

## Closure Decision

**DOGFOOD-EXTENDED-10-CYCLES: SUCCESS.** AgentXchain product-direction validated. Governed multi-agent delivery produces real product code (987 insertions across 4 files) on a real product repo (tusq.dev) using the shipped npm package. Every cycle traversed all 4 phases (planning → implementation → QA → launch).

## Reproduce

```bash
# Verify product-code diff
cd /path/to/tusq.dev-agentxchain-dogfood
git checkout agentxchain-dogfood-2026-04
git diff --stat origin/main..HEAD -- src/ tests/ bin/ tusq.manifest.json

# Verify checkpoint count
git log --oneline origin/main..HEAD | wc -l  # expect 42

# Verify shipped version
npx --yes -p agentxchain@2.155.22 agentxchain --version  # expect 2.155.22

# Run tests on the dogfood branch
npm test  # expect pass
```
