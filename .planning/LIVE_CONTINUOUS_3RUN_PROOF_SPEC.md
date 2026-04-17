## Purpose

Prove the product's strongest claim with a real unattended session: `agentxchain run --continuous --vision .planning/VISION.md --max-runs 3 --poll-seconds 30 --triage-approval auto` must complete three governed runs in sequence with at least one real-credential turn per run.

The proof must not depend on mocks, manual gate intervention, or a one-run extrapolation. It must leave durable evidence that an operator can inspect later on the website and in git history.

## Interface

### Live proof harness

- File: `examples/live-governed-proof/run-continuous-3run-proof.mjs`
- Default command under test:
  - `agentxchain run --continuous --vision .planning/VISION.md --max-runs 3 --poll-seconds 30 --triage-approval auto`
- Default real credential surface:
  - `api_proxy` QA runtime using `ANTHROPIC_API_KEY`
- Default authoring surface:
  - `local_cli` proof agent for planning and implementation turns

### Inputs

- `ANTHROPIC_API_KEY` for the live run
- Optional proof/test overrides:
  - `AXC_PROOF_AUTH_ENV`
  - `AXC_PROOF_BASE_URL`
  - `AXC_PROOF_POLL_SECONDS`
  - `AXC_PROOF_COOLDOWN_SECONDS`

### Outputs

- JSON proof summary including:
  - exact command used
  - session snapshot before start
  - session snapshot after completion
  - per-run evidence rows
  - git log extract showing run-derived commits
  - wall-clock timing
  - total spend
  - whether `VISION.md` remained unchanged

## Behavior

1. Create a temp governed repo and initialize git.
2. Seed a project-local `VISION.md` with three distinct goals so the continuous loop derives three intents, not one repeated goal.
3. Configure mixed runtimes truthfully:
   - local authoritative roles author gate files and product artifacts
   - `api_proxy` QA participates as the real-credential review surface
4. Run the exact CLI command above without manual intervention.
5. Capture the first persisted `continuous-session.json` snapshot after the session starts.
6. Capture the final `continuous-session.json` snapshot after the process exits.
7. Verify:
   - `runs_completed >= 3`
   - session status is `completed` or clean idle exit
   - each run-history entry carries `trigger: "vision_scan"` and `created_by: "continuous_loop"`
   - each run has at least one real-credential QA turn
   - each run maps to a distinct vision goal
   - git history includes run-derived commits carrying a session-id trailer
   - `VISION.md` content is unchanged

## Error Cases

- Missing real credential:
  - live proof returns `skip` with the missing env var
- Continuous loop exits non-zero:
  - proof returns `fail` with stdout/stderr tails and preserved temp repo path
- Session never materializes:
  - proof returns `fail` with a session-creation timeout error
- Session completes with fewer than three runs:
  - proof returns `fail`
- A run has no real-credential QA turn:
  - proof returns `fail`
- Run-derived commits do not include the session-id trailer:
  - proof returns `fail`
- `VISION.md` changed:
  - proof returns `fail`

## Acceptance Tests

- `AT-LIVE-3RUN-001`: the live harness skips cleanly when the configured auth env is absent.
- `AT-LIVE-3RUN-002`: with a fixture VISION and a mock Anthropic-compatible endpoint, the harness completes 3 governed runs and emits per-run `vision_scan` provenance.
- `AT-LIVE-3RUN-003`: the proof agent creates run-derived commits whose messages include a continuous-session trailer.
- `AT-LIVE-3RUN-004`: the case-study page includes the exact command, before/after session snapshots, per-run evidence, git-log evidence, and wall-clock/spend totals.

## Open Questions

- None for this slice. The proof must ship as evidence, not as another placeholder contract.
