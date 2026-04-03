# V2.2 Scope Exploration — AgentXchain.dev

> Explores the next open-source release boundary after v2.1 trust hardening. This is a decision aid, not an implementation commitment.

---

## Purpose

V2.0 and v2.1 proved that AgentXchain can govern real multi-agent work locally:

- multi-repo coordination
- plugin lifecycle
- tamper-evident dispatch manifests
- externally callable hook policy via HTTP
- dashboard evidence drill-down

The next question is not "what else can we add?" The question is:

**what v2.2 slice most strengthens AgentXchain.dev as the protocol and self-hostable governance layer, without drifting into agentxchain.ai cloud scope?**

This document narrows the candidate set and recommends the highest-leverage next boundary.

---

## Constraints

Any v2.2 candidate must satisfy all of the following:

1. It must strengthen `agentxchain.dev`, not blur it into hosted SaaS.
2. It must preserve constitutional human authority.
3. It must be self-hostable and protocol-native.
4. It must not reopen v2.1 release surfaces unless a concrete defect demands it.
5. It must create adoption leverage, not just internal implementation churn.

---

## Evaluation Criteria

Candidates are scored qualitatively against five questions:

1. **Protocol leverage:** does this make the protocol more portable or easier to adopt beyond the reference CLI?
2. **Governance value:** does this improve trust, auditability, or enforceability rather than generic agent convenience?
3. **Boundary discipline:** does this stay clearly inside `.dev` and avoid `.ai` hosting concerns?
4. **Implementation tractability:** can it be shipped incrementally without destabilizing the runtime?
5. **Ecosystem pull:** would this make outside teams more likely to build on the protocol instead of treating the CLI as the only implementation?

---

## Candidate A: Protocol Conformance Kit

### Summary

Ship the first protocol-adoption toolkit for third-party orchestrators and alternative runners.

### Why it fits the vision

`VISION.md` says "the protocol is the product" and explicitly names protocol adoption beyond the AgentXchain CLI as part of the v2 arc. Right now that claim is directionally true but operationally weak. The repo has specs and one implementation, but no conformance surface that lets another team prove "we implement AgentXchain correctly."

Without a conformance kit, "open protocol" still behaves like "trust our CLI."

### Likely deliverables

- `agentxchain verify protocol` or equivalent validator surface
- golden fixtures for:
  - governed state transitions
  - turn-result validation
  - dispatch bundle + manifest verification
  - gate semantics
  - hook audit / decision ledger minimum fields
- machine-readable capability matrix for protocol versions and optional features
- documentation for third-party implementers
- acceptance harness proving that the reference CLI passes the same suite external implementations would run

### Benefits

- Converts the protocol from narrative spec to testable contract
- Makes third-party orchestrator adoption real instead of aspirational
- Strengthens `.dev` without stepping into hosted control-plane work
- Improves internal discipline because the CLI must pass its own constitutional tests

### Risks

- Requires careful separation of protocol invariants from CLI implementation details
- Poorly designed fixtures could accidentally freeze internal behavior that should remain implementation-defined

### Verdict

**Strongest v2.2 candidate.**

---

## Candidate B: Dashboard Action Intents (CLI-Backed, Still Local)

### Summary

Allow the dashboard to initiate narrow, auditable approval intents while the CLI remains the mutation executor.

### Why it fits

The biggest remaining operator-ergonomics gap is that the dashboard can explain the next action but cannot initiate it. A constrained intent model could preserve constitutional authority while improving usability:

- dashboard generates a signed or structured intent
- local bridge verifies scope
- CLI executes the exact known command path
- action is logged as operator-approved, dashboard-initiated

### Why it is risky

This is exactly where `.dev` can accidentally build a second control plane. The v2 and v2.1 docs deferred dashboard write authority for good reason:

- permission model changes
- audit surface changes
- failure recovery gets harder
- local-only assumptions break quickly

If done badly, this weakens the "single mutation surface" principle that currently keeps the system understandable.

### Verdict

**Valid exploration topic, but not the first v2.2 slice.** It should follow protocol conformance work, not precede it.

---

## Candidate C: Plugin Trust Policy And Locking

### Summary

Harden the plugin ecosystem beyond config validation and atomic upgrade:

- plugin lockfile or install ledger
- source provenance recording
- optional trust policy
- upgrade policy enforcement

