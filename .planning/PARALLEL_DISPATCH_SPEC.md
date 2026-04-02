# Parallel Dispatch — Spec

> Defines the orchestrator-to-adapter handoff when multiple governed turns may be in flight at once.

---

## Purpose

v1 dispatch assumes exactly one active turn:

- one shared bundle path: `.agentxchain/dispatch/current/`
- one shared staging path: `.agentxchain/staging/turn-result.json`

That contract breaks under concurrency because two turns would race on the same prompt bundle, staging file, stdout logs, and provider artifacts.

This spec defines the minimal v1.1 dispatch/staging changes required to support parallel turns without changing the core governance rule that adapters execute exactly one turn per invocation.

---

## Interface/Schema

### Filesystem Layout

```text
.agentxchain/
  dispatch/
    index.json
    turns/
      <turn_id>/
        ASSIGNMENT.json
        PROMPT.md
        CONTEXT.md
        # adapter-scoped audit artifacts MAY also appear here
  staging/
    <turn_id>/
      turn-result.json
      provider-response.json         # optional, adapter-authored
      stdout.log                     # optional, adapter-authored
      stderr.log                     # optional, adapter-authored
```

There is no shared mutable `dispatch/current/` or shared mutable `staging/turn-result.json` in parallel mode. Per-turn directories are the isolation primitive.

### `DispatchIndex`

**Path:** `.agentxchain/dispatch/index.json`

```ts
interface DispatchIndex {
  run_id: string;
  phase: string;
  updated_at: string;                             // ISO 8601.
  active_turns: Record<string, DispatchIndexEntry>;
}

interface DispatchIndexEntry {
  turn_id: string;
  role: string;
  runtime_id: string;
  attempt: number;
  status: "running" | "retrying" | "failed";
  bundle_path: string;
  staging_result_path: string;
  assigned_sequence: number;
  advisory_warnings?: DispatchWarning[];
}

interface DispatchWarning {
  code: "advisory_scope_overlap" | "budget_reservation_high";
  message: string;
  turn_ids?: string[];
  files?: string[];
}
```

### `ASSIGNMENT.json`

`ASSIGNMENT.json` keeps the v1 fields and adds concurrency metadata:

```ts
interface ParallelAssignmentBundle {
  run_id: string;
  turn_id: string;
  phase: string;
  role: string;
  runtime_id: string;
  write_authority: "authoritative" | "proposed" | "review_only";
  accepted_integration_ref: string | null | undefined;
  staging_result_path: string;                   // .agentxchain/staging/<turn_id>/turn-result.json
  reserved_paths: string[];
  allowed_next_roles: string[];
  attempt: number;
  deadline_at: string;
  assigned_sequence: number;
  budget_reservation_usd: number | null;
  active_siblings: ActiveSibling[];
  advisory_warnings?: DispatchWarning[];
}

interface ActiveSibling {
  turn_id: string;
  role: string;
  status: "running" | "retrying" | "failed";
  assigned_sequence: number;
  declared_file_scope?: string[];
}
```

### Adapter Invocation Contract

Adapters remain single-turn workers. The orchestrator invokes them with an explicit turn-scoped bundle/staging contract:

```ts
interface AdapterDispatchInvocation {
  turn_id: string;
  bundle_path: string;                           // .agentxchain/dispatch/turns/<turn_id>
  staging_result_path: string;                  // .agentxchain/staging/<turn_id>/turn-result.json
  timeout_ms: number;
  resume: boolean;
}
```

No adapter may infer the bundle or staging path from a shared singleton location in parallel mode.

---

## Behavior

### 1. Per-Turn Bundle Materialization

`writeDispatchBundle()` becomes turn-scoped:

1. Resolve the target turn from `state.active_turns[turn_id]`.
2. Remove `.agentxchain/dispatch/turns/<turn_id>/` if it already exists.
3. Recreate that directory and write `ASSIGNMENT.json`, `PROMPT.md`, and `CONTEXT.md`.
4. Update `.agentxchain/dispatch/index.json` atomically.

Writing one turn's bundle MUST NOT delete or rewrite sibling turn bundles.

### 2. Per-Turn Staging Isolation

Every active turn gets its own staging directory:

- `.agentxchain/staging/<turn_id>/turn-result.json`
- optional adapter artifacts live beside that turn result

`accept-turn --turn <id>` and `reject-turn --turn <id>` operate only on the targeted turn's staging directory. Accepting or rejecting one turn MUST NOT delete sibling staging artifacts.

### 3. Adapter Scope

Adapters stay single-turn even in parallel mode:

- one `step`/dispatch call targets one turn
- one adapter invocation writes one turn result
- one adapter invocation owns only its own turn directory and staging directory

Parallelism comes from multiple active turns existing concurrently, not from batch-dispatching multiple turns through a single adapter call.

### 4. Resume / Retry Semantics

Redispatch of an existing turn:

- reuses the same `turn_id`
- rewrites only `.agentxchain/dispatch/turns/<turn_id>/`
- preserves the same staging directory path
- clears only that turn's stale staged result before redispatch
- preserves retry diagnostics in `PROMPT.md`

Sibling turn bundles and staged outputs remain untouched.

### 5. Advisory Conflict Warning

If the new turn's `declared_file_scope` overlaps any sibling turn's declared scope:

- the assignment still succeeds
- `ASSIGNMENT.json` includes an `advisory_scope_overlap` warning
- `CONTEXT.md` renders the overlapping files and sibling turn IDs
- `dispatch/index.json` records the same warning for operator tooling

This warning is informational only. Acceptance-time conflict detection based on observed files remains authoritative.

### 6. Budget Reservation at Dispatch Time

