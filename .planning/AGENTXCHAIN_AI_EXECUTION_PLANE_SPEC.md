## AgentXchain.ai Execution Plane Spec

**Status:** Active
**Created:** Turn 286 - GPT 5.4
**Depends on:** `AGENTXCHAIN_AI_MANAGED_SURFACE_SPEC.md`, `AGENTXCHAIN_AI_CONTROL_PLANE_API_SPEC.md`

### Purpose

Define the hosted execution contract for `agentxchain.ai`: how governed turns are queued, leased, executed, recovered, and attributed when the runner is service-operated instead of repo-local.

The managed-surface spec correctly freezes protocol parity, and the control-plane API spec correctly defines tenancy and mutation endpoints. What was still missing is the failure model for the thing that actually runs turns. Without that contract, ".ai execution plane" is just hand-waving around a queue.

This spec defines the execution boundary so hosted operation cannot drift into an opaque job runner with different semantics than the OSS CLI.

### Interface

Execution-plane objects:

- `dispatch_job`
  - immutable dispatch request for a single governed turn
  - references `workspace_id`, `project_id`, `run_id`, `turn_id`, `role`, `runtime_id`, `dispatch_bundle_ref`
- `execution_lease`
  - exclusive time-bounded claim on a `dispatch_job`
  - fields: `lease_id`, `job_id`, `worker_id`, `claimed_at`, `expires_at`, `heartbeat_at`, `attempt`
- `worker`
  - service-operated runtime host that can execute a declared connector/runtime tuple
  - advertises capability set and max concurrent leases
- `execution_event`
  - structured progress/audit event emitted during execution
  - uses the shared `.dev` event schema shape even when delivered over hosted transport
- `connector_session`
  - scoped runtime credential/materialization for a managed connector
  - bound to workspace, optionally narrowed to project
- `turn_observation`
  - execution-plane capture of stdout/stderr, connector events, artifact submission metadata, verification outputs, and terminal status

Queue topology:

- one active dispatch queue per `project_id`
- FIFO ordering within a project
- fair cross-project scheduling within workspace policy limits
- at most one active execution lease per project run head unless protocol semantics explicitly allow parallel governed turns

Primary operations:

1. enqueue dispatch job after the control plane creates or resumes a governed turn
2. claim lease by a compatible worker
3. materialize connector session and dispatch bundle
4. stream execution events and heartbeats
5. finalize turn result or fail the lease
6. hand the result back to the shared protocol evaluator for acceptance/rejection

### Behavior

1. **The execution plane runs protocol work; it does not decide protocol outcomes.**
   - Workers may execute a turn and collect artifacts.
   - Acceptance, rejection, checkpoint, retry, and gate transitions still flow through the shared protocol evaluators.
   - A worker crash must never implicitly accept or reject a turn.

2. **Queueing is project-scoped first, workspace-scoped second.**
   - Each project gets an ordered dispatch queue so turn sequencing remains explainable.
   - Workspace policy may cap total concurrent jobs across projects.
   - When the workspace cap is saturated, the scheduler selects the next project using round-robin across projects that still have waiting jobs; it does not let one noisy project drain its entire queue before other projects get service.
   - FIFO remains strict inside each project queue.
   - Parallel governed turns are allowed only when the underlying run/phase contract already allows them.

3. **Leases are exclusive and time-bounded.**
   - A worker claims a `dispatch_job` by acquiring an `execution_lease`.
   - Lease defaults are runtime-class-specific from day one:
     - `local_cli`: 30 minutes
     - `api_proxy`: 10 minutes
     - `manual`: not execution-plane leased; human-driven turns stay in control-plane approval state instead of being assigned to workers
   - Workers heartbeat every 30 seconds.
   - Missing 2 consecutive heartbeat windows marks the lease stale and eligible for recovery.
   - Lease expiry never auto-retries silently; it transitions the job to `needs_recovery` for explicit protocol-compatible retry or restart.

4. **Crash recovery fails closed.**
   - If a worker dies after creating repo mutations or remote side effects but before submitting a turn result, the job remains unresolved.
   - The execution plane records the last known observation and marks the turn `interrupted`.
   - Recovery action is explicit: operator retry, restart from checkpoint, or connector-specific cleanup.
   - No second worker may resume a stale lease unless the prior lease is formally expired and the control plane has emitted a recovery event.

5. **Connector sessions are scoped and attributable.**
   - Managed connector credentials are materialized as workspace-scoped sessions, with optional project narrowing if policy allows it.
   - Every connector session records which worker used it, for which job, and under which agent identity.
   - Session material must be revocable without mutating protocol state.

6. **Execution progress is streamed as structured events, not opaque heartbeat blobs.**
   - Workers emit shared-schema execution events at minimum for:
     - `execution_started`
     - `execution_progress`
     - `verification_started`
     - `verification_completed`
     - `execution_completed`
     - `execution_interrupted`
   - Event delivery transport may be WebSocket, SSE, or polling-backed retrieval, but the event contract is shared and durable.
   - Progress visibility must include enough structured detail for the hosted dashboard to show more than a generic "in progress" pill.

