# System Spec — BUG-FIX: Step Auto-Checkpoint Acceptance — PM→Dev Handoff

**Run:** `run_71c0a7eaf361090b`
**Baseline:** git:743e6c48d (HEAD of dogfood/2157-lights-out)

## Purpose

This run formally closes ROADMAP.md line 70: "Acceptance: PM→Dev handoff via consecutive `step` calls succeeds without manual git commit" under the "BUG-FIX: Step Command Missing Auto-Checkpoint After Acceptance" section.

Before the fix (run_8aceec319cd6aaed), the `step` command did not auto-checkpoint accepted turns. This meant operators had to manually `git add && git commit` between consecutive `step` calls to keep the workspace clean for the next turn. The `run` command already had this behavior — the `step` command was missing it.

The fix wired `checkpointAcceptedTurn()` into `step.js` after acceptance, matching `run.js`'s behavior. Three integration tests verify the feature. All code is delivered — this run is verification-only.

## Interface

### Component: Auto-Checkpoint in `step.js` — `cli/src/commands/step.js`

**Integration point (lines 1007-1020):**

After `acceptGovernedTurn()` succeeds at line 995, the auto-checkpoint block executes:

```javascript
if (!opts.noCheckpoint && existsSync(join(root, '.git'))) {
  const checkpointResult = await checkpointAcceptedTurn(root, config, {
    turn_id: acceptedTurnId,
    // ... turn metadata
  });
  if (checkpointResult.ok) {
    console.log(`Checkpoint: ${checkpointResult.checkpoint_sha}`);
  } else {
    console.error(`Checkpoint failed: ${checkpointResult.error}`);
    console.error(`Retry: agentxchain checkpoint-turn --turn ${acceptedTurnId}`);
    process.exit(1);
  }
}
```

**Key behaviors:**

1. **Enabled by default** — runs after every successful acceptance in a git repo
2. **`--no-checkpoint` opt-out** — `agentxchain.js:752` registers the flag; `step.js:1008` checks `opts.noCheckpoint`
3. **Acceptance is durable** — if checkpoint fails, the turn is still accepted (acceptance happens first at line 995)
4. **Checkpoint failure exits non-zero** — operator gets a retry command (`agentxchain checkpoint-turn --turn <id>`)

### Underlying Mechanism: `checkpointAcceptedTurn()` — `cli/src/lib/turn-checkpoint.js`

Lines 344-525. The checkpoint function:

1. Resolves the accepted turn from history
2. Stages only files declared in the turn's `files_changed` array: `git add -A -- ...filesChanged`
3. Validates all declared files actually staged (partitions missing files into categories)
4. Creates commit: `checkpoint: <turn_id> (role=<role>, phase=<phase>, runtime=<runtime>)`
5. Updates `state.json` with `accepted_integration_ref: git:<sha>` and `last_completed_turn`
6. Emits `turn_checkpointed` event

**Result:** Workspace is clean after checkpoint. Next `step` call sees clean baseline and can assign the next turn without error.

### Dev Charter

**Verification-only.** Run the step auto-checkpoint test suite:

```bash
cd cli && npx vitest run test/step-auto-checkpoint.test.js
```

Expected: 3 tests, 0 failures.

**What each test proves:**

| Test ID | Name | What It Proves |
|---------|------|----------------|
| AT-STEP-CKPT-001 | PM accepted → auto-checkpoint → dev assigns cleanly | **The acceptance criterion itself** — consecutive step calls work without manual git commit |
| AT-STEP-CKPT-002 | `--no-checkpoint` skips auto-checkpoint | Opt-out flag works; turn is accepted but workspace stays dirty |
| AT-STEP-CKPT-003 | Checkpoint failure exits non-zero with retry command | Fail-safe: acceptance is durable even when checkpoint fails |

After test verification, check off ROADMAP.md:70:
```markdown
- [x] Acceptance: PM→Dev handoff via consecutive `step` calls succeeds without manual git commit
```

### Architecture Invariants

1. No changes to any module — verification only
2. Auto-checkpoint runs after acceptance, never before — acceptance is the durable event
3. Checkpoint stages only declared `files_changed` — never `git add -A` on the whole workspace
4. `--no-checkpoint` is opt-out, not opt-in — default is to checkpoint
5. Checkpoint failure produces a retry command, not silent failure

## Acceptance Tests

All 3 tests must pass:

| # | Test ID | Description | Status |
|---|---------|-------------|--------|
| 1 | AT-STEP-CKPT-001 | PM turn accepted → auto-checkpointed → dev turn assigned without dirty-workspace error | Pending dev verification |
| 2 | AT-STEP-CKPT-002 | `--no-checkpoint` skips auto-checkpoint after acceptance | Pending dev verification |
| 3 | AT-STEP-CKPT-003 | Checkpoint failure exits non-zero with error message and retry command | Pending dev verification |

### Acceptance Criteria

| # | Criterion | Evidence Required |
|---|-----------|-------------------|
| AC-1 | All 3 step-auto-checkpoint tests pass (0 failures) | Dev test output |
| AC-2 | AT-STEP-CKPT-001 proves PM→Dev handoff without manual git commit | Dev confirms test flow matches criterion |
| AC-3 | ROADMAP.md:70 checked off | Dev edit |
| AC-4 | Acceptance contract: "PM→Dev handoff via consecutive `step` calls succeeds without manual git commit" | QA ship verdict |
