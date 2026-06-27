# System Spec — M16: Role Charter Well-Formedness — Open-Ended Roles Validation — Vision Closure (VISION.md:100–130)

**Run:** `run_dc50efa0354c0768`
**Turn:** `turn_5abb2e0f09dc2e4f`
**Baseline:** git:971041fe9 (HEAD of dogfood/2158-lights-out, v2.158.0)
**Implementation status:** NOT yet built. This is a new build milestone — a `role-charter.js` validation module + `agentxchain role validate` CLI subcommand + report integration + regression tests.

## Purpose

This run delivers ROADMAP.md M16: "Role Charter Well-Formedness — Open-Ended Roles Validation — Vision Closure (VISION.md:100–130)."

The VISION pillar **"Roles Are Open-Ended, Not Fixed"** (VISION.md:100–130) is non-negotiable product truth #5 ("Roles must be open-ended and charter-driven," VISION.md:297). It states: "AgentXchain must never assume that a software team consists only of `pm`, `dev`, and `qa`… The framework must support arbitrary agent roles and arbitrary charters" (VISION.md:102–121). Crucially, it fixes a precise, testable invariant for *any* chartered role (VISION.md:123–128):

> - every role has a mandate
> - every role has authority boundaries
> - every role produces governed artifacts
> - every role participates in a structured workflow
>
> AgentXchain governs **chartered roles**, not a hardcoded team template.

Today the framework already *permits* arbitrary roles: any role id matching `^[a-z0-9_-]+$` is accepted, and the `enterprise-app` template ships `architect` + `security_reviewer` beyond the reference trio. But permitting arbitrary roles is not the same as *governing* them. There is **no validator that enforces the four-part charter invariant on a role definition:**

- `normalized-config.js` validates only that a role's `title`/`mandate` are non-empty strings and `write_authority` is a valid enum — it does not check that the role is routed anywhere or can produce any artifact.
- `admission-control.js` (ADM-001/002/004) validates **phase-level file-production topology** (can *some* role in a gated phase produce the required files; is an `owned_by` role reachable) — it answers questions about phases and gates, **not** "is *this role* a complete chartered participant per VISION:123–128."
- `agentxchain role` exposes only `list` and `show` (role.js) — there is no `validate`.

So a user who adds a custom role — exactly what the vision demands the framework support — gets no single answer to "is this role's charter well-formed, or is it mandate-only text with an incoherent authority boundary, no owned/producible artifact, and no phase that routes to it?" M16 closes that gap with a **read-only, compose-don't-reimplement** validator that scores every role against the four VISION invariants, exposed through `agentxchain role validate` and the governance report. This is the M14/M15 discipline (new module + CLI surface + report section + tests, composing existing primitives) applied to the first milestone in the "Roles Are Open-Ended" pillar.

## Interface

### Module: `cli/src/lib/role-charter.js`

#### `evaluateRoleCharter(config, rawConfig, roleId): RoleCharterReport`

Scores a single role against the four VISION:123–128 invariants. **Read-only** — never mutates config, state, or artifacts.

```javascript
// RoleCharterReport structure
{
  role_id: string,
  overall: 'well_formed' | 'incomplete',   // 'well_formed' iff all four invariants satisfied
  invariants: [
    {
      id: 'mandate' | 'authority_boundary' | 'produces_artifacts' | 'workflow_participation',
      name: string,                  // human-readable invariant name
      satisfied: boolean,
      detail: string,                // why it passed/failed
      fix_hint: string | null        // concrete remediation when not satisfied
    }
  ],
  missing: string[],                 // invariant ids where satisfied === false
  evidence_summary: string           // one-line summary
}
```

#### `evaluateAllRoleCharters(config, rawConfig): AllRoleCharterReport`

```javascript
{
  total: number,
  well_formed: number,
  incomplete: number,
  incomplete_role_ids: string[],
  roles: RoleCharterReport[]          // one per defined role, stable order by role id
}
```

**Invariant 1 — Mandate (VISION.md:124)**
- Source: `config.roles[roleId].mandate`.
- Satisfied when `mandate` is a non-empty trimmed string.
- `fix_hint`: `Set a non-empty "mandate" for role "<id>" in agentxchain.json`.