### Why it fits

This improves governed extensibility and keeps organizational integrations defensible.

### Why it is weaker than Candidate A

V2.1 already shipped the most urgent plugin hardening: config enforcement and rollback-safe upgrades. The remaining work trends toward provenance, signing, and trust policy, which the existing scope docs explicitly defer beyond v2.1. That is meaningful work, but it has narrower ecosystem leverage than a protocol conformance kit.

### Verdict

**Worth keeping on deck, but not the lead v2.2 theme unless plugin adoption pain appears immediately after v2.1.**

---

## Candidate D: Agent-Native SDLC Primitives

### Summary

Start v3 early by introducing issue, incident, or change-request governance primitives.

### Why this is premature

The vision points toward an agent-native SDLC, but the current open-source surface still needs stronger protocol adoption machinery before it grows another lifecycle layer. Adding ticketing or incident primitives now would:

- increase schema surface area materially
- create new UI and CLI flows
- risk blurring `.dev` into general work-management software

### Verdict

**Deferred.** This is strategically important, but it is the wrong next step.

---

## Explicitly Rejected For v2.2

These may be valid someday, but they are the wrong v2.2 move:

1. **Cloud-hosted dashboard work**
   - belongs to `agentxchain.ai`
2. **Plugin marketplace / registry**
   - discovery and hosting economics are not `.dev` core
3. **Real-time streaming agent output**
   - high complexity, low governance leverage
4. **Provider-adapter expansion for its own sake**
   - model coverage is not the protocol moat
5. **Big-bang test-framework migration as product scope**
   - infrastructure work, not release positioning

---

## Recommended V2.2 Direction

### Recommendation

Make **Protocol Conformance Kit** the v2.2 lead slice.

### Why this wins

It is the cleanest continuation of the actual product thesis:

- v2.0 proved governance across repos
- v2.1 hardened trust and evidence
- v2.2 should make the protocol exportable

If AgentXchain is serious about "the protocol is the product," then the next open-source leverage point is not another convenience feature. It is the ability for another orchestrator, CI system, or internal platform team to implement the protocol and prove they did not drift.

That is how `.dev` becomes infrastructure rather than just a well-documented CLI.

---

## Proposed V2.2 Boundary

If we choose Candidate A, the first boundary should be:

1. **Conformance fixtures**
   - canonical input/output fixtures for protocol-critical artifacts
2. **Conformance validator**
   - CLI-accessible check runner for implementations
3. **Capability declaration**
   - machine-readable statement of supported protocol version + optional surfaces
4. **Implementer docs**
   - explicit line between constitutional invariants and CLI-specific behavior

### What should stay out of the first cut

1. End-to-end certification service
2. Remote registry of implementations
3. Hosted reporting
4. Badge marketplace or public listing

Those are ecosystem extras. The first job is making conformance testable locally.

---

## Acceptance Questions Before Freezing Scope

1. Can we define protocol invariants without leaking CLI-only behavior?
2. What is the minimum fixture set that proves constitutional correctness rather than superficial JSON shape?
3. Which surfaces are mandatory for conformance:
   - state machine
   - turn-result validation
   - dispatch manifests
   - gates
   - hook audit ledgers
4. Which surfaces remain optional capabilities rather than baseline requirements:
   - dashboard
   - plugins
   - multi-repo coordination

---

## Open Questions

1. Should v2.2 conformance target only protocol v6, or define a versioned compatibility story starting immediately?
2. Should the reference CLI consume the same published conformance fixtures in CI, or can it use a superset internal harness?
3. Is multi-repo coordination a baseline conformance requirement or an optional capability tier?
4. Does plugin support belong in protocol conformance, or is it an implementation extension validated separately?

---

## Recommended Joint Decisions

- `DEC-VITEST-001`: Vitest migration happens after v2.1.0 as post-release infrastructure work, not as v2.2 product scope.
- `DEC-V22-001`: V2.2 exploration is constrained to `.dev`-native adoption leverage, not hosted `.ai` expansion.
- `DEC-V22-002`: Protocol conformance kit is the leading v2.2 candidate pending a dedicated scope-boundary spec.
- `DEC-V22-003`: Dashboard write authority, plugin trust policy, and SDLC primitives remain secondary or deferred until protocol conformance is specified.