Before writing a new bundle, the orchestrator MUST:

1. compute the turn's estimated reservation
2. verify sufficient unreserved budget remains
3. persist the reservation in `state.budget_reservations[turn_id]`
4. mirror `budget_reservation_usd` into `ASSIGNMENT.json`

If bundle writing later fails, the reservation write MUST be rolled back before returning an error.

### 7. Blocked Coexistence Rule

If one turn is blocked while siblings are still running:

- existing sibling bundles stay valid
- adapters already running are not cancelled by the orchestrator
- `accept-turn` may still accept healthy siblings
- `step` MUST refuse new assignment while `state.status === "blocked"`
- `step --resume --turn <blocked_turn_id>` targets only the blocked turn after operator recovery

### 8. CLI Surface Changes

Parallel dispatch requires turn targeting when cardinality is ambiguous:

- `step --resume` requires `--turn <id>` when more than one active turn exists
- `accept-turn` requires `--turn <id>` when more than one staged turn result exists
- `reject-turn` requires `--turn <id>` when more than one active turn exists
- `status` reads `.agentxchain/dispatch/index.json` to render all active bundles and warnings

When exactly one active turn exists, the CLI may preserve the v1 shorthand and infer the target turn.

### 9. Compatibility Mode

When `max_concurrent_turns === 1`, the orchestrator MAY still use the per-turn layout. Sequential behavior remains compatible because there is only one live turn directory and one live staging directory.

The spec does NOT require a compatibility mirror back to `.agentxchain/dispatch/current/`. That path is considered obsolete for v1.1+ parallel-aware adapters.

---

## Error Cases

1. **Bundle write collision for same turn:** Existing turn directory is removed and recreated. If removal or recreation fails, dispatch fails and the reservation rollback rule applies.

2. **Missing turn-scoped bundle path passed to adapter:** Adapter returns an immediate dispatch error; no state mutation.

3. **Adapter writes to sibling staging path:** Protocol violation. The orchestrator rejects the result and surfaces the wrong-path write.

4. **Targetless `accept-turn`/`reject-turn`/`step --resume` with multiple active turns:** CLI fails with a clear `specify --turn` error.

5. **Stale turn directory after acceptance/rejection:** The orchestrator removes the target turn's dispatch and staging directories after terminal resolution. Sibling directories remain.

6. **Index drift:** If `.agentxchain/dispatch/index.json` disagrees with `state.active_turns`, `state.json` wins. The index is rebuilt from state on the next bundle write or `status --repair-dispatch-index` style maintenance command in a future slice.

7. **Reservation persisted but bundle missing:** Treat as incomplete dispatch preparation. The next targeted `step --resume --turn <id>` must rewrite the bundle in place rather than allocate a new turn.

8. **Blocked run with healthy sibling staging result present:** `accept-turn --turn <healthy_id>` still succeeds. New assignment remains forbidden until the blocker is resolved.

---

## Acceptance Tests

| # | Assertion |
|---|-----------|
| AT-PD-01 | Dispatching one of two active turns writes `.agentxchain/dispatch/turns/<turn_id>/ASSIGNMENT.json` without deleting the sibling turn directory |
| AT-PD-02 | `ASSIGNMENT.json` contains a turn-specific `staging_result_path` under `.agentxchain/staging/<turn_id>/` |
| AT-PD-03 | `dispatch/index.json` lists every active turn with bundle path, staging path, attempt, and status |
| AT-PD-04 | Redispatching a retrying turn rewrites only that turn's bundle directory and preserves sibling directories |
| AT-PD-05 | `local_cli` dispatch receives an explicit `bundle_path` and `staging_result_path` and stages output only to that path |
| AT-PD-06 | `api_proxy` dispatch receives an explicit `bundle_path` and `staging_result_path` and writes provider artifacts only under the targeted turn directory |
| AT-PD-07 | When declared scopes overlap, the bundle is still written and `ASSIGNMENT.json` includes `advisory_scope_overlap` |
| AT-PD-08 | When declared scopes do not overlap, no advisory warning is emitted |
| AT-PD-09 | New assignment fails before bundle creation when budget reservation would exceed unreserved budget |
| AT-PD-10 | If bundle creation fails after reservation write, the reservation is rolled back |
| AT-PD-11 | `accept-turn --turn <id>` removes only the accepted turn's bundle/staging directories |
| AT-PD-12 | `reject-turn --turn <id>` with retries remaining rewrites only the targeted turn's bundle directory |
| AT-PD-13 | `step --resume` with multiple active turns and no `--turn` fails with a targeting error |
| AT-PD-14 | `step --resume --turn <id>` redispatches only the specified preserved turn |
| AT-PD-15 | `status` renders warnings from `dispatch/index.json` for overlapping declared scopes |
| AT-PD-16 | A blocked run with one failed turn and one healthy sibling still allows `accept-turn --turn <healthy_id>` |
| AT-PD-17 | New assignment is rejected while `state.status === "blocked"` even if `active_turns` count is below `max_concurrent_turns` |
| AT-PD-18 | With `max_concurrent_turns = 1`, the single-turn lifecycle still works using the turn-scoped bundle/staging layout |

---

## Open Questions

1. Should the orchestrator retain accepted/rejected turn bundles under `.agentxchain/dispatch/archive/<turn_id>/` for operator forensics, or is history plus adapter artifacts sufficient?

2. Should `status` and `CONTEXT.md` render only direct sibling overlap warnings, or also surface second-order risk such as "three turns already touching `src/core/**`"?

3. Do we want a future convenience alias such as `.agentxchain/dispatch/latest/` for manual operators, or should all tooling move directly to turn-scoped paths?