**Invariant 2 — Authority boundary (VISION.md:125)**
- Source: `config.roles[roleId].write_authority` (must be one of `authoritative` / `proposed` / `review_only`) **and** the role's runtime binding resolved via `getRoleRuntimeCapabilityContract(roleId, role, runtime)` (runtime-capabilities.js:104).
- Satisfied when `write_authority` is a valid enum AND the role's bound runtime exists AND the derived `effective_write_path` is not `none` (i.e. the authority is coherent with the runtime, not an impossible binding such as `review_only` on a `local_cli` runtime).
- `fix_hint`: names the incoherence, e.g. `Role "<id>" write_authority "review_only" on local_cli runtime resolves to no write path; bind a runtime that supports it or change authority`.

**Invariant 3 — Produces governed artifacts (VISION.md:126)**
- Source: composition of (a) `canRoleParticipateInRequiredFileProduction(role, runtime)` (runtime-capabilities.js:188) across the phases the role is routed to, using `getEffectiveGateArtifacts(config, gateDef, phase)` (gate-evaluator.js:33) to confirm those phases have required artifacts; and (b) `canRoleSatisfyWorkflowArtifactOwnership(role, runtime)` (runtime-capabilities.js:202) for any workflow-kit artifact whose `owned_by === roleId`.
- Satisfied when the role can reach required-file production in ≥1 routed phase, OR owns ≥1 workflow-kit artifact it can satisfy. (Manual-runtime roles, which humans satisfy outside the governed turn mechanism, count as able to produce — mirroring admission-control.js's manual-runtime carve-out.)
- `fix_hint`: `Role "<id>" produces no governed artifact: route it to a file-producing phase or give it owned_by on a workflow artifact`.

**Invariant 4 — Participates in a structured workflow (VISION.md:127)**
- Source: `config.routing` — the role id appears as `entry_role` or within `allowed_next_roles` of ≥1 phase.
- Satisfied when the role is referenced in routing for at least one phase.
- `fix_hint`: `Role "<id>" is not in any phase routing; add it to entry_role or allowed_next_roles of a phase`.

> Implementer note (compose, don't reimplement): reach every signal through the exported API above. Do **not** re-derive runtime write paths by hand (`getRoleRuntimeCapabilityContract` already does it), do **not** re-parse gate artifacts (`getEffectiveGateArtifacts`), and do **not** duplicate the manual-runtime / file-production logic that lives in `runtime-capabilities.js` and `admission-control.js`. The four invariants are the floor; the report shape must stay stable for tests.

### Command: `agentxchain role validate [role_id]`

**Registration:** extend `roleCmd` in `cli/bin/agentxchain.js:958` (the existing `role` command group with `list` and `show`); delegate to `roleCommand('validate', roleId, opts)` in `cli/src/commands/role.js`.

```
agentxchain role validate [role_id] [options]

Args:
  role_id   Optional. Validate one role; if omitted, validate ALL defined roles.

Options:
  --json    Machine-readable output (RoleCharterReport for one role, or AllRoleCharterReport for all)
```

Default output (all roles, one incomplete):
```
Role charter validation (4 roles):
  ✓ pm                well-formed
  ✓ dev               well-formed
  ✓ qa                well-formed
  ✗ security_reviewer incomplete — missing: produces_artifacts, workflow_participation
      → Role "security_reviewer" is not in any phase routing; add it to entry_role or allowed_next_roles of a phase
      → Role "security_reviewer" produces no governed artifact: route it to a file-producing phase or give it owned_by on a workflow artifact

1 of 4 roles incomplete.
```

All well-formed:
```
Role charter validation (3 roles): all well-formed (4/4 invariants each).
```

**Exit-code contract:** exit `0` when every evaluated role is `well_formed`; exit `1` when any evaluated role is `incomplete`. (Unlike the M15 `attention` status surface, `role validate` is a validation gate over configuration — a non-zero exit is the actionable "your config has a malformed role" signal, suitable for CI / `doctor`-style use.) `--json` always emits a schema-valid report regardless of exit code.

### Report Integration

`buildGovernanceReport()` (`report.js:1245`, mirroring `buildHumanAttentionSummary` at `report.js:1083`) includes:
```javascript
report.role_charters = {
  total: number,
  well_formed: number,
  incomplete: number,
  incomplete_role_ids: string[]
}
```

### Architecture Invariants

1. `role-charter.js` composes existing modules (`runtime-capabilities`, `gate-evaluator`, `admission-control` carve-outs, config routing) — it does not reimplement runtime-capability derivation, gate-artifact resolution, or file-production logic.
2. `evaluateRoleCharter()` / `evaluateAllRoleCharters()` are read-only — never modify config, state, artifacts, or routing.
3. Well-formedness is exact: `overall === 'well_formed'` **iff** all four invariants are `satisfied`.
4. Each invariant is evaluated independently — one failing invariant never short-circuits or suppresses evaluation of the others; `missing[]` lists every unsatisfied invariant.
5. Evaluation order is deterministic (roles sorted by id; invariants in fixed order) so output and tests are stable.
6. The CLI subcommand delegates entirely to the module — no charter logic in the command file (consistent with role.js's existing thin `list`/`show`).
7. Exit code reflects validation outcome: 0 when all evaluated roles are well-formed, 1 when any is incomplete.

## Acceptance Tests

### Test Suite: `cli/test/role-charter.test.js`

| # | Test ID | Scenario | Expected |
|---|---------|----------|----------|
| 1 | AT-RC-001 | Valid config, reference roles pm/dev/qa | each role `well_formed`, 4/4 invariants, `missing` empty |
| 2 | AT-RC-002 | `enterprise-app` custom role `security_reviewer` properly routed + owning an artifact | `well_formed` |
| 3 | AT-RC-003 | Role with empty `mandate` | `incomplete`, `missing` includes `mandate`, invariant `mandate.satisfied === false` with fix_hint |
| 4 | AT-RC-004 | Role `review_only` bound to a `local_cli` runtime (incoherent authority) | `incomplete`, `missing` includes `authority_boundary` |
| 5 | AT-RC-005 | Role not routed to any file-producing phase and owning no artifact | `incomplete`, `missing` includes `produces_artifacts` |
| 6 | AT-RC-006 | Role absent from all routing (`entry_role`/`allowed_next_roles`) | `incomplete`, `missing` includes `workflow_participation` |
| 7 | AT-RC-007 | Role failing 3 invariants | `missing` lists all three; each invariant evaluated independently (no short-circuit) |
| 8 | AT-RC-008 | `evaluateAllRoleCharters` over mixed config | `total`/`well_formed`/`incomplete`/`incomplete_role_ids` correct; `roles` sorted by id |
| 9 | AT-RC-009 | well_formed iff 4/4 | a role with exactly one failing invariant is `incomplete`; flipping it to satisfied makes it `well_formed` |
| 10 | AT-RC-010 | CLI `role validate` all-well-formed | prints "all well-formed", exit 0 |
| 11 | AT-RC-011 | CLI `role validate` with an incomplete role present | prints incomplete role + missing invariants + fix hints, exit 1 |
| 12 | AT-RC-012 | CLI `role validate <id> --json` and `role validate --json` | valid `RoleCharterReport` / `AllRoleCharterReport` schema |
| 13 | AT-RC-013 | `evaluateRoleCharter` / `evaluateAllRoleCharters` perform no writes | config + state files byte-identical before/after |

### Acceptance Criteria

| # | Criterion | Evidence Required |
|---|-----------|-------------------|
| AC-1 | `role-charter.js` with `evaluateRoleCharter()` + `evaluateAllRoleCharters()` scoring the four VISION:123–128 invariants into a RoleCharterReport | Module exists, AT-RC-001…009 pass |
| AC-2 | `agentxchain role validate [role_id]` subcommand with `--json`, exit 0 all-well-formed / exit 1 any-incomplete | AT-RC-010, AT-RC-011, AT-RC-012 pass |
| AC-3 | Well-formedness exact: `overall === 'well_formed'` iff all four invariants satisfied; invariants evaluated independently | AT-RC-007, AT-RC-009 pass |
| AC-4 | Reference roles (pm/dev/qa) and an `enterprise-app` custom role (`security_reviewer`) both validate `well_formed` | AT-RC-001, AT-RC-002 pass |
| AC-5 | A malformed custom role is reported `incomplete` with its missing invariant id(s) and a concrete fix hint | AT-RC-003…006 pass |
| AC-6 | Governance report includes `role_charters` summary section | Report integration test passes |
| AC-7 | `evaluateRoleCharter`/`evaluateAllRoleCharters` are read-only | AT-RC-013 passes |
| AC-8 | Vision closure: VISION.md:100–130 "Roles Are Open-Ended, Not Fixed" four-part charter invariant (VISION.md:123–128) enforced as a composition over existing capability/routing/artifact primitives | QA ship verdict |
