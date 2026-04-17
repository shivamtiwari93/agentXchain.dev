# Mission Plan Launch Cascade — Decision Spec

## Status: REJECTED

**Decision:** `DEC-MISSION-PLAN-LAUNCH-CASCADE-001`

## The Question

Should `mission plan launch --all-ready --cascade` exist as a product surface that automatically re-evaluates and launches newly-unblocked workstreams after each completed launch in the same invocation?

## Decision: No. Rejected as scope creep.

### Operator Cost Without Cascade

Running `agentxchain mission plan launch --all-ready` a second time after the first batch completes is trivial. The operator gets:

- Full visibility into what completed and what failed before the next batch starts
- An explicit decision point between launch phases
- Zero risk of cascading failures propagating through a deep dependency graph in a single unattended invocation

### Engineering Cost With Cascade

Getting cascade right requires solving:

1. **Re-evaluation timing**: After each workstream completes, re-scan the plan for newly-ready workstreams. This means the launch loop must reload the plan artifact after every outcome recording.
2. **Failure propagation**: If workstream A fails mid-cascade after workstream B (which depends on A) was already identified as newly-ready, the cascade must not launch B. This requires re-checking dependencies at launch time, not at identification time.
3. **Double-launch prevention**: A workstream that was ready in the initial batch AND becomes ready again via cascade (impossible today, but defensive code is needed) must not be launched twice.
4. **Batch context boundary**: Does a newly-ready workstream inherit the same `--auto-approve` setting? Same provenance context? Or is it a new launch phase with its own context?
5. **Observability**: The operator needs to distinguish "launched in initial batch" from "launched via cascade" in the launch records and dashboard.

None of these are unsolvable, but the total engineering cost far exceeds the operator cost of running `--all-ready` again.

### The Right Alternative

If an operator wants fully unattended execution of a deep dependency graph, the correct product surface is a **mission executor** that watches for workstream completions and triggers the next launch phase. That is a different product feature (mission autopilot / lights-out execution) with its own contract, not a flag bolted onto the batch launch command.

### Preserved

- `--all-ready` remains the batch launch surface for all currently-ready workstreams
- Operators run `--all-ready` again after inspecting results to launch the next wave
- A future `mission run --autopilot` or similar is the correct home for cascade-like behavior, if the product needs it

### Rejected Alternatives

- `--cascade` flag on `mission plan launch`
- Automatic re-evaluation within `--all-ready` invocation
- Silent cascade with no operator checkpoint