7. **Execution observations are append-only evidence, not substitute truth.**
   - The execution plane stores stdout/stderr, structured runtime events, verification command outputs, and file-observation metadata.
   - These observations support debugging, audit, and replay.
   - They do not override the protocol artifact contract or invent cloud-only acceptance heuristics.

8. **Verification-produced files keep the same semantics as `.dev`.**
   - If hosted verification creates files, they must be classified using the same `verification.produced_files` contract as the OSS runner.
   - `artifact` disposition promotes files into checkpointable history.
   - `ignore` disposition requires the execution plane to restore or discard the side effect before acceptance succeeds.

9. **Worker compatibility is capability-declared.**
   - A worker may only claim jobs for runtimes/connectors whose declared capabilities it satisfies.
   - Hosted infrastructure does not grant extra write authority.
   - Capability mismatch is a scheduling failure, not a runtime improvisation.

10. **Backoff is bounded and visible.**
   - Transient infrastructure failures may trigger one automatic requeue before operator involvement.
   - Automatic requeue is only allowed before a worker has materially started the turn.
   - After dispatch-bundle handoff or connector-session creation, retry becomes an explicit recovery action with audit history.

11. **The first implementation slice is service-operated only.**
   - Hosted workers are operated by the AgentXchain service for v1.
   - Customer-provided workers or hybrid "cloud control plane, customer execution plane" are deferred until there is a separate trust, attestation, and lease-integrity contract.
   - The first hosted release must not blur those models behind a generic "worker" abstraction.

12. **The first implementation slice should keep execution narrow.**
   - one worker pool type
   - project-scoped FIFO queues
   - fair round-robin project selection under workspace caps
   - single-lease execution
   - explicit operator-driven recovery
   - structured progress events
   - service-operated workers only
   - no speculative failover, no multi-region lease juggling, no hidden replay

### Error Cases

1. A worker crash causes the control plane to infer acceptance or rejection without a submitted turn result.
2. A second worker picks up the same job before the first lease is formally expired.
3. Workspace-wide queueing allows one noisy project to starve every other project without policy visibility.
4. Hosted verification files are treated differently than repo-local `verification.produced_files`.
5. Automatic retry replays a turn after external side effects already occurred.
6. Connector credentials are shared between projects without audit visibility.
7. Worker capability mismatch is handled by "trying anyway" instead of failing scheduling.
8. Execution-plane observations become the de facto source of truth for governance instead of the shared protocol artifacts/state machine.
9. A long-running `local_cli` turn gets marked stale under a too-short generic lease even though the worker is healthy.
10. Hosted dashboards cannot show useful in-flight state because workers emit only heartbeats and no structured progress events.
11. The worker trust model is left ambiguous, causing service-operated and customer-provided execution semantics to drift together.

### Acceptance Tests

1. `AT-EP-001`: A project queue preserves FIFO dispatch order unless the protocol explicitly allows parallel governed turns.
2. `AT-EP-002`: A worker that misses 2 heartbeat windows loses its lease and moves the job to `needs_recovery`; the job is not auto-accepted, auto-rejected, or silently replayed.
3. `AT-EP-003`: A second worker cannot claim an active lease for the same job.
4. `AT-EP-004`: Hosted verification-created files follow the same `verification.produced_files` promotion/ignore rules as `.dev`.
5. `AT-EP-005`: Automatic requeue is allowed only before connector-session materialization or dispatch handoff; otherwise recovery requires explicit operator action.
6. `AT-EP-006`: Every execution event is attributable to `worker_id`, `connector_session_id`, and agent identity.
7. `AT-EP-007`: Capability mismatch prevents scheduling instead of widening runtime authority.
8. `AT-EP-008`: Execution-plane recovery actions emit audit/event entries that match the shared control-plane event contract.
9. `AT-EP-009`: Under a saturated workspace concurrency cap, waiting jobs from different projects are scheduled round-robin instead of letting one project monopolize the worker pool.
10. `AT-EP-010`: `local_cli` jobs use a 30-minute default lease, `api_proxy` jobs use a 10-minute default lease, and manual turns are not assigned execution leases.
11. `AT-EP-011`: Hosted execution emits the minimum structured progress event set (`execution_started`, `execution_progress`, `verification_started`, `verification_completed`, `execution_completed`, `execution_interrupted`) using the shared event schema.
12. `AT-EP-012`: v1 execution rejects customer-provided worker registration; only service-operated workers may claim leases.

### Open Questions

1. Should the first hosted runner share code with the existing Node.js runner directly, or wrap it as a library behind a service boundary?
2. Should future hosted scheduling stay strict round-robin, or later evolve toward weighted fairness/priorities once org-level policy exists?
3. Should long-running hosted stdout/stderr streams be truncated by byte budget, time window, or semantic event boundaries when rendering the dashboard?
