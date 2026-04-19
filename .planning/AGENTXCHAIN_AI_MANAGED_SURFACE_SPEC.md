## AgentXchain.ai Managed Surface Spec

**Status:** active
**Created:** Turn 284 - GPT 5.4

### Purpose

Turn the `.ai` vision from boundary copy into an implementable product contract.

The repo already states that:

- `agentxchain.dev` is the open-source, self-hosted surface
- `agentxchain.ai` is the managed cloud surface in early access
- the managed surface should eventually provide hosted orchestration, shared dashboards, persistent run history, and managed software-factory operation

What is still missing is the architecture contract that says what `.ai` actually is, how it relates to the OSS runner, and which parts must stay protocol-compatible instead of drifting into a separate product with incompatible semantics.

This spec freezes that boundary before implementation starts.

### Interface

Product layers:

- `agentxchain.dev`
  - protocol docs, reference CLI runner, local dashboard, local filesystem state, self-hosted adapters
- `agentxchain.ai`
  - managed control plane
  - managed run/event store
  - hosted dashboard and organization views
  - managed connector execution plane
  - organization/workspace/project identity and policy layer

Contracts that must remain shared:

- protocol version and constitutional artifacts
- dispatch bundle contract
- turn-result schema
- governed run state machine semantics
- export/restore schema for portability
- gate semantics and decision ledger semantics

Primary managed surfaces:

1. **Cloud control plane API**
   - organizations
   - workspaces
   - projects
   - governed runs
   - approvals
   - audit/event queries

2. **Managed execution plane**
   - hosted runners that execute the same protocol contract as the OSS runner
   - managed adapters/connectors with explicit capability declarations
   - queueing, lease ownership, and bounded retry semantics

3. **Hosted dashboard**
   - org-wide and project-wide run visibility
   - persistent run history
   - approval and recovery actions consistent with protocol authority rules

4. **Portability boundary**
   - import from `.dev` via export/restore or protocol-compatible event/state import
   - export from `.ai` back to repo-native artifacts without lossy proprietary-only state
   - cloud-only metadata is limited to presentation-tier fields: `display_name`, `notification_preferences`, `dashboard_layout`, `search_index_state`

### Behavior

1. **`.ai` is a managed control plane, not a forked protocol.**
   - The hosted surface may change transport, storage, and identity, but not constitutional turn/gate/artifact semantics.
   - A run accepted on `.ai` must be explainable using the same protocol language as a run accepted by the OSS CLI.

2. **Filesystem state becomes service-owned persistence, not service-specific semantics.**
   - `.dev` stores state under `.agentxchain/` in a git repo.
   - `.ai` stores equivalent state in durable service storage.
   - The storage medium changes; the governed meaning of the state does not.

3. **The control plane owns tenancy, policy, authentication, authorization, and audit.**
   - Organizations contain workspaces.
   - Workspaces contain governed projects and their run history.
   - Approval authority, policy bindings, notification routing, and connector credentials are scoped at workspace/project level with explicit audit history.
   - Human operators authenticate as workspace-scoped principals.
   - Managed connectors authenticate as workspace-scoped service principals and must preserve agent identity in audit trails.

4. **The execution plane must remain capability-declared.**
   - Managed connectors must advertise the same capability shape as OSS connectors.
   - A hosted runtime cannot silently exceed its declared authority just because it runs in cloud infrastructure.
   - Managed execution must preserve role mandate, write authority, runtime type, and artifact contract semantics.

5. **Approvals stay human-sovereign.**
   - Hosted dashboards may make approvals easier to execute, but may not bypass phase/run approval rules.
   - Human gate approvals remain explicit, attributable actions with audit entries.

6. **Persistent run history is append-only and exportable.**
   - `.ai` must preserve decision ledger entries, turn history, objections, gate transitions, and notification/audit evidence.
   - The service may add indexes and derived views, but the underlying run history must remain reconstructable as repo-native evidence.

7. **`.ai` adds org-wide visibility that `.dev` cannot provide locally.**
   - cross-project rollups
   - shared dashboard views
   - search/filter over historical runs
   - policy and approval queues across workspaces
   - managed notification routing and credentials

8. **Managed adapters are distinct from generic remote bridges.**
   - The existing `remote_agent` bridge proves transport replaceability.
   - `.ai` managed execution must add tenancy isolation, credential management, auditability, queueing, and operator governance, not just remote HTTP dispatch.

9. **Portability is a first-class requirement, not a migration afterthought.**
   - A user must be able to start on `.dev`, move a governed project to `.ai`, and later recover/export evidence back out without losing decision or gate history.
   - Cloud-only metadata is restricted to presentation-tier fields: `display_name`, `notification_preferences`, `dashboard_layout`, `search_index_state`.
   - Any field that can affect turn acceptance, gate evaluation, phase transitions, decision ledger outcomes, connector authority, or artifact interpretation is protocol state and must remain exportable.

10. **The first `.ai` slice should sequence infrastructure before presentation.**
   - Step 1: persistent run/event storage
   - Step 2: organization/workspace/project lifecycle
   - Step 3: approval queue plus protocol-compatible recovery actions (`restart`, `checkpoint`, `retry`)
   - Step 4: hosted dashboard views on top of the same control-plane state
   - Step 5: managed connector credential handling
   - not a second protocol, not a different run model, not cloud-only artifact rules

### Error Cases

1. `.ai` introduces a hosted-only run lifecycle that cannot be mapped back to the protocol state machine.
2. Managed connectors bypass declared write authority because the cloud runner is treated as trusted infrastructure instead of a governed runtime.
3. Hosted dashboards expose mutation actions that are impossible to express as protocol approval/recovery operations.
4. Cloud persistence stores only derived analytics and loses append-only decision or turn evidence.
5. `.dev` to `.ai` migration requires proprietary irreversible transforms instead of protocol-compatible import/export.
6. Public copy overstates `.ai` availability or maturity beyond what the architecture can currently support.
7. `.ai` duplicates OSS logic ad hoc instead of reusing shared protocol evaluators, causing drift between self-hosted and managed outcomes.
8. Cloud-only metadata expands until governance-affecting state becomes non-exportable.
9. The first implementation slice tries to build storage, tenancy, dashboard, approvals, and execution simultaneously, producing no shippable surface.

### Acceptance Tests

1. `AT-AI-001`: The managed surface is explicitly defined as control plane + execution plane + hosted dashboard + portability boundary, not just "cloud" in general.
2. `AT-AI-002`: The spec states that protocol semantics remain shared across `.dev` and `.ai`, including dispatch bundles, turn results, gates, decisions, and export/restore boundaries.
3. `AT-AI-003`: The spec defines tenancy objects (`organization`, `workspace`, `project`) and their governance responsibilities.
4. `AT-AI-004`: The spec freezes human-approval sovereignty and rejects hosted bypasses of phase/run approval rules.
5. `AT-AI-005`: The spec distinguishes managed adapters/execution from the already-shipped generic `remote_agent` bridge.
6. `AT-AI-006`: The spec requires portability between `.dev` and `.ai` without lossy protocol drift.
7. `AT-AI-007`: The spec names the first implementation slice as visibility/managed-operations first, not cloud-only governance reinvention.
8. `AT-AI-008`: The spec explicitly names the only allowed cloud-only metadata fields and forbids governance-affecting state from living in that bucket.
9. `AT-AI-009`: The spec sequences the first `.ai` slice in dependency order instead of listing an unordered feature pile.

### Open Questions

1. Should `.ai` use protocol-compatible event import/export only, or also support direct import of repo-native `.agentxchain/` state bundles for cold migration?
2. Should the first dashboard slice expose recovery actions as one-click mutations, guided operator flows, or both?
3. Should managed connector credentials support project-local overrides from day one, or should v1 force workspace-only credentials until audit ergonomics are proven?
4. How much of the hosted control plane should be open-spec before the first implementation slice lands: REST/JSON only, or also webhook/event stream contracts?
